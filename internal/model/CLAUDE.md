# internal/model

## Purpose

Domain types that map to database rows. Plain data — no behaviour, no database
access, no ORM.

## Key decisions

- **Structs are dumb.** Queries live alongside the handlers that need them so
  the SQL stays visible at the call site. This package must never import
  `internal/db` — that would invert the dependency direction and make models
  untestable without a database.
- **No ORM and no generated code,** per the bootstrap decision. Raw SQL scanned
  into these structs.
- **`PasswordHash` is tagged `json:"-"`.** A credential must be impossible to
  leak even if a handler carelessly marshals a whole `User`. Any future secret
  field (refresh tokens, TOTP seeds) gets the same treatment — this is the
  invariant to preserve when extending the type.
- **`ID` is a `string`,** not `uuid.UUID`, to avoid pulling a UUID dependency
  into the domain layer at bootstrap. Revisit if ID validation moves into the
  model.

## Business logic

- `User` is a registered Tapago account. Email is expected to be unique — that
  constraint belongs in the schema migration, not here.
- JSON tags are camelCase (`createdAt`) to match mobile client conventions;
  keep new fields consistent with that.

## Dependencies

Stdlib only (`time`). Will be imported by handler subpackages as they land.
Nothing imports it yet.

## Gotchas

- These structs are **not** the API response shape by default. If a response
  needs to differ from the row, define a separate response type in the handler
  package rather than adding presentation-only fields here.
- Field order matters if anything ever uses positional scanning; prefer named
  column scans so it does not.
