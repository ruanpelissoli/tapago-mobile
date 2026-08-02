# cmd/api

## Purpose

The process entry point. Owns startup ordering, signal handling, and graceful
shutdown. Everything else in the codebase is a library this wires together.

## Key decisions

- **`main` delegates to `run() error`.** `os.Exit` skips deferred functions, so
  calling it inside `main` would leak the database pool on every failure path.
  `run` returns an error, `main` logs it and exits non-zero — deferred cleanup
  still executes.
- **Startup order is config → database → listener.** The process refuses to bind
  a port unless the database answered a ping. An orchestrator then sees a fast
  crash-loop instead of a "healthy" instance serving 500s.
- **`signal.NotifyContext` is wired before the DB connect,** not after. A Ctrl-C
  during a slow connect aborts immediately rather than waiting out the 10s
  connect timeout.
- **`ListenAndServe` runs on its own goroutine** reporting through a buffered
  channel. It blocks, so the main flow needs to select between "the listener
  failed" (port in use) and "a shutdown signal arrived".
- **`Shutdown` gets a fresh context,** deliberately not `ctx`. By that point
  `ctx` is already cancelled by the signal, and handing a cancelled context to
  `Shutdown` would kill in-flight requests instantly instead of draining them.
- **`slog` JSON handler to stdout.** Structured logs for log aggregation; stdout
  because containers collect it.

## Business logic

- A missing `DATABASE_URL` or a failed ping is fatal, by requirement. Exit code
  must be non-zero and the log line must name the cause.
- Shutdown drains for `cfg.ShutdownTimeout` (10s) before giving up.

## Dependencies

Imports `internal/config`, `internal/db`, and `internal/router`. Nothing imports
this package.

## Gotchas

- The buffered channel (`make(chan error, 1)`) matters: on the shutdown path
  nobody reads it, and an unbuffered send would leak the goroutine forever.
- `srv.ListenAndServe` returns `http.ErrServerClosed` on a normal shutdown —
  that is success, not an error, hence the `errors.Is` check.
