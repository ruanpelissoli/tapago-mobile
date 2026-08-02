// Package auth will hold the registration, login, and token-refresh handlers.
//
// Stubbed out now so the package path exists and imports resolve; the routes
// are wired in a later task. Handlers here take their dependencies (pool,
// JWT secret) through the Handler struct rather than package-level globals so
// they stay testable.
package auth

import "github.com/jackc/pgx/v5/pgxpool"

// Handler carries the dependencies shared by the auth endpoints.
type Handler struct {
	pool      *pgxpool.Pool
	jwtSecret string
}

// New builds an auth Handler.
func New(pool *pgxpool.Pool, jwtSecret string) *Handler {
	return &Handler{pool: pool, jwtSecret: jwtSecret}
}
