package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type JobStatus string

const (
	StatusPending   JobStatus = "pending"
	StatusRunning   JobStatus = "running"
	StatusCompleted JobStatus = "completed"
	StatusFailed    JobStatus = "failed"
)

type Job struct {
	ID        string
	RepoURL   string
	Status    JobStatus
	CreatedAt time.Time
}

type JobStore struct {
	pool *pgxpool.Pool
}

func NewJobStore(pool *pgxpool.Pool) *JobStore {
	return &JobStore{pool: pool}
}

func (s *JobStore) Enqueue(ctx context.Context, jobID, repoURL string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO validation_jobs (id, repo_url, status, created_at, attempts)
		 VALUES ($1, $2, 'pending', now(), 0)`,
		jobID, repoURL,
	)
	if err != nil {
		return fmt.Errorf("enqueue job: %w", err)
	}
	return nil
}

// Claim picks one pending job atomically. Returns nil job if none available.
func (s *JobStore) Claim(ctx context.Context) (*Job, error) {
	row := s.pool.QueryRow(ctx,
		`UPDATE validation_jobs
		 SET status = 'running', started_at = now(), attempts = attempts + 1
		 WHERE id = (
		   SELECT id FROM validation_jobs
		   WHERE status = 'pending'
		   ORDER BY created_at ASC
		   LIMIT 1
		   FOR UPDATE SKIP LOCKED
		 )
		 RETURNING id, repo_url, status, created_at`,
	)

	var job Job
	err := row.Scan(&job.ID, &job.RepoURL, &job.Status, &job.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("claim job: %w", err)
	}
	return &job, nil
}

func (s *JobStore) MarkCompleted(ctx context.Context, jobID string, result any) error {
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal result: %w", err)
	}

	_, err = s.pool.Exec(ctx,
		`UPDATE validation_jobs
		 SET status = 'completed', finished_at = now(), result = $2
		 WHERE id = $1`,
		jobID, resultJSON,
	)
	return err
}

func (s *JobStore) MarkFailed(ctx context.Context, jobID, reason string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE validation_jobs
		 SET status = 'failed', finished_at = now(), error = $2
		 WHERE id = $1`,
		jobID, reason,
	)
	return err
}

func (s *JobStore) GetByID(ctx context.Context, jobID string) (*JobResult, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT id, status, result, error FROM validation_jobs WHERE id = $1`,
		jobID,
	)

	var r JobResult
	var resultJSON []byte
	err := row.Scan(&r.ID, &r.Status, &resultJSON, &r.Error)
	if err != nil {
		return nil, fmt.Errorf("get job: %w", err)
	}
	if resultJSON != nil {
		if err := json.Unmarshal(resultJSON, &r.Result); err != nil {
			return nil, fmt.Errorf("unmarshal result: %w", err)
		}
	}
	return &r, nil
}

// RequeueStuck requeues jobs stuck in running state beyond the given duration.
func (s *JobStore) RequeueStuck(ctx context.Context, olderThan time.Duration) (int64, error) {
	result, err := s.pool.Exec(ctx,
		`UPDATE validation_jobs
		 SET status = 'pending', started_at = null
		 WHERE status = 'running'
		   AND started_at < now() - $1::interval
		   AND attempts < 3`,
		fmt.Sprintf("%d seconds", int(olderThan.Seconds())),
	)
	if err != nil {
		return 0, fmt.Errorf("requeue stuck jobs: %w", err)
	}
	return result.RowsAffected(), nil
}

type JobResult struct {
	ID     string
	Status JobStatus
	Result map[string]any
	Error  *string
}
