# internal/db

## Purpose

Builds and validates the PostgreSQL connection pool. The single place that knows
how the application talks to Postgres.

## Key decisions

- **`pgxpool` over `database/sql`.** pgx's native interface keeps Postgres types
  (arrays, JSONB, `uuid`) usable without driver gymnastics. No ORM by design —
  queries elsewhere are raw SQL, so the SQL that runs is the SQL you read.
- **Ping on startup is mandatory.** `pgxpool.NewWithConfig` connects *lazily*, so
  it succeeding proves nothing about reachability. `Ping` is what actually
  validates host, credentials, and TLS. Without it the process would start
  "healthy" and fail on the first real request.
- **`connectTimeout` (10s) bounds connect+ping** so an unreachable or wedged
  database fails the deploy fast instead of hanging it indefinitely.
- **Parse errors are wrapped without the URL.** Connection strings carry
  credentials and this error gets logged — never interpolate `databaseURL` into
  an error or log line.
- **Pool sizing is conservative** (max 10 / min 2), tuned for a small instance.
  Raise it against real load measurements, not intuition — Postgres has a hard
  `max_connections` and every API replica multiplies this number.

## Business logic

- A non-nil error means the pool is unusable **and already closed**; the caller
  must not call `Close` on it. Callers treat this as fatal at startup.
- Empty `databaseURL` is rejected before parsing, so the error is clear rather
  than a cryptic pgx parse failure.

## Dependencies

`github.com/jackc/pgx/v5/pgxpool`. Imported by `cmd/api`, and by `internal/router`
and `internal/handler/auth` for the pool type.

## Gotchas

- `Connect` derives a timeout context internally; the caller's `ctx` is still
  honoured for cancellation (a cancelled parent aborts immediately).
- Tests here only cover failure paths so they run without a live Postgres.
  Anything needing a real database belongs in an integration suite behind a
  build tag.
