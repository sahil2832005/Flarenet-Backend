package validate

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	workDir    = "/dev/shm/job"
	repoDir    = "/dev/shm/job/repo"
	manifestPath = "/dev/shm/job/manifest.json"

	// Abort clone if repo exceeds this size (bytes streamed).
	maxRepoBytes = 200 * 1024 * 1024 // 200 MB
)

// Run is the entrypoint for validate mode.
// It reads JOB_ID + REPO_URL from env, clones the repo, runs all validators,
// builds the manifest, and writes it to /dev/shm/job/manifest.json.
func Run(ctx context.Context) error {
	jobID := os.Getenv("JOB_ID")
	repoURL := os.Getenv("REPO_URL")

	if jobID == "" || repoURL == "" {
		return fmt.Errorf("JOB_ID and REPO_URL must be set")
	}

	log.Printf("[validate] job=%s repo=%s", jobID, repoURL)

	// Ensure work directory exists inside tmpfs.
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return fmt.Errorf("create workdir: %w", err)
	}

	// Step 1: Pre-flight — verify the repo is reachable before cloning.
	if err := preflight(ctx, repoURL); err != nil {
		return fmt.Errorf("preflight: %w", err)
	}

	// Step 2: Clone into /dev/shm/job/repo.
	repoSHA, err := cloneRepo(ctx, repoURL, repoDir)
	if err != nil {
		return fmt.Errorf("clone: %w", err)
	}
	log.Printf("[validate] cloned sha=%s", repoSHA)

	// Step 3: Run all 6 validators in parallel.
	results, err := runValidators(ctx, repoDir)
	if err != nil {
		return fmt.Errorf("validators: %w", err)
	}

	// Step 4: Install dependencies so Container 2 can run npm start offline.
	// Container 2 has network=none, so node_modules must exist before it starts.
	if err := npmInstall(ctx, repoDir); err != nil {
		return fmt.Errorf("npm install: %w", err)
	}

	// Step 5: Build and write manifest.
	if err := writeManifest(jobID, repoURL, repoSHA, repoDir, results); err != nil {
		return fmt.Errorf("manifest: %w", err)
	}

	log.Printf("[validate] job=%s complete — manifest written", jobID)
	return nil
}

// preflight checks the repo is reachable via git ls-remote.
// No code is downloaded — just verifies the URL resolves and the repo exists.
func preflight(ctx context.Context, repoURL string) error {
	cmd := exec.CommandContext(ctx, "git", "ls-remote", "--exit-code", repoURL, "HEAD")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("repo not reachable (%s): %w", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// cloneRepo clones repoURL into destDir with depth=1 and enforces maxRepoBytes.
// Returns the HEAD commit SHA.
func cloneRepo(ctx context.Context, repoURL, destDir string) (string, error) {
	// Remove any previous clone attempt.
	_ = os.RemoveAll(destDir)

	cmd := exec.CommandContext(ctx,
		"git", "clone",
		"--depth=1",
		"--single-branch",
		"--no-tags",
		repoURL,
		destDir,
	)
	cmd.Env = append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_LFS_SKIP_SMUDGE=1", // skip LFS blobs — we don't need them
	)

	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git clone failed: %s", strings.TrimSpace(string(out)))
	}

	// Enforce size limit after clone.
	size, err := dirSize(destDir)
	if err != nil {
		return "", fmt.Errorf("size check: %w", err)
	}
	if size > maxRepoBytes {
		_ = os.RemoveAll(destDir)
		return "", fmt.Errorf("repo too large: %d bytes (max %d)", size, maxRepoBytes)
	}

	// Read the HEAD SHA.
	sha, err := headSHA(ctx, destDir)
	if err != nil {
		return "", fmt.Errorf("read HEAD sha: %w", err)
	}

	return sha, nil
}

// headSHA returns the current HEAD commit SHA for the given repo directory.
func headSHA(ctx context.Context, repoDir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", repoDir, "rev-parse", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// npmInstall runs `npm install --prefer-offline --no-audit --no-fund` inside
// the repo directory. Container 1 has internet; this populates node_modules
// so Container 2 (network=none) can run npm start without fetching anything.
func npmInstall(ctx context.Context, repoDir string) error {
	cmd := exec.CommandContext(ctx,
		"npm", "install",
		"--prefer-offline",
		"--no-audit",
		"--no-fund",
		"--loglevel=error",
	)
	cmd.Dir = repoDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("npm install failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// dirSize returns the total byte size of all files under dir.
func dirSize(dir string) (int64, error) {
	var total int64
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		return nil
	})
	return total, err
}
