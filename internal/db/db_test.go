package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/tapago/tapago-api/internal/db"
)

// These tests cover the failure paths only — they never reach a real database,
// so they stay runnable in CI without a Postgres service. Connecting against a
// live instance belongs in an integration suite behind a build tag.

func TestConnectRejectsEmptyURL(t *testing.T) {
	pool, err := db.Connect(context.Background(), "")
	if err == nil {
		pool.Close()
		t.Fatal("expected an error for an empty database url")
	}
}

func TestConnectRejectsMalformedURL(t *testing.T) {
	pool, err := db.Connect(context.Background(), "://not-a-url")
	if err == nil {
		pool.Close()
		t.Fatal("expected an error for a malformed database url")
	}
	if !strings.Contains(err.Error(), "parse database url") {
		t.Errorf("error = %q, want it to mention parsing", err)
	}
}

func TestConnectHonoursCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	pool, err := db.Connect(ctx, "postgres://user:pass@127.0.0.1:1/tapago")
	if err == nil {
		pool.Close()
		t.Fatal("expected an error when the context is already cancelled")
	}
}
