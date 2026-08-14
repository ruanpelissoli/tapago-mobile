# src/services/ — app services and configuration

## Purpose
Non-UI infrastructure: environment config, the API transport, authentication, and
device storage.

- `env.ts` — runtime configuration resolved from `.env`.
- `apiClient.ts` — thin JSON transport over `fetch`.
- `authService.ts` — sign-in against the API, including social token exchange.
- `sessionStorage.ts` — persists the auth session to `expo-secure-store`.

## env.ts

### Purpose
Resolves runtime configuration into typed constants: `API_BASE_URL` and the three Google
OAuth client IDs.

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
- **Google client IDs default to `''`, and empty means "not configured".**
  `GOOGLE_SIGN_IN_ENABLED` derives from that and hides the button, so an unconfigured
  build shows no dead control. It is deliberately *not* per-platform:
  `expo-auth-session` falls back to the web client ID when a native one is missing,
  which is the documented Expo Go path.

### Business logic / invariants
- `API_BASE_URL` never ends in `/`.
- Anything prefixed `EXPO_PUBLIC_` is compiled into the shipped bundle and is trivially
  readable by anyone with the app. **Never put a secret in `.env` or in `extra`.**
- `.env` is gitignored; `.env.example` is the committed documentation of what's needed.

### Dependencies
`expo-constants`, and `app.config.ts` at the repo root. Consumed by `apiClient.ts` and
`useGoogleSignIn.ts`.

### Gotchas
- Editing `.env` requires restarting the dev server with a cleared cache
  (`npx expo start --clear`); values are inlined at bundle time, not read live.
- `localhost` does not resolve from an Android emulator — it needs `10.0.2.2`. This is
  noted in `.env.example` and is the most common "why can't the app reach the API".
- A Google client ID must *also* be listed in the backend's `GOOGLE_CLIENT_IDS`. The ID
  the app authenticates with becomes the token's `aud` claim, and the API rejects an
  audience it does not know with `401 invalid social token`.

## apiClient.ts

### Purpose
`postJson(path, body, signal)` — the one way this app talks to the API.

### Key decisions
- **`fetch`, not axios.** A handful of calls, no interceptor or retry needs; a client
  library would be bundle weight for nothing.
- **Two error types, split by what the user should be told.** `ApiError` carries an HTTP
  `status` plus the API's machine-readable `error` string; `NetworkError` means the round
  trip failed. "The server said no" and "you're offline" need different copy, and callers
  shouldn't have to sniff messages to tell them apart.
- **This layer never produces user-facing text.** It reports what happened; mapping to
  copy is `authService.describeSocialAuthError`'s job. Keeping that split means one place
  to review the wording.
- **Every request has a 15s timeout**, combined with any caller-supplied `AbortSignal`,
  so a hung socket cannot leave a screen spinning forever.

### Business logic / invariants
- A non-2xx reply always throws — success paths never have to check `response.ok`.
- A 2xx body that is not valid JSON is a `NetworkError`: from the caller's side the round
  trip did not deliver, whatever the status line said.

### Gotchas
- The timeout aborts through the same controller as the caller's signal, so a caller
  cannot distinguish "I cancelled" from "it timed out" — both surface as `NetworkError`.
- No `Authorization` header is attached yet. When authenticated endpoints land, add it
  here from the auth context rather than at each call site.

## authService.ts

### Purpose
Sign-in against the API. Today: exchanging Google and Apple ID tokens for a TaPago JWT.
`register`/`login` for email + password belong here too.

### Key decisions
- **Social sign-in is a token exchange, not an OAuth implementation.** The provider SDK
  owns the entire consent flow and hands back an ID token; this module only trades that
  token at `POST /auth/google` or `POST /auth/apple`. Verification happens server-side
  against the provider's JWKS — the app never validates a provider token and must never
  treat one as proof of identity on its own.
- **Cancellation is a result, not an error.** `SocialSignInResult` has a distinct
  `cancelled` case so screens cannot accidentally show an error message to a user who
  simply closed the sheet. This is the single most common social-auth UX bug.
- **`exchangeIdTokenAsResult` is the shared tail of both providers**, so screens never
  need a try/catch and both flows are guaranteed to report failures the same way.
