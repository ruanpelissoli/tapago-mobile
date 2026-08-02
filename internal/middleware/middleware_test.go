package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tapago/tapago-api/internal/middleware"
)

func TestRequestIDGeneratesWhenAbsent(t *testing.T) {
	var seen string
	h := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = middleware.RequestIDFrom(r.Context())
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if seen == "" {
		t.Fatal("expected a request id in the handler context")
	}
	if got := rec.Header().Get(middleware.RequestIDHeader); got != seen {
		t.Errorf("response header = %q, want %q", got, seen)
	}
}

func TestRequestIDPreservesInboundHeader(t *testing.T) {
	const inbound = "client-supplied-id"

	var seen string
	h := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = middleware.RequestIDFrom(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(middleware.RequestIDHeader, inbound)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if seen != inbound {
		t.Errorf("context id = %q, want %q", seen, inbound)
	}
	if got := rec.Header().Get(middleware.RequestIDHeader); got != inbound {
		t.Errorf("response header = %q, want %q", got, inbound)
	}
}

func TestRequestIDFromEmptyContext(t *testing.T) {
	if got := middleware.RequestIDFrom(httptest.NewRequest(http.MethodGet, "/", nil).Context()); got != "" {
		t.Errorf("RequestIDFrom() = %q, want empty string", got)
	}
}

func TestRecovererReturnsJSON500(t *testing.T) {
	h := middleware.Recoverer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	// The panic value must never reach the client.
	if body["error"] != "internal server error" {
		t.Errorf("error = %q, want %q", body["error"], "internal server error")
	}
}

func TestRecovererPassesThroughErrAbortHandler(t *testing.T) {
	h := middleware.Recoverer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(http.ErrAbortHandler)
	}))

	defer func() {
		if rec := recover(); rec != http.ErrAbortHandler {
			t.Errorf("recovered %v, want http.ErrAbortHandler to propagate", rec)
		}
	}()

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestLoggerPassesResponseThrough(t *testing.T) {
	h := middleware.Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("short and stout"))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
	if rec.Body.String() != "short and stout" {
		t.Errorf("body = %q", rec.Body.String())
	}
}
