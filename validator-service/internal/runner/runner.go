package runner

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/FlareNet-Org/flarenet-validator/internal/config"
	"github.com/FlareNet-Org/flarenet-validator/internal/store"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
)

// workdirPath is the tmpfs mount point inside every container.
// Files written here live only in RAM and are destroyed when the container exits.
const workdirPath = "/dev/shm/job"

// Runner orchestrates the 3-container chain for each validation job.
type Runner struct {
	cfg    *config.Config
	docker *client.Client
}

func New(cfg *config.Config) (*Runner, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("docker client: %w", err)
	}
	return &Runner{cfg: cfg, docker: cli}, nil
}

// Run executes the full 3-container chain for one job.
//
//	Container 1 (validate)  — clones repo to tmpfs, runs 6 validators, produces manifest
//	Container 2 (runner)    — executes user code, zero creds, network=none
//	Container 3 (finalize)  — uploads snapshot to S3, writes validated_projects row
func (r *Runner) Run(ctx context.Context, job *store.Job) error {
	// Container 1 — validate mode (our image, has credentials, needs internet).
	if err := r.runContainer(ctx, containerSpec{
		name:  "validate-" + job.ID,
		image: r.cfg.ValidatorImage,
		cmd:   []string{"validate"},
		env: []string{
			"DATABASE_URL=" + r.cfg.DatabaseURL,
			"S3_BUCKET=" + r.cfg.S3Bucket,
			"AWS_REGION=" + r.cfg.AWSRegion,
			"AWS_ACCESS_KEY_ID=" + r.cfg.AWSAccessKeyID,
			"AWS_SECRET_ACCESS_KEY=" + r.cfg.AWSSecretAccessKey,
			"MANIFEST_HMAC_SECRET=" + r.cfg.ManifestHMACSecret,
			"JOB_ID=" + job.ID,
			"REPO_URL=" + job.RepoURL,
		},
		networkMode: "bridge",
		readonly:    false,  // needs to write to /dev/shm
		runAsUser:   "1000", // non-root inside our own container
	}); err != nil {
		return fmt.Errorf("container1 (validate): %w", err)
	}

	// Container 2 — user code (zero creds, network=none, hard resource caps).
	if err := r.runContainer(ctx, containerSpec{
		name:        "runner-" + job.ID,
		image:       r.cfg.RunnerImage,
		cmd:         []string{"npm", "start"},
		env:         []string{}, // intentionally empty — no credentials ever
		networkMode: "none",     // completely isolated, no outbound traffic
		readonly:    true,       // root fs read-only; /dev/shm is the only writable mount
		memory:      512 * 1024 * 1024, // 512 MB hard cap
		nanoCPUs:    500_000_000,        // 0.5 CPU hard cap
		pidsLimit:   50,                 // max 50 processes/threads
		runAsUser:   "runner",           // non-root user defined in runner.Dockerfile
	}); err != nil {
		return fmt.Errorf("container2 (runner): %w", err)
	}

	// Container 3 — finalize mode (our image, has credentials, read-only root).
	if err := r.runContainer(ctx, containerSpec{
		name:  "finalize-" + job.ID,
		image: r.cfg.ValidatorImage,
		cmd:   []string{"finalize"},
		env: []string{
			"DATABASE_URL=" + r.cfg.DatabaseURL,
			"S3_BUCKET=" + r.cfg.S3Bucket,
			"AWS_REGION=" + r.cfg.AWSRegion,
			"AWS_ACCESS_KEY_ID=" + r.cfg.AWSAccessKeyID,
			"AWS_SECRET_ACCESS_KEY=" + r.cfg.AWSSecretAccessKey,
			"MANIFEST_HMAC_SECRET=" + r.cfg.ManifestHMACSecret,
			"JOB_ID=" + job.ID,
		},
		networkMode: "bridge",
		readonly:    true,   // only reads manifest from /dev/shm, never writes
		runAsUser:   "1000", // non-root inside our own container
	}); err != nil {
		return fmt.Errorf("container3 (finalize): %w", err)
	}

	return nil
}

