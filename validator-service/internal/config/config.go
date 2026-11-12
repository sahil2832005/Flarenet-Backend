package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL string

	ValidatorImage string
	RunnerImage    string

	S3Bucket           string
	AWSRegion          string
	AWSAccessKeyID     string
	AWSSecretAccessKey string
	ManifestHMACSecret string

	MaxConcurrentJobs      int
	JobTimeoutSeconds      int
	StuckJobRequeueMinutes int
}

func Load() (*Config, error) {
	cfg := &Config{}

	required := map[string]*string{
		"DATABASE_URL":          &cfg.DatabaseURL,
		"VALIDATOR_IMAGE":       &cfg.ValidatorImage,
		"RUNNER_IMAGE":          &cfg.RunnerImage,
		"S3_BUCKET":             &cfg.S3Bucket,
		"AWS_REGION":            &cfg.AWSRegion,
		"AWS_ACCESS_KEY_ID":     &cfg.AWSAccessKeyID,
		"AWS_SECRET_ACCESS_KEY": &cfg.AWSSecretAccessKey,
		"MANIFEST_HMAC_SECRET":  &cfg.ManifestHMACSecret,
	}

	var missing []string
	for key, dest := range required {
		val := os.Getenv(key)
		if val == "" {
			missing = append(missing, key)
			continue
		}
		*dest = val
	}

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required env vars: %v", missing)
	}

	cfg.MaxConcurrentJobs = envInt("MAX_CONCURRENT_JOBS", 3)
	cfg.JobTimeoutSeconds = envInt("JOB_TIMEOUT_SECONDS", 90)
	cfg.StuckJobRequeueMinutes = envInt("STUCK_JOB_REQUEUE_MINUTES", 15)

	return cfg, nil
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
