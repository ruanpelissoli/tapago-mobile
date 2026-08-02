# internal/middleware

## Purpose

Cross-cutting HTTP middleware applied to every route: request identity,
structured access logging, and panic recovery.

## Key decisions

- **Hand-rolled instead of `chi/middleware`.** Two concrete reasons: the request
  id lives in a context key *this codebase owns* (so no other package can read
  or collide with it), and logging goes through `log/slog` like the rest of the
  service rather than chi's own logger interface.
- **An inbound `X-Request-ID` is trusted and reused.** One id can then be
  followed across the mobile client, any proxy, and this service. We only mint
  one when the header is absent. Note the trade-off below.
- **Logging happens on the way out only,** not on both ends. Half the volume,
  and status + latency — the reason the line exists — are only known afterwards.
- **`contextKey` is an unexported struct type,** not a string. Makes collisions
  with other packages' context values impossible.
- **`ErrAbortHandler` is re-panicked, not swallowed.** A client disconnecting
  mid-write surfaces as that panic and `net/http` expects it to propagate so the
  connection is torn down. Catching it would log a real fault for a routine
  client hangup.

## Business logic

- The recovered panic value is logged **server-side only**; the client gets a
  generic `"internal server error"`. Internals must never leak into a response.
- A panic must not take down the process or other in-flight requests.
- `statusRecorder` defaults to 200: a handler that writes without calling
  `WriteHeader` implies 200, and the log must reflect that.

## Dependencies

Stdlib plus `internal/handler` (for the shared JSON error shape). Imported by
`internal/router`.

## Gotchas

- **Trusting inbound `X-Request-ID` means clients can set it.** Fine for
  correlation; do not use it for anything security-sensitive, and consider
  stripping it at the edge proxy if untrusted traffic reaches the service.
- `statusRecorder` does not implement `http.Flusher`, `http.Hijacker`, or
  `io.ReaderFrom`. Wrapping breaks SSE, WebSocket upgrades, and `sendfile`
  optimisation — add the pass-through methods before adding streaming endpoints.
- `WriteHeader` ignores repeat calls to keep the logged status equal to the one
  actually sent.
