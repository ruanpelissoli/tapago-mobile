// Package db owns the PostgreSQL connection pool.
//
// No ORM: queries elsewhere in the codebase are raw SQL executed through
// pgxpool.Pool, so the SQL that runs is the SQL you read.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool sizing defaults. Tuned for a small API instance; revisit alongside any
// real load testing rather than guessing higher.
const (
	DefaultMaxConns        = 10
	DefaultMinConns        = 2
	DefaultMaxConnLifetime = time.Hour
	DefaultMaxConnIdleTime = 30 * time.Minute

	// connectTimeout bounds the initial connect+ping so a wedged or
	// unreachable database fails startup fast instead of hanging a deploy.
	connectTimeout = 10 * time.Second
)

// Connect parses databaseURL, opens a pooled connection, and verifies it with a
// ping before returning. A non-nil error means the pool is unusable and has
// already been cleaned up — the caller should treat it as fatal at startup.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("database url is empty")
	}

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		// Wrapped without the URL itself: connection strings carry credentials
		// and this error is logged.
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	cfg.MaxConns = DefaultMaxConns
	cfg.MinConns = DefaultMinConns
	cfg.MaxConnLifetime = DefaultMaxConnLifetime
	cfg.MaxConnIdleTime = DefaultMaxConnIdleTime

	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	// pgxpool connects lazily, so NewWithConfig succeeding proves nothing about
	// reachability. Ping is what actually validates host, credentials, and TLS.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}
