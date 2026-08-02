// Package health exposes the service liveness endpoint.
package health

import (
	"net/http"

	"github.com/tapago/tapago-api/internal/handler"
)

// Response is the body returned by GET /health.
type Response struct {
	Status string `json:"status"`
}

// Handler serves GET /health.
//
// Liveness only: it reports that the process is up and serving, and
// deliberately does not touch the database. A readiness endpoint that checks
// dependencies can be added separately — conflating the two makes orchestrators
// restart a healthy process whenever a downstream blips.
func Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handler.WriteJSON(w, r, http.StatusOK, Response{Status: "ok"})
	}
}
