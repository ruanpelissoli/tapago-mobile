# internal/handler

## Purpose

Shared JSON response helpers for every HTTP handler. Concrete handlers live in
subpackages (`health/`, `auth/`, ...); this package holds only what they all use.

## Key decisions

- **Marshal fully, *then* write the status.** If encoding fails we can still
  send a real 500. Streaming straight into the `ResponseWriter` (as
  `json.NewEncoder(w).Encode` does) would leave a truncated body behind an
  already-committed 200 — unrecoverable and very hard to debug from the client.
- **One error shape for the whole API** (`{"error": "..."}`), so clients parse
  exactly one thing on failure. Extend this struct rather than inventing a
  second shape.
- **Handlers are constructed by a `Handler()` / `New()` function** returning
  `http.HandlerFunc`, so dependencies are captured in a closure or struct
  instead of package globals.
- **`Content-Type` is set before `WriteHeader`.** Headers written after the
  status code are silently discarded by `net/http`.

## Subpackages

- `health/` — `GET /health`. **Liveness only**: reports the process is up and
  deliberately does *not* touch the database. Conflating liveness with readiness
  makes orchestrators restart a perfectly healthy process whenever a downstream
  blips. Add a separate readiness endpoint if dependency checks are needed.
- `auth/` — stub. The struct and constructor exist so the package path resolves;
  registration/login/refresh land in a later task. Dependencies (pool, JWT
  secret) go through the `Handler` struct, not globals, to stay testable.

## Business logic

- A failed body write means the client hung up — logged at debug level, since
  there is nothing to salvage and it is not a server fault.

## Dependencies

Stdlib only. Imported by `internal/middleware`, `internal/router`, and the
handler subpackages.

## Gotchas

- `WriteJSON` takes `*http.Request` purely to pull the context for logging —
  it never reads the body.
- The fallback path uses `http.Error`, which sets `Content-Type: text/plain`
  even though the body is JSON. It is unreachable in practice (only a
  non-marshalable type triggers it); fix it if a handler ever passes dynamic
  `any` values.
