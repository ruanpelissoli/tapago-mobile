# Tapago API

HTTP API for Tapago, written in Go. Stdlib `net/http` with a [chi](https://github.com/go-chi/chi)
router and [pgx](https://github.com/jackc/pgx) for PostgreSQL — no framework, no ORM.

## Requirements

- Go 1.26 or newer
- A reachable PostgreSQL instance

## Configuration

Configuration comes from environment variables. Copy the template and fill it in:

```sh
cp .env.example .env
```

| Variable       | Required | Default | Description                                      |
| -------------- | -------- | ------- | ------------------------------------------------ |
| `PORT`         | no       | `8080`  | TCP port the HTTP server listens on              |
| `DATABASE_URL` | **yes**  | —       | PostgreSQL connection string                     |
| `JWT_SECRET`   | no       | —       | Signs JWT access tokens (consumed by a later task) |

The server reads the process environment directly and does **not** parse `.env` itself.
Export the values in your shell, or use a runner such as `direnv` or
`dotenv -- go run ./cmd/api`.

## Running locally

```sh
export DATABASE_URL='postgres://tapago:tapago@localhost:5432/tapago?sslmode=disable'
go run ./cmd/api
```

The server exits with a non-zero status and a clear log message if `DATABASE_URL`
is unset or if the startup database ping fails — it never serves traffic against a
database it could not reach.

Verify it is up:

```sh
curl -i localhost:8080/health
# HTTP/1.1 200 OK
# {"status":"ok"}
```

## Tests

```sh
go test ./...      # unit tests; no database required
go vet ./...
gofmt -l .         # no output means formatting is clean
```

Tests cover the failure paths only where a database would otherwise be needed.
Tests that talk to a live PostgreSQL belong in a separate integration suite behind
a build tag.

## Layout

```
cmd/api/            process entry point: config → database → listener
internal/config/    environment-variable loading and validation
internal/db/        PostgreSQL pool construction and startup ping
internal/router/    the single place that knows the full URL surface
internal/middleware/ request id, structured access logging, panic recovery
internal/handler/   shared JSON response helpers
  health/           GET /health
  auth/             stub; registration/login land in a later task
internal/model/     domain structs that map to database rows
```

Each directory carries a `CLAUDE.md` explaining the decisions behind it.

## Endpoints

| Method | Path      | Description                                        |
| ------ | --------- | -------------------------------------------------- |
| `GET`  | `/health` | Liveness probe. Returns `{"status":"ok"}`. No DB access. |

Application routes are versioned under `/v1` as they land. `/health` stays
unversioned — load balancers should not care about an API version.
