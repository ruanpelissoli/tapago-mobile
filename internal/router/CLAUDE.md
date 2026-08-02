# internal/router

## Purpose

Wires middleware, handlers, and routes into one `http.Handler`. The single place
that knows the full URL surface of the API.

## Key decisions

- **chi over stdlib `ServeMux` or a framework.** chi is `http.Handler` all the
  way down — middleware, subrouters, and `MethodNotAllowed` come free, with no
  framework lock-in. Handlers stay plain `http.HandlerFunc`.
- **Handlers do not know their own paths.** The route table is readable on one
  screen and handlers stay reusable/testable in isolation.
- **Dependencies arrive via `Deps`, not package globals,** so tests can build a
  real router with fakes or zero values.
- **Middleware order is deliberate:** `RequestID` → `Logger` → `Recoverer`.
  RequestID first so every later log line carries the id; Recoverer *inside*
  Logger so a panic is still recorded in the access log as a 500 rather than
  vanishing from it.
- **`NotFound`/`MethodNotAllowed` are overridden** to emit the API's JSON error
  shape. chi's defaults return plain text, which would force clients to handle
  two different error formats.
- **`/health` is unversioned.** It is infrastructure, consumed by load balancers
  and orchestrators that should never care about an API version.

## Business logic

- `Deps.Pool` may be nil. `/health` is a liveness probe and must not touch the
  database, so a nil pool is valid — the router test relies on this as a
  regression guard.

## Dependencies

chi, pgxpool (for the type), `internal/handler`, `internal/handler/health`,
`internal/middleware`. Imported by `cmd/api`.

## Gotchas

- **Do not mount an empty `/v1` subrouter.** chi resolves an empty subrouter to
  a 404 with an empty body, bypassing the JSON `NotFound` handler. Add the
  `r.Route("/v1", ...)` block only when the first real route lands.
- Adding a route means adding it here — there is no auto-registration.
