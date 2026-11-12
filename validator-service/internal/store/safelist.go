package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SafelistStore struct {
	pool *pgxpool.Pool
}

func NewSafelistStore(pool *pgxpool.Pool) *SafelistStore {
	return &SafelistStore{pool: pool}
}

type ValidatedProject struct {
	RepoURL     string
	RepoSHA     string
	SnapshotKey string
	Manifest    any
	Signature   string
}

func (s *SafelistStore) Insert(ctx context.Context, p ValidatedProject) error {
	manifestJSON, err := json.Marshal(p.Manifest)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}

	_, err = s.pool.Exec(ctx,
		`INSERT INTO validated_projects (repo_url, repo_sha, snapshot_key, manifest, signature, created_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (repo_sha) DO UPDATE
		   SET snapshot_key = EXCLUDED.snapshot_key,
		       manifest     = EXCLUDED.manifest,
		       signature    = EXCLUDED.signature`,
		p.RepoURL, p.RepoSHA, p.SnapshotKey, manifestJSON, p.Signature,
	)
	if err != nil {
		return fmt.Errorf("insert validated project: %w", err)
	}
	return nil
}

func (s *SafelistStore) ExistsBySHA(ctx context.Context, repoSHA string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM validated_projects WHERE repo_sha = $1)`,
		repoSHA,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check safelist: %w", err)
	}
	return exists, nil
}
