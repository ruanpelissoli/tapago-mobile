// Package middleware holds the cross-cutting HTTP middleware applied to every
// route: request identity, structured access logging, and panic recovery.
//
// These are hand-rolled rather than pulled from chi/middleware so the request
// ID lives in a context key this codebase owns, and so logging goes through
// log/slog like the rest of the service instead of chi's logger interface.
package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"

	"github.com/tapago/tapago-api/internal/handler"
)

// contextKey is unexported so no other package can collide with our keys.
type contextKey struct{ name string }

var requestIDKey = &contextKey{name: "request-id"}

// RequestIDHeader is the header read on the way in and echoed on the way out.
const RequestIDHeader = "X-Request-ID"

// RequestID attaches a request identifier to the context and the response.
//
// An inbound X-Request-ID is trusted and reused so a single id can be followed
// across the mobile client, any proxy, and this service. Only when the header
// is absent do we mint one.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if id == "" {
			id = newRequestID()
		}

		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

// RequestIDFrom returns the request id stored in ctx, or "" when unset.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// Logger emits one structured line per request once the handler returns.
//
// Logging on the way out (rather than on both ends) keeps volume down while
// still capturing status and latency, which is what the line is actually for.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(rec, r)

		slog.InfoContext(r.Context(), "http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"bytes", rec.written,
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", RequestIDFrom(r.Context()),
		)
	})
}

// Recoverer turns a panicking handler into a 500 JSON response.
//
// A panic in one request must not take down the process and every other
// in-flight request with it. The recovered value is logged server-side only —
// the client gets a generic message so internals never leak.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}

			// The client disconnecting mid-write surfaces as a panic with
			// http.ErrAbortHandler; net/http expects it to propagate so the
			// connection is torn down without logging it as a server fault.
			if rec == http.ErrAbortHandler {
				panic(rec)
			}

			slog.ErrorContext(r.Context(), "panic recovered",
				"panic", rec,
				"method", r.Method,
				"path", r.URL.Path,
				"request_id", RequestIDFrom(r.Context()),
			)

			handler.WriteError(w, r, http.StatusInternalServerError, "internal server error")
		}()

		next.ServeHTTP(w, r)
	})
}

// statusRecorder captures the status code and body size for the access log,
// which the stdlib ResponseWriter does not expose.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written int
	wrote   bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if s.wrote {
		return
	}
	s.status = status
	s.wrote = true
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	// A handler that writes without calling WriteHeader implies 200.
	if !s.wrote {
		s.wrote = true
	}
	n, err := s.ResponseWriter.Write(b)
	s.written += n
	return n, err
}

// newRequestID returns a 16-character hex id.
//
// crypto/rand.Read never returns an error on any supported platform (it panics
// internally on catastrophic failure), so the error is intentionally dropped
// rather than failing a request over an identifier.
func newRequestID() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
