package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/agent"
	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	Pool   *pgxpool.Pool
	Runner *agent.Runner
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /v1/supabase/validate", s.validate)
	mux.HandleFunc("POST /v1/tasks/{id}/run", s.runTask)
	return mux
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	stats := db.ValidateSupabase(r.Context(), s.Pool)
	writeJSON(w, statusFromOK(stats.OK), map[string]any{
		"service": "go-agent-worker",
		"time":    time.Now().UTC(),
		"db":      stats,
	})
}

func (s *Server) validate(w http.ResponseWriter, r *http.Request) {
	stats := db.ValidateSupabase(r.Context(), s.Pool)
	writeJSON(w, statusFromOK(stats.OK), stats)
}

func (s *Server) runTask(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "task id required"})
		return
	}

	// Detach from request context so the job survives after HTTP returns.
	go func(taskID string) {
		ctx, cancel := context.WithTimeout(context.Background(), s.Runner.Timeout+30*time.Second)
		defer cancel()
		if err := s.Runner.RunTask(ctx, taskID); err != nil {
			log.Printf("task %s failed: %v", taskID, err)
		} else {
			log.Printf("task %s finished", taskID)
		}
	}(id)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"accepted": true,
		"taskId":   id,
		"worker":   "go",
	})
}

func statusFromOK(ok bool) int {
	if ok {
		return http.StatusOK
	}
	return http.StatusServiceUnavailable
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
