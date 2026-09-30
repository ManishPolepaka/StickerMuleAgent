package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL / DIRECT_URL is empty")
	}
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 8
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping supabase/postgres: %w", err)
	}
	return pool, nil
}

type HealthStats struct {
	OK         bool   `json:"ok"`
	LatencyMs  int64  `json:"latencyMs"`
	Customers  int64  `json:"customers"`
	Orders     int64  `json:"orders"`
	Tasks      int64  `json:"tasks"`
	OpenTickets int64 `json:"openTickets"`
	Error      string `json:"error,omitempty"`
	Database   string `json:"database"`
}

func ValidateSupabase(ctx context.Context, pool *pgxpool.Pool) HealthStats {
	start := time.Now()
	stats := HealthStats{Database: "supabase/postgres"}
	err := pool.QueryRow(ctx, `select 1`).Scan(new(int))
	if err != nil {
		stats.Error = err.Error()
		stats.LatencyMs = time.Since(start).Milliseconds()
		return stats
	}
	_ = pool.QueryRow(ctx, `select count(*) from "Customer"`).Scan(&stats.Customers)
	_ = pool.QueryRow(ctx, `select count(*) from "Order"`).Scan(&stats.Orders)
	_ = pool.QueryRow(ctx, `select count(*) from "AgentTask"`).Scan(&stats.Tasks)
	_ = pool.QueryRow(ctx, `select count(*) from "SupportTicket" where status = 'open'`).Scan(&stats.OpenTickets)
	stats.OK = true
	stats.LatencyMs = time.Since(start).Milliseconds()
	return stats
}
