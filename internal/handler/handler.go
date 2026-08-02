// Package handler holds response helpers shared by every HTTP handler in the
// API. Concrete handlers live in subpackages (health, auth, ...).
package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// ErrorResponse is the single error shape the API returns, so clients only ever
// parse one thing when a request fails.
type ErrorResponse struct {
	Error string `json:"error"`
}

// WriteJSON writes v as JSON with the given status code.
//
// The body is marshalled before the status is written: if encoding fails we can
// still send a 500, whereas streaming straight into the ResponseWriter would
// leave a truncated body behind an already-committed 200.
func WriteJSON(w http.ResponseWriter, r *http.Request, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.ErrorContext(r.Context(), "encode json response", "error", err, "path", r.URL.Path)
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)

	// A write failure here means the client hung up; nothing left to salvage.
	if _, err := w.Write(body); err != nil {
		slog.DebugContext(r.Context(), "write response body", "error", err, "path", r.URL.Path)
	}
}

// WriteError writes a JSON error body with the given status code.
func WriteError(w http.ResponseWriter, r *http.Request, status int, message string) {
	WriteJSON(w, r, status, ErrorResponse{Error: message})
}
