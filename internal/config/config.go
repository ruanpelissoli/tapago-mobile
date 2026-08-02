// Package config loads runtime configuration from environment variables.
//
// Deliberately dependency-free: os.Getenv only. If configuration grows past a
// handful of values, swap this for a real config library — until then the
// stdlib keeps the startup path obvious.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Default values applied when the corresponding environment variable is unset.
const (
	DefaultPort            = "8080"
	DefaultReadTimeout     = 15 * time.Second
	DefaultWriteTimeout    = 15 * time.Second
	DefaultIdleTimeout     = 60 * time.Second
	DefaultShutdownTimeout = 10 * time.Second
)

// Config holds every value the API needs to boot.
type Config struct {
	// Port is the TCP port the HTTP server listens on.
	Port string

	// DatabaseURL is the PostgreSQL connection string. Required.
	DatabaseURL string

	// JWTSecret signs and verifies auth tokens. Not required yet — auth lands
	// in a later task — but documented in .env.example so environments are
	// provisioned ahead of time.
	JWTSecret string

	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
}

// Load reads configuration from the environment.
//
// It returns an error — rather than exiting — so the caller owns the process
// lifecycle and tests can exercise the failure paths.
func Load() (*Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required but not set (see .env.example)")
	}

	port := getenv("PORT", DefaultPort)
	if err := validatePort(port); err != nil {
		return nil, err
	}

	return &Config{
		Port:            port,
		DatabaseURL:     databaseURL,
		JWTSecret:       os.Getenv("JWT_SECRET"),
		ReadTimeout:     DefaultReadTimeout,
		WriteTimeout:    DefaultWriteTimeout,
		IdleTimeout:     DefaultIdleTimeout,
		ShutdownTimeout: DefaultShutdownTimeout,
	}, nil
}

// Addr returns the listen address for the HTTP server.
func (c *Config) Addr() string {
	return ":" + c.Port
}

// getenv returns the value of key, or fallback when key is unset or empty.
func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// validatePort rejects values that would surface as a confusing net/http error
// only after the rest of startup (including the DB connection) had succeeded.
func validatePort(port string) error {
	n, err := strconv.Atoi(port)
	if err != nil {
		return fmt.Errorf("PORT must be a number, got %q", port)
	}
	if n < 1 || n > 65535 {
		return fmt.Errorf("PORT must be between 1 and 65535, got %d", n)
	}
	return nil
}