- **The API response is parsed, not cast.** `parseAuthSession` rejects a malformed body
  rather than letting `undefined` reach the auth context and produce a signed-in state
  with no token.
- **Only the ID token is forwarded for Apple.** Apple returns the user's real name *only
  on the first authorisation ever*, and never again; letting the API own that decision
  avoids a reinstall overwriting a stored name with a blank one.

### Business logic / invariants
- Error copy is exhaustive by status: 400/401/409/503 each get their own message, per the
  API contract. 409 in particular must not read as "wrong password" — it means the email
  belongs to a different provider account, and the user needs to be told to sign in the
  way they did originally.
- `signInWithApple` must only be called on iOS; `isAppleSignInAvailable()` gates it.
- Raw error text is never surfaced to users.

### Dependencies
`expo-apple-authentication`, `apiClient.ts`. Consumed by `app/(auth)/sign-in.tsx`,
`src/hooks/useGoogleSignIn.ts`, and `src/hooks/useAuth.tsx` (for its types).

### Gotchas
- Apple signals cancellation with `code === 'ERR_REQUEST_CANCELED'` on the thrown error.
  That property is not in the public type, so the check is structural — a refactor that
  "cleans up" the cast will silently turn cancellations back into error banners.
- `credential.identityToken` is typed nullable and is `null` when the Apple Sign-In
  entitlement is missing from the build. That is a config problem, not a user problem.
- Google's half of the flow is *not* here: it must live in a hook. See
  `src/hooks/CLAUDE.md`.

## sessionStorage.ts

### Purpose
Reads, writes and deletes the persisted auth session so a signed-in user survives an
app restart. `AUTH_SESSION_KEY`, `parseStoredSession`, `loadStoredSession`,
`saveStoredSession`, `clearStoredSession`.

### Key decisions
- **`expo-secure-store`, never `AsyncStorage`.** A JWT must not sit in plaintext on the
  device. Default keychain / Android-keystore behaviour is used, so no `plugins` entry
  in the Expo config is required.
- **The whole session is stored as one JSON value under one key.** `AuthState.user` has
  to survive a restart and there is no way to re-fetch it — `apiClient` exposes only
  `postJson` and the API has no `/auth/me`. Storing the bare token would force a new
  endpoint or client-side JWT decoding. One key, one write also means the token and the
  user can never disagree — the invariant `useAuth` exists to protect.
- **Key is `auth_session`, not `auth_token`,** because the value is the whole session.
- **This module never rejects.** Storage being unavailable is not a reason to fail a
  sign-in or strand the app on a splash screen. Callers treat it as best-effort; a
  failure degrades to in-memory-only behaviour for the life of the process.
- **Restore is optimistic — expiry is not checked and the JWT is not decoded.** Nothing
  attaches an `Authorization` header yet, so a restored-but-expired token costs nothing.
  Clearing on a `401` is a later task.
- **`parseStoredSession` is pure and exported**, so it is the first thing covered when a
  test runner lands.

### Business logic / invariants
- Parsing mirrors `authService.parseAuthSession`: nothing is cast, `token` must be a
  non-empty string, `user.id`/`email`/`name` must all be strings, and the result is
  freshly constructed from the validated fields. A session with a missing token or user
  must never reach the auth context.
- A stored value that fails validation is **deleted**, so a corrupt key cannot fail again
  on every subsequent launch.
- **Nothing logged ever contains the value or the caught error** — only the fixed
  `STORAGE_WARNING` string. SecureStore errors on some platforms echo back the value they
  failed to handle, which would put the JWT in the log. Do not "improve" the catch blocks
  by interpolating the error.

### Dependencies
`expo-secure-store`, and `authService.ts` for the `AuthSession` type. Consumed only by
`src/hooks/useAuth.tsx`.

### Gotchas
- iOS keychain warns above ~2048 bytes per value. A JWT plus three short user fields is
  well inside that, but the ceiling exists if a future task stuffs more into the session.
- `expo-secure-store` is a native module. An existing dev client built before it was added
  will not have it; rebuild, and restart the bundler with `npx expo start --clear`.
- `app.json` `platforms` is `["ios", "android"]`, so there is no web fallback here. Adding
  web would need one — `SecureStore` is unavailable in a browser.
