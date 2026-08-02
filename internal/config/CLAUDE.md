# internal/config

## Purpose

Loads and validates every runtime setting from environment variables into a
single `Config` struct, so the rest of the codebase never calls `os.Getenv`.

## Key decisions

- **No config library.** `os.Getenv` only, per the bootstrap task. The startup
  path stays obvious and the module keeps zero config dependencies. Revisit if
  this grows past a handful of values or needs file/flag layering.
- **`Load` returns an error rather than exiting.** The caller (`cmd/api`) owns
  the process lifecycle, and tests can exercise the failure paths without
  subprocess tricks.
- **Port is validated at load time,** not left to `net/http`. A bad `PORT` would
  otherwise surface as a confusing listen error *after* the database connection
  had already succeeded — slow, and misleading in logs.
- **Timeouts live here as exported constants** rather than being hardcoded in
  `main`, so tests can assert against them and there is one place to tune.

## Business logic

- `DATABASE_URL` is **required** — empty or unset is an error naming the
  variable and pointing at `.env.example`.
- `PORT` defaults to `8080`; must parse as an integer in 1–65535.
- `JWT_SECRET` is optional *at this stage*. It is read and carried through, but
  auth does not exist yet. When auth lands, decide whether a missing secret
  should become fatal — it probably should.
- `getenv` treats empty-string as unset, so `PORT=` falls back to the default
  instead of producing an invalid `":"` address.

## Dependencies

Stdlib only. Imported by `cmd/api`.

## Gotchas

- `Config.Port` is a `string`, not an `int` — it is only ever concatenated into
  an address by `Addr()`. Validation converts it just to check the range.
- Tests use `t.Setenv`, which forbids `t.Parallel()` in the same test.
