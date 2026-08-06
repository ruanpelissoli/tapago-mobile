# src/services/ — app services and configuration

## Purpose
Non-UI infrastructure: environment config now, API client and storage later.

## env.ts

### Purpose
Resolves runtime configuration into typed constants. `API_BASE_URL` is the one value
that exists today.

### How the value flows
`.env` → `app.config.ts` (`extra.apiBaseUrl`) → app manifest → `expo-constants` → here.

Expo loads `.env` automatically before evaluating `app.config.ts`, so no `dotenv`
dependency is needed. `app.json` holds the static metadata; `app.config.ts` spreads it
and layers on the environment-derived `extra` block.

### Key decisions
- **Read via `expo-constants`, with `process.env.EXPO_PUBLIC_*` as fallback.** Expo
  inlines `EXPO_PUBLIC_`-prefixed vars into the bundle *and* exposes them through the
  manifest. Preferring the manifest keeps config in one place; the fallback keeps unit
  tests and any non-manifest context working.
- **Resolved once at module load into `const`s**, not a `getConfig()` call. Config
  cannot change at runtime, so a function would imply mutability that doesn't exist.
- **Trailing slashes are stripped** at the boundary, so callers can always write
  `` `${API_BASE_URL}/v1/foo` `` without producing a double slash.
- **A default is baked in** (`http://localhost:5000`) so a fresh clone boots with no
  `.env` at all. Config problems should show up as a failed request, not a crash at import.

### Business logic / invariants
- `API_BASE_URL` never ends in `/`.
- Anything prefixed `EXPO_PUBLIC_` is compiled into the shipped bundle and is trivially
  readable by anyone with the app. **Never put a secret in `.env` or in `extra`.**
- `.env` is gitignored; `.env.example` is the committed documentation of what's needed.

### Dependencies
`expo-constants`, and `app.config.ts` at the repo root. Nothing imports this yet — the
API client task is its first consumer.

### Gotchas
- Editing `.env` requires restarting the dev server with a cleared cache
  (`npx expo start --clear`); values are inlined at bundle time, not read live.
- `localhost` does not resolve from an Android emulator — it needs `10.0.2.2`. This is
  noted in `.env.example` and is the most common "why can't the app reach the API".
