package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/agent"
	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/api"
	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/config"
	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/db"
	"github.com/joho/godotenv"
)

func main() {
	loadEnv()
	cfg := config.Load()
	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL or DIRECT_URL is required")
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("supabase connection failed: %v", err)
	}
	defer pool.Close()

	stats := db.ValidateSupabase(ctx, pool)
	if !stats.OK {
		log.Fatalf("supabase validation failed: %s", stats.Error)
	}
	log.Printf("supabase OK (%dms) customers=%d orders=%d tasks=%d openTickets=%d",
		stats.LatencyMs, stats.Customers, stats.Orders, stats.Tasks, stats.OpenTickets)

	if cfg.PreferSimulated {
		log.Printf("agent mode: simulated fallback (AGENT_PROVIDER=simulated or missing OPENAI_API_KEY)")
	} else {
		log.Printf("agent mode: OpenAI (%s) + Go Supabase tools", cfg.OpenAIModel)
	}

	runner := &agent.Runner{
		Pool:            pool,
		OpenAIKey:       cfg.OpenAIKey,
		OpenAIModel:     cfg.OpenAIModel,
		PreferSimulated: cfg.PreferSimulated,
		Timeout:         time.Duration(cfg.TimeoutSeconds) * time.Second,
	}
	srv := &api.Server{Pool: pool, Runner: runner}
	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("go agent worker listening on %s", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	fmt.Println("worker stopped")
}

func loadEnv() {
	// Prefer repo-root .env when running from /worker
	candidates := []string{".env", "../.env", filepath.Join("..", ".env")}
	for _, p := range candidates {
		if err := godotenv.Load(p); err == nil {
			log.Printf("loaded env from %s", p)
			return
		}
	}
}
