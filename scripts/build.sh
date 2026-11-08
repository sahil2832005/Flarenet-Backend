#!/bin/bash

# =============================================================================
# Flarenet Backend - Build & Setup Script
# =============================================================================
# Single script to manage the entire local development environment
#
# Usage:
#   ./build.sh                    # Default: build and start all services
#   ./build.sh --build            # Build images only (no start)
#   ./build.sh --force            # Force rebuild without cache
#   ./build.sh --recreate         # Recreate containers (rebuild + fresh start)
#   ./build.sh --logs [service]   # Show logs (default: backend)
#   ./build.sh --status           # Show status of all services
#   ./build.sh --stop             # Stop all services
#   ./build.sh --clean            # Stop and remove all volumes (fresh start)
#   ./build.sh --migrate          # Run database migrations only
#   ./build.sh --restart          # Restart backend service only
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/../compose"
MAX_RETRIES=30
RETRY_INTERVAL=2

# =============================================================================
# Helper Functions
# =============================================================================

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

log_header() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  $1${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found on PATH. Start Docker Desktop and restart your terminal."
        exit 1
    fi
    if ! docker info &> /dev/null; then
        log_error "Docker is not running"
        exit 1
    fi
}

wait_for_healthy() {
    local service=$1
    local retries=0
    
    while [ $retries -lt $MAX_RETRIES ]; do
        if docker compose ps "$service" 2>/dev/null | grep -q "healthy\|running"; then
            return 0
        fi
        retries=$((retries + 1))
        sleep $RETRY_INTERVAL
    done
    return 1
}

# =============================================================================
# Commands
# =============================================================================

cmd_build() {
    local force=$1
    log_header "Building Docker Images"
    
    if [ "$force" == "true" ]; then
        log_info "Building without cache..."
        docker compose build --no-cache
    else
        docker compose build
    fi
    log_success "Build complete"
}

cmd_start() {
    log_header "Starting Services"
    
    # Start all services - Docker will handle dependencies via healthchecks
    log_info "Starting all services (waiting for health checks)..."
    docker compose up -d
    
    # Wait for backend to be running
    log_info "Waiting for backend to be ready..."
    local retries=0
    while [ $retries -lt 60 ]; do
        if docker compose ps backend 2>/dev/null | grep -q "running"; then
            break
        fi
        retries=$((retries + 1))
        sleep 2
    done
    
    log_success "All services started"
}

cmd_migrate() {
    log_header "Running Database Migrations"
    
    # Wait for backend to be fully running
    log_info "Waiting for backend to be ready..."
    local retries=0
    while [ $retries -lt 30 ]; do
        if docker compose ps backend 2>/dev/null | grep -q "running"; then
            break
        fi
        retries=$((retries + 1))
        sleep 2
    done
    
    # Give it a moment to fully initialize
    sleep 5
    
    log_info "Running Prisma migrations..."
    if docker compose exec -T backend npx prisma migrate deploy; then
        log_success "Migrations complete"
    else
        log_warn "Migration may have failed or already applied"
    fi
    
    # Restart backend to pick up fresh DB
    log_info "Restarting backend to apply migrations..."
    docker compose restart backend
    sleep 3
}

cmd_logs() {
    local service="${1:-backend}"
    log_info "Showing logs for: $service (Ctrl+C to exit)"
    docker compose logs -f "$service"
}

cmd_status() {
    log_header "Service Status"
    docker compose ps
    echo ""
    echo "Endpoints:"
    echo "  Backend:     http://localhost:5000"
    echo "  PostgreSQL:  localhost:5432"
    echo "  Redis:       localhost:6379"
    echo "  ClickHouse:  localhost:8123"
    echo "  Kafka:       localhost:9092"
}

cmd_stop() {
    log_header "Stopping Services"
    docker compose down --remove-orphans
    log_success "All services stopped"
}

cmd_clean() {
    log_header "Cleaning Up (Removing Volumes)"
    docker compose down -v --remove-orphans
    log_success "All services stopped and volumes removed"
}

cmd_restart() {
    log_header "Restarting Backend"
    docker compose restart backend
    log_success "Backend restarted"
}

cmd_recreate() {
    log_header "Recreating Environment"
    cmd_stop
    cmd_build "true"
    cmd_start
    cmd_migrate
    log_success "Environment recreated"
}

cmd_default() {
    log_header "Flarenet Backend Setup"
    check_docker
    cmd_build "false"
    cmd_start
    cmd_migrate
    echo ""
    cmd_status
}

show_help() {
    echo "Flarenet Backend - Build Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  (none)        Build and start all services with migrations"
    echo "  --build       Build images only"
    echo "  --force       Force rebuild without cache, then start"
    echo "  --recreate    Stop, clean rebuild, start, migrate"
    echo "  --start       Start services (assumes images exist)"
    echo "  --stop        Stop all services"
    echo "  --clean       Stop and remove all volumes"
    echo "  --restart     Restart backend only"
    echo "  --migrate     Run database migrations"
    echo "  --logs [svc]  Show logs (default: backend)"
    echo "  --status      Show service status"
    echo "  --help        Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                    # Full setup"
    echo "  $0 --force            # Clean rebuild"
    echo "  $0 --logs             # Backend logs"
    echo "  $0 --logs postgres    # Postgres logs"
}

# =============================================================================
# Main
# =============================================================================

cd "$COMPOSE_DIR"

case "${1:-}" in
    --build)
        check_docker
        cmd_build "false"
        ;;
    --force)
        check_docker
        cmd_build "true"
        cmd_start
        cmd_migrate
        cmd_status
        ;;
    --recreate)
        check_docker
        cmd_recreate
        cmd_status
        ;;
    --start)
        check_docker
        cmd_start
        ;;
    --stop)
        cmd_stop
        ;;
    --clean)
        cmd_clean
        ;;
    --restart)
        cmd_restart
        ;;
    --migrate)
        cmd_migrate
        ;;
    --logs)
        cmd_logs "$2"
        ;;
    --status)
        cmd_status
        ;;
    --help|-h)
        show_help
        ;;
    "")
        check_docker
        cmd_default
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
