package health

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Server is a minimal HTTP server that exposes a /health endpoint.
// It runs as a goroutine alongside the worker so an external load balancer
// or container orchestrator can check whether the service is alive.
type Server struct {
	pool *pgxpool.Pool
	port string
}

func New(pool *pgxpool.Pool, port string) *Server {
	if port == "" {
		port = "8080"
	}
	return &Server{pool: pool, port: port}
}

// Start launches the HTTP server in a background goroutine.
// It returns immediately; the server runs until ctx is cancelled.
func (s *Server) Start(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)

	srv := &http.Server{
		Addr:         ":" + s.port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("[health] listening on :%s", s.port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[health] server error: %v", err)
		}
	}()

	// Shut down cleanly when ctx is cancelled (worker SIGTERM).
	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()
}

type healthResponse struct {
	Status   string `json:"status"`   // "ok" | "degraded"
	DB       string `json:"db"`       // "ok" | "error"
	Uptime   string `json:"uptime"`
}

var startTime = time.Now()

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "ok"

	pingCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := s.pool.Ping(pingCtx); err != nil {
		dbStatus = "error"
		log.Printf("[health] db ping failed: %v", err)
	}

	overall := "ok"
	if dbStatus != "ok" {
		overall = "degraded"
	}

	status := http.StatusOK
	if overall == "degraded" {
		status = http.StatusServiceUnavailable
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(healthResponse{
		Status: overall,
		DB:     dbStatus,
		Uptime: time.Since(startTime).Round(time.Second).String(),
	})
}
