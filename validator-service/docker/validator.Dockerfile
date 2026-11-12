# ── Stage 1: Build the Go binary ─────────────────────────────────────────────
FROM golang:1.23 AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o validator ./cmd/...

# ── Stage 2: Final image ──────────────────────────────────────────────────────
# Uses node:20-slim so Container 1 can run npm install after cloning.
# git is needed for the clone step.
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy the Go binary from the builder stage.
COPY --from=builder /app/validator /usr/local/bin/validator

# Ensure /dev/shm/job exists as a mount point (tmpfs is mounted by the worker).
RUN mkdir -p /dev/shm/job

ENTRYPOINT ["validator"]
