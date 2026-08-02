// Package router wires handlers, middleware, and routes into a single
// http.Handler.
//
// This is the one place that knows the full URL surface of the API. Handlers
// stay ignorant of their own paths, which keeps them reusable and makes the
// route table readable in a single screen.
package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tapago/tapago-api/internal/handler"
	"github.com/tapago/tapago-api/internal/handler/health"
	"github.com/tapago/tapago-api/internal/middleware"
)

// Deps are the dependencies routes need. Passed explicitly instead of reaching
// for package-level globals so tests can build a router with fakes.
type Deps struct {
	// Pool is the database pool. Nil is allowed — /health does not touch the
	// database, so a router can be built without one in tests.
	Pool *pgxpool.Pool

	// JWTSecret signs auth tokens. Unused until the auth routes land.
	JWTSecret string
}

// New builds the application router.
func New(deps Deps) http.Handler {
	r := chi.NewRouter()

	// Order matters: RequestID first so every later log line and error carries
	// the id, Recoverer inside Logger so a panic is still logged as a 500
	// response rather than vanishing from the access log.
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		handler.WriteError(w, r, http.StatusNotFound, "resource not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		handler.WriteError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	})

	// Unversioned on purpose: /health is infrastructure, consumed by load
	// balancers and orchestrators that should never care about an API version.
	r.Get("/health", health.Handler())

	// Versioned application routes mount under /v1 in later tasks, e.g.
	//   r.Route("/v1", func(r chi.Router) { r.Mount("/auth", auth.Routes(...)) })
	// Left unmounted for now: chi resolves an empty subrouter to a 404 with an
	// empty body, which would bypass the JSON NotFound handler above.

	return r
}
