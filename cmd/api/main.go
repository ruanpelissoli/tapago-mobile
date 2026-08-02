// Command api is the Tapago HTTP API server.
//
// Startup order is deliberate: configuration, then database, then the listener.
// The process refuses to start serving traffic unless the database answered a
// ping, so an orchestrator sees a fast crash-loop instead of a "healthy"
// instance returning 500s.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/tapago/tapago-api/internal/config"
	"github.com/tapago/tapago-api/internal/db"
	"github.com/tapago/tapago-api/internal/router"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	// run owns every fallible step so deferred cleanup (closing the pool)
	// actually executes — os.Exit inside main would skip it.
	if err := run(); err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// NotifyContext cancels on SIGINT/SIGTERM. Wiring it before the database
	// connect means a Ctrl-C during a slow connect aborts immediately instead
	// of waiting out the connect timeout.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	slog.Info("database connected")

	srv := &http.Server{
		Addr:         cfg.Addr(),
		Handler:      router.New(router.Deps{Pool: pool, JWTSecret: cfg.JWTSecret}),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	// ListenAndServe blocks, so it runs on its own goroutine and reports a
	// genuine listen failure (port in use, for example) back through a channel.
	serveErr := make(chan error, 1)
	go func() {
		slog.Info("http server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
		slog.Info("shutdown signal received, draining connections")
	}

	// Fresh context: ctx is already cancelled by the signal, and passing a
	// cancelled context to Shutdown would kill in-flight requests instantly.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}

	slog.Info("server stopped cleanly")
	return nil
}
