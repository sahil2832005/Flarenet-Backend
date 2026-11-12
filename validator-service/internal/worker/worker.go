package worker

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/FlareNet-Org/flarenet-validator/internal/config"
	"github.com/FlareNet-Org/flarenet-validator/internal/runner"
	"github.com/FlareNet-Org/flarenet-validator/internal/store"
	"github.com/docker/docker/api/types/container"
	dockerfilters "github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Worker listens for new jobs via PostgreSQL LISTEN/NOTIFY and dispatches
// container chains up to cfg.MaxConcurrentJobs at a time.
type Worker struct {
	cfg    *config.Config
	pool   *pgxpool.Pool
	jobs   *store.JobStore
	runner *runner.Runner
	docker *client.Client
	sem    chan struct{} // semaphore: limits concurrent jobs
}

func New(cfg *config.Config, pool *pgxpool.Pool) (*Worker, error) {
	r, err := runner.New(cfg)
	if err != nil {
		return nil, err
	}
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("docker client: %w", err)
	}
	return &Worker{
		cfg:    cfg,
		pool:   pool,
		jobs:   store.NewJobStore(pool),
		runner: r,
		docker: cli,
		sem:    make(chan struct{}, cfg.MaxConcurrentJobs),
	}, nil
}

// Run starts the worker. It blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	log.Printf("[worker] starting, max_concurrent_jobs=%d", w.cfg.MaxConcurrentJobs)

	// Kill any orphaned containers left over from a prior worker crash.
	w.reapOrphanContainers(ctx)

	// Requeue any stuck jobs left over from a prior crash.
	w.requeueStuck(ctx)

	// Drain any pending jobs that arrived before this process started.
	w.drainPending(ctx)

	// Start the stuck-job requeue ticker.
	go w.requeueLoop(ctx)

	// Listen for new job notifications.
	conn, err := w.pool.Acquire(ctx)
	if err != nil {
		log.Printf("[worker] failed to acquire listen conn: %v", err)
		return
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN validation_jobs_new"); err != nil {
		log.Printf("[worker] LISTEN failed: %v", err)
		return
	}
	log.Println("[worker] listening on validation_jobs_new")

	for {
		// WaitForNotification blocks until a NOTIFY arrives or ctx is cancelled.
		_, err := conn.Conn().WaitForNotification(ctx)
		if ctx.Err() != nil {
			log.Println("[worker] context cancelled, shutting down")
			return
		}
		if err != nil {
			log.Printf("[worker] notification error: %v — reconnecting in 5s", err)
			time.Sleep(5 * time.Second)
			return // caller may restart; for now exit cleanly
		}
		// A NOTIFY can represent multiple queued jobs, so drain all pending.
		w.drainPending(ctx)
	}
}

// drainPending claims and dispatches all currently pending jobs.
func (w *Worker) drainPending(ctx context.Context) {
	for {
		job, err := w.jobs.Claim(ctx)
		if err != nil {
			log.Printf("[worker] claim error: %v", err)
			return
		}
		if job == nil {
			return // no more pending jobs
		}
		w.dispatch(ctx, job)
	}
}

// dispatch acquires a semaphore slot and runs the container chain in a goroutine.
func (w *Worker) dispatch(ctx context.Context, job *store.Job) {
	// Block until a slot is free (respects MaxConcurrentJobs).
	select {
	case w.sem <- struct{}{}:
	case <-ctx.Done():
		return
	}

	go func() {
		defer func() { <-w.sem }()
		w.runJob(ctx, job)
	}()
}

// runJob executes the 3-container chain for a single job.
func (w *Worker) runJob(ctx context.Context, job *store.Job) {
	log.Printf("[worker] job=%s repo=%s starting", job.ID, job.RepoURL)

	jobCtx, cancel := context.WithTimeout(ctx, time.Duration(w.cfg.JobTimeoutSeconds)*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)

	go func() {
		defer wg.Done()
		if err := w.runner.Run(jobCtx, job); err != nil {
			log.Printf("[worker] job=%s FAILED: %v", job.ID, err)
			if dbErr := w.jobs.MarkFailed(context.Background(), job.ID, err.Error()); dbErr != nil {
				log.Printf("[worker] job=%s mark-failed error: %v", job.ID, dbErr)
			}
			return
		}
		log.Printf("[worker] job=%s COMPLETED", job.ID)
	}()

	wg.Wait()
}

// requeueLoop periodically requeues stuck jobs.
func (w *Worker) requeueLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			w.requeueStuck(ctx)
		case <-ctx.Done():
			return
		}
	}
}

func (w *Worker) requeueStuck(ctx context.Context) {
	d := time.Duration(w.cfg.StuckJobRequeueMinutes) * time.Minute
	n, err := w.jobs.RequeueStuck(ctx, d)
	if err != nil {
		log.Printf("[worker] requeue stuck error: %v", err)
		return
	}
	if n > 0 {
		log.Printf("[worker] requeued %d stuck job(s)", n)
	}
}

// reapOrphanContainers removes any containers matching flarenet job name
// prefixes that were left running after a previous worker crash.
func (w *Worker) reapOrphanContainers(ctx context.Context) {
	prefixes := []string{"validate-", "runner-", "finalize-"}

	filters := dockerfilters.NewArgs()
	for _, p := range prefixes {
		filters.Add("name", p)
	}

	containers, err := w.docker.ContainerList(ctx, container.ListOptions{
		All:     true, // include stopped containers too
		Filters: filters,
	})
	if err != nil {
		log.Printf("[worker] orphan reap list error: %v", err)
		return
	}

	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		isOrphan := false
		for _, p := range prefixes {
			if strings.HasPrefix(name, p) {
				isOrphan = true
				break
			}
		}
		if !isOrphan {
			continue
		}

		rmCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := w.docker.ContainerRemove(rmCtx, c.ID, container.RemoveOptions{Force: true})
		cancel()
		if err != nil {
			log.Printf("[worker] failed to remove orphan container %s: %v", name, err)
		} else {
			log.Printf("[worker] removed orphan container %s", name)
		}
	}
}
