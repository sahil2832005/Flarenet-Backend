package finalize

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/FlareNet-Org/flarenet-validator/internal/config"
	"github.com/FlareNet-Org/flarenet-validator/internal/store"
	"github.com/FlareNet-Org/flarenet-validator/internal/validate"
	"github.com/jackc/pgx/v5/pgxpool"
)

const manifestPath = "/dev/shm/job/manifest.json"

// Run is the entrypoint for finalize mode.
// It reads the manifest written by Container 1, signs it, uploads the
// snapshot to S3, writes the validated_projects row, and marks the job done.
func Run(ctx context.Context, cfg *config.Config, pool *pgxpool.Pool) error {
	jobID := os.Getenv("JOB_ID")
	if jobID == "" {
		return fmt.Errorf("JOB_ID must be set")
	}

	log.Printf("[finalize] job=%s reading manifest", jobID)

	// Step 1: Read manifest from tmpfs.
	manifest, raw, err := readManifest()
	if err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}

	// Step 2: Sign the manifest with HMAC-SHA256.
	signature := signManifest(raw, cfg.ManifestHMACSecret)
	log.Printf("[finalize] job=%s manifest signed", jobID)

	// Step 3: Upload snapshot (repo + manifest) to S3.
	snapshotKey, err := uploadSnapshot(ctx, cfg, jobID, manifest.RepoSHA)
	if err != nil {
		return fmt.Errorf("s3 upload: %w", err)
	}
	log.Printf("[finalize] job=%s snapshot uploaded key=%s", jobID, snapshotKey)

	// Step 4: Write validated_projects row (upsert on repo_sha).
	safelist := store.NewSafelistStore(pool)
	if err := safelist.Insert(ctx, store.ValidatedProject{
		RepoURL:     manifest.RepoURL,
		RepoSHA:     manifest.RepoSHA,
		SnapshotKey: snapshotKey,
		Manifest:    manifest,
		Signature:   signature,
	}); err != nil {
		return fmt.Errorf("safelist insert: %w", err)
	}

	// Step 5: Mark job completed with full manifest as result.
	jobs := store.NewJobStore(pool)
	if err := jobs.MarkCompleted(ctx, jobID, map[string]any{
		"repoSha":     manifest.RepoSHA,
		"snapshotKey": snapshotKey,
		"signature":   signature,
		"validators":  manifest.Validators,
		"entrypoint":  manifest.Entrypoint,
		"nodeVersion": manifest.NodeVersion,
	}); err != nil {
		return fmt.Errorf("mark completed: %w", err)
	}

	log.Printf("[finalize] job=%s DONE", jobID)
	return nil
}

// readManifest reads and parses /dev/shm/job/manifest.json.
// Returns both the parsed struct and the raw bytes (for signing).
func readManifest() (*validate.Manifest, []byte, error) {
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, nil, fmt.Errorf("read %s: %w", manifestPath, err)
	}

	var m validate.Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, nil, fmt.Errorf("parse manifest: %w", err)
	}

	if m.JobID == "" || m.RepoSHA == "" {
		return nil, nil, fmt.Errorf("manifest missing required fields (jobId or repoSha)")
	}

	return &m, raw, nil
}
