package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/FlareNet-Org/flarenet-validator/internal/config"
	"github.com/FlareNet-Org/flarenet-validator/internal/finalize"
	"github.com/FlareNet-Org/flarenet-validator/internal/health"
	"github.com/FlareNet-Org/flarenet-validator/internal/store"
	"github.com/FlareNet-Org/flarenet-validator/internal/validate"
	"github.com/FlareNet-Org/flarenet-validator/internal/worker"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: validator <worker|validate|finalize>\n")
		os.Exit(1)
	}

	mode := os.Args[1]

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// validate and finalize modes do not need a DB connection on startup —
	// they receive job context via env vars passed by the worker.
	var pool *pgxpool.Pool
	if mode == "worker" || mode == "finalize" {
		ctx := context.Background()
		pool, err = store.NewPool(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("database: %v", err)
		}
		defer pool.Close()
	}

	log.Printf("[validator] mode=%s started", mode)

	// Graceful shutdown on SIGINT / SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	switch mode {
	case "worker":
		runWorker(ctx, cfg, pool)
	case "validate":
		runValidate(ctx, cfg)
	case "finalize":
		runFinalize(ctx, cfg, pool)
	default:
		fmt.Fprintf(os.Stderr, "unknown mode: %s\n", mode)
		os.Exit(1)
	}
}

func runWorker(ctx context.Context, cfg *config.Config, pool *pgxpool.Pool) {
	// Start health endpoint on :8080 (override with HEALTH_PORT env var).
	health.New(pool, os.Getenv("HEALTH_PORT")).Start(ctx)

	w, err := worker.New(cfg, pool)
	if err != nil {
		log.Fatalf("worker init: %v", err)
	}
	w.Run(ctx)
}

func runValidate(ctx context.Context, cfg *config.Config) {
	if err := validate.Run(ctx); err != nil {
		log.Fatalf("[validate] failed: %v", err)
	}
}

func runFinalize(ctx context.Context, cfg *config.Config, pool *pgxpool.Pool) {
	if err := finalize.Run(ctx, cfg, pool); err != nil {
		log.Fatalf("[finalize] failed: %v", err)
	}
}
