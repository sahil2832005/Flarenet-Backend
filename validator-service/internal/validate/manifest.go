package validate

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Manifest is the JSON document written to /dev/shm/job/manifest.json.
// Container 3 (finalize) reads this, signs it, and uploads to S3.
type Manifest struct {
	JobID       string             `json:"jobId"`
	RepoURL     string             `json:"repoUrl"`
	RepoSHA     string             `json:"repoSha"`
	ValidatedAt time.Time          `json:"validatedAt"`
	Validators  map[string]string  `json:"validators"` // name → "pass"|"fail"
	Entrypoint  string             `json:"entrypoint"`
	NodeVersion string             `json:"nodeVersion"`
	Dependencies []string          `json:"dependencies"`
}

// writeManifest builds the manifest from validator results and writes it to disk.
func writeManifest(jobID, repoURL, repoSHA, repoDir string, results *ValidationResults) error {
	validators := map[string]string{
		"structure":   results.Structure.Status,
		"packageJson": results.PackageJSON.Status,
		"secrets":     results.Secrets.Status,
		"malware":     results.Malware.Status,
		"ast":         results.AST.Status,
		"nodejsOnly":  results.NodeJSOnly.Status,
	}

	m := Manifest{
		JobID:        jobID,
		RepoURL:      repoURL,
		RepoSHA:      repoSHA,
		ValidatedAt:  time.Now().UTC(),
		Validators:   validators,
		Entrypoint:   results.Entrypoint,
		NodeVersion:  results.NodeVersion,
		Dependencies: results.Dependencies,
	}

	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}

	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	return nil
}
