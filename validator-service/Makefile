.PHONY: build tidy build-validator build-runner build-images run-worker

# ── Go ────────────────────────────────────────────────────────────────────────

tidy:
	docker run --rm -v $(PWD):/app -w /app golang:1.23 go mod tidy

build:
	docker run --rm -v $(PWD):/app -w /app golang:1.23 \
		go build -ldflags="-s -w" -o bin/validator ./cmd/...

# ── Docker images ─────────────────────────────────────────────────────────────

build-validator:
	docker build -f docker/validator.Dockerfile -t flarenet/validator:latest .

build-runner:
	docker build -f docker/runner.Dockerfile -t flarenet/runner-base:latest .

build-images: build-validator build-runner
	@echo "Both images built."

# ── Run locally ───────────────────────────────────────────────────────────────

# Requires a .env file in validator-service/ root (copy from .env.example).
run-worker:
	docker compose -f docker/docker-compose.dev.yml up --build