type containerSpec struct {
	name        string
	image       string
	cmd         []string
	env         []string
	networkMode string
	// readonly locks the container's root filesystem (tmpfs is always writable).
	readonly bool
	// memory is the hard RAM limit in bytes. 0 = no limit (our containers only).
	memory int64
	// nanoCPUs is 1e9 per CPU core. 0 = no limit.
	nanoCPUs int64
	// pidsLimit caps the number of processes/threads. 0 = no cap.
	pidsLimit int64
	// runAsUser is the UID to run the container process as. 0 = image default.
	runAsUser string
}

// runContainer creates, starts, waits for, and removes one container.
func (r *Runner) runContainer(ctx context.Context, spec containerSpec) error {
	log.Printf("[runner] starting container name=%s image=%s", spec.name, spec.image)

	memSwap := spec.memory // swap == memory disables swap entirely
	if spec.memory == 0 {
		memSwap = 0
	}

	hostCfg := &container.HostConfig{
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeTmpfs,
				Target: workdirPath,
				TmpfsOptions: &mount.TmpfsOptions{
					SizeBytes: 512 * 1024 * 1024, // 512 MB tmpfs
					Mode:      0755,
				},
			},
		},
		NetworkMode: container.NetworkMode(spec.networkMode),
		Resources: container.Resources{
			Memory:     spec.memory,
			MemorySwap: memSwap, // setting equal to Memory disables swap
			NanoCPUs:   spec.nanoCPUs,
			CPUShares:  0, // replaced by NanoCPUs hard cap
		},
		CapDrop:        []string{"ALL"},
		SecurityOpt:    []string{"no-new-privileges:true", "seccomp=" + seccompProfile},
		ReadonlyRootfs: spec.readonly,
		AutoRemove:     false, // removed manually so we can capture exit code
	}

	if spec.pidsLimit > 0 {
		hostCfg.PidsLimit = &spec.pidsLimit
	}

	containerCfg := &container.Config{
		Image: spec.image,
		Cmd:   spec.cmd,
		Env:   spec.env,
		User:  spec.runAsUser,
	}

	// Create the container.
	resp, err := r.docker.ContainerCreate(ctx, containerCfg, hostCfg, &network.NetworkingConfig{}, nil, spec.name)
	if err != nil {
		return fmt.Errorf("create: %w", err)
	}
	containerID := resp.ID

	// Always attempt cleanup.
	defer func() {
		rmCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = r.docker.ContainerRemove(rmCtx, containerID, container.RemoveOptions{Force: true})
	}()

	// Start.
	if err := r.docker.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	// Wait for completion or context cancellation.
	statusCh, errCh := r.docker.ContainerWait(ctx, containerID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("wait: %w", err)
		}
	case status := <-statusCh:
		if status.StatusCode != 0 {
			logs := r.containerLogs(containerID)
			return fmt.Errorf("exited %d: %s", status.StatusCode, logs)
		}
	case <-ctx.Done():
		// Kill the container on timeout.
		killCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = r.docker.ContainerKill(killCtx, containerID, "SIGKILL")
		return fmt.Errorf("timeout: %w", ctx.Err())
	}

	log.Printf("[runner] container name=%s exited 0", spec.name)
	return nil
}

// containerLogs fetches the last ~2 KB of stdout+stderr for error reporting.
func (r *Runner) containerLogs(containerID string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out, err := r.docker.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       "50",
	})
	if err != nil {
		return "(logs unavailable)"
	}
	defer out.Close()

	var sb strings.Builder
	_, _ = io.Copy(&sb, out)
	logs := strings.TrimSpace(sb.String())
	if len(logs) > 2048 {
		logs = logs[len(logs)-2048:]
	}
	return logs
}
