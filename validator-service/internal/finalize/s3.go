package finalize

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/FlareNet-Org/flarenet-validator/internal/config"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const (
	repoDir      = "/dev/shm/job/repo"
	snapshotBase = "snapshots"
)

// uploadSnapshot tars the repo directory and uploads it to S3.
// Key format: snapshots/<jobID>/<repoSHA>.tar.gz
// Returns the S3 key on success.
func uploadSnapshot(ctx context.Context, cfg *config.Config, jobID, repoSHA string) (string, error) {
	key := fmt.Sprintf("%s/%s/%s.tar.gz", snapshotBase, jobID, repoSHA)

	// Build the tar.gz in memory via a pipe — never touches disk.
	pr, pw := io.Pipe()

	var tarErr error
	go func() {
		tarErr = tarGz(pw, repoDir)
		pw.CloseWithError(tarErr)
	}()

	client, err := newS3Client(ctx, cfg)
	if err != nil {
		pr.Close()
		return "", fmt.Errorf("s3 client: %w", err)
	}

	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(cfg.S3Bucket),
		Key:         aws.String(key),
		Body:        pr,
		ContentType: aws.String("application/gzip"),
	})
	if err != nil {
		return "", fmt.Errorf("s3 put: %w", err)
	}

	if tarErr != nil {
		return "", fmt.Errorf("tar: %w", tarErr)
	}

	return key, nil
}

// tarGz writes a gzipped tar of srcDir to w.
func tarGz(w io.Writer, srcDir string) error {
	gz := gzip.NewWriter(w)
	defer gz.Close()

	tw := tar.NewWriter(gz)
	defer tw.Close()

	return filepath.WalkDir(srcDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip .git directory — we don't need git history in the snapshot.
		if d.IsDir() && d.Name() == ".git" {
			return filepath.SkipDir
		}

		info, err := d.Info()
		if err != nil {
			return err
		}

		// Build the tar header with a relative path.
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel) // normalise to forward slashes

		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = rel

		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}

		if d.IsDir() || !info.Mode().IsRegular() {
			return nil
		}

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()

		_, err = io.Copy(tw, f)
		return err
	})
}

func newS3Client(ctx context.Context, cfg *config.Config) (*s3.Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.AWSRegion),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				cfg.AWSAccessKeyID,
				cfg.AWSSecretAccessKey,
				"",
			),
		),
	)
	if err != nil {
		return nil, err
	}
	// Normalise bucket name — strip any accidental leading/trailing whitespace.
	_ = strings.TrimSpace(cfg.S3Bucket)
	return s3.NewFromConfig(awsCfg), nil
}
