# src/services/ — app services and configuration

## Purpose
Non-UI infrastructure: environment config, the API transport, authentication, and
device storage.

- `env.ts` — runtime configuration resolved from `.env`.
- `apiClient.ts` — thin JSON transport over `fetch`.
- `authService.ts` — sign-in against the API, including social token exchange.
- `sessionStorage.ts` — persists the auth session to `expo-secure-store`.
- `bets.ts` — create and read the user's one in-flight bet.
- `paymentMethods.ts` — save and list tokenised cards.
- `mercadoPago.ts` — the card-entry page and bridge protocol used to tokenise a card.

## env.ts

### Purpose
Resolves runtime configuration into typed constants: `API_BASE_URL`, the three Google
OAuth client IDs, and `MERCADO_PAGO_PUBLIC_KEY`.

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
- **`MERCADO_PAGO_PUBLIC_KEY` is the *public* key** (`TEST-…` in sandbox, `APP_USR-…` in
  production). It is designed to be embedded in a client — all it can do is exchange card
  details for a single-use token. Its server-side counterpart,
  `MERCADOPAGO_ACCESS_TOKEN`, is a **secret that belongs to the API only** and must never
  appear in `.env`, `app.config.ts` or anywhere in this repo. The `mercadopago` npm
  package is the server SDK for exactly that reason and is deliberately not a dependency.
- **Empty means "card entry is not configured"**, and `MERCADO_PAGO_ENABLED` derives from
  it — the wallet disables "Add card" with an explanation rather than opening a form that
  can only fail. Same shape as `GOOGLE_SIGN_IN_ENABLED`.

### Business logic / invariants
- `API_BASE_URL` never ends in `/`.
- Anything prefixed `EXPO_PUBLIC_` is compiled into the shipped bundle and is trivially
  readable by anyone with the app. **Never put a secret in `.env` or in `extra`.**
- `.env` is gitignored; `.env.example` is the committed documentation of what's needed.

### Dependencies
`expo-constants`, and `app.config.ts` at the repo root. Consumed by `apiClient.ts`,
`useGoogleSignIn.ts` and `app/(app)/wallet.tsx`.

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
`postJson(path, body, signalOrOptions)` and `getJson(path, signalOrOptions)` — the one
way this app talks to the API. Also owns the `Authorization` header.

### Key decisions
- **`fetch`, not axios.** A handful of calls, no interceptor or retry needs; a client
  library would be bundle weight for nothing.
- **Two error types, split by what the user should be told.** `ApiError` carries an HTTP
  `status` plus the API's machine-readable `error` string; `NetworkError` means the round
  trip failed. "The server said no" and "you're offline" need different copy, and callers
  shouldn't have to sniff messages to tell them apart. `NetworkError.status` is `0`, so
  *every* thrown error uniformly has `status` + `message`, but the two stay **separate
  classes**: making `NetworkError` extend `ApiError` would make the several
  `instanceof ApiError` status switches silently start matching offline failures.
  `ApiFailure` is the exported union for typing a catch.
- **The token arrives via a registered getter, not a parameter.** `setAuthTokenProvider`
  takes a `() => string | null` that `useAuth.tsx` registers at import time. A hook can't
  be read from a plain module, and a captured *value* would go stale on sign-in, sign-out
  and restore — hence a getter. Call sites just pass `auth: true`.
- **An authenticated call with no token throws `ApiError(401, 'not_authenticated')`
  before the network.** Being signed out at that point is a wiring bug (a screen rendered
  outside the auth guard); spending a user's connection to be told 401 helps nobody.
- **This layer never produces user-facing text.** It reports what happened; mapping to
  copy is each service's `describe*Error` job. One place per domain owns the wording.
- **Every request has a 15s timeout**, combined with any caller-supplied `AbortSignal`,
  so a hung socket cannot leave a screen spinning forever. `timeoutMs` overrides it for
  a known-slow endpoint (`createBet` uses 30s for the provider round trip).

### Business logic / invariants
- A non-2xx reply always throws — success paths never have to check `response.ok`.
- A 2xx body that is not valid JSON is a `NetworkError`: from the caller's side the round
  trip did not deliver, whatever the status line said.
- `GET` sends no body and no `Content-Type`.

### Gotchas
- The timeout aborts through the same controller as the caller's signal, so a caller
  cannot distinguish "I cancelled" from "it timed out" — both surface as `NetworkError`.
- The third argument accepts **either** a bare `AbortSignal` (the original shape, still
  used by `authService`) or a `RequestOptions` object. The discrimination is structural
  (`typeof value.aborted === 'boolean'`), not `instanceof`, because `AbortSignal` is a
  runtime polyfill on React Native.
- Auth routes are unprefixed (`/auth/google`) while the rest are `/v1/…`. Not a typo —
  both are as contracted.

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
- **Restore is optimistic — expiry is not checked and the JWT is not decoded.** Requests
  *do* carry the token now, so a restored-but-expired one surfaces as a `401` from
  `bets.ts` / `paymentMethods.ts`. Clearing the session on a `401` is still a later task;
  until it lands, the user sees "your session has expired" copy but stays nominally
  signed in.
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

## bets.ts

### Purpose
`createBet(params, signal?)`, `getActiveBet(signal?)`, plus the pure exported `parseBet`
and the copy mapper `describeBetError`.

### Key decisions
- **`stakeAmountBrl` is a `string`, and must stay one.** The API sends exact centavos as
  text (`"50.00"`) and takes it back the same way. Parsing money into a binary float
  introduces rounding error into the one field a user will absolutely notice. Format for
  display; never do arithmetic on it.
- **404 → `null` from `getActiveBet`, not a throw.** "No active bet" is a normal state,
  and making every screen try/catch a normal state is how error handling rots. Every
  other status still throws.
- **Snake_case JSON is parsed into camelCase domain types, not cast.** Same rule as
  `parseAuthSession`/`parseStoredSession`. Field-for-field fidelity is kept; only the
  casing at the TS boundary differs, and requests serialise back to snake_case here.
- **`goalType` and `status` are validated against their literal unions.** An unfamiliar
  value from a future API version fails loudly here instead of leaking into a screen's
  `switch` and silently rendering nothing.
- **30s timeout on `createBet`.** It triggers an outbound Mercado Pago pre-authorisation
  that regularly outlasts the default 15s.

### Business logic / invariants
- A user holds **at most one in-flight bet** (`pending` or `active`); the API enforces it
  with a partial unique index and answers `409` to a second attempt.
- `pending` is deliberately treated as in-flight: a bet stranded by a provider outage
  still occupies the user's slot, and hiding it would let them try to open a second.
- Error copy is exhaustive by status: 402 is specifically *card declined*, 409 is
  *you already have a bet*. Neither may be flattened into a generic failure message.

### Dependencies
`apiClient.ts` only. Consumed by `app/(app)/create-bet-payment.tsx`, which implements the
non-idempotent-recovery rule below: on `503` or `NetworkError` it calls `getActiveBet()`
to reconcile instead of re-calling `createBet`, and only offers a retry when that comes
back `null`. The dashboard screen is the other intended consumer.

### Gotchas
- **`createBet` is not idempotent — never blind-retry it.** A `503` leaves the bet
  `pending` server-side, and a `pending` bet occupies the slot, so retrying returns `409`
  rather than a new bet. Same after a client timeout or abort: the server may have
  created it anyway, since aborting the fetch cancels nothing server-side. The correct
  recovery on any of those is `getActiveBet()` to reconcile.
- **404 → `null` is slightly lossy.** A misconfigured `API_BASE_URL` or a renamed route
  also 404s and would read as "no active bet". If the dashboard insists there is no bet,
  check the base URL before the data.

## paymentMethods.ts

### Purpose
`addPaymentMethod(params, signal?)`, `listPaymentMethods(signal?)`, the pure exported
`parsePaymentMethod`/`parsePaymentMethodList`, and `describePaymentMethodError`.

### Key decisions
- **Tokenised card data only — never a raw PAN, expiry or CVV.** The Mercado Pago SDK
  collects the card and returns a single-use token; only that token plus the last four
  digits and the brand ever enter this app. This is what keeps the Expo bundle (and the
  team) out of PCI scope. **Do not add a raw card field to `AddPaymentMethodParams`**,
  however convenient it looks at a call site.
- **Server order is preserved.** The API returns `is_default DESC, created_at DESC`;
  re-sorting client-side would stop the default card appearing first.
- **An empty list is a result, not an error.** A user with no saved cards is a state to
  render, and the `payment_methods` array is always present.

### Business logic / invariants
- `parsePaymentMethod` requires `is_default` to be a real boolean. A missing one reaching
  a screen would silently render every card as non-default — worse than a visible failure.
- Responses never contain `mp_card_token` or `mp_customer_id`; nothing here reads them.

### Dependencies
`apiClient.ts` only. Consumed by `app/(app)/wallet.tsx` (list + add) and
`app/(app)/create-bet-payment.tsx` (list only — step 2 of the create-bet flow picks the
card the stake is held on, and sends the user to the wallet to add one).

### Gotchas
- `addPaymentMethod` can return `503` when the provider is unavailable — distinct from a
  validation `400`, and the user should be told to retry rather than fix their card.
- The card token is single-use. A failed `addPaymentMethod` cannot be retried with the
  same token; the screen must re-collect through the SDK.

## mercadoPago.ts

### Purpose
Owns the card-entry web page and the message protocol it speaks: `buildCardFormHtml`,
`parseBridgeMessage`, `buildSetSavingScript`, `buildFailAfterTokenScript`, and the
SDK/base URLs. Rendered by `src/components/MercadoPagoCardForm.tsx`.

### Key decisions
- **Tokenisation happens in a WebView running MP's browser SDK v2, not in RN.** That is
  what keeps a raw PAN or CVV out of JS state, logs and crash reports, and therefore out
  of PCI scope. The `mercadopago` npm package is the *server* SDK — adding it would put a
  secret access token in the shipped bundle, so it is deliberately not a dependency.
- **No React and no `react-native-webview` import here.** Strings in, strings out: the
  page generator and the parser are pure, so they are directly unit-testable and the
  component stays rendering-only.
- **`MP_BASE_URL` as the WebView `baseUrl` is load-bearing.** With the default
  `about:blank` origin Android refuses to run the remote SDK script and blocks its XHRs,
  and the form silently never initialises. Do not remove it as "unused config".
- **The public key goes through `JSON.stringify`** into the page script, so it cannot
  break out of the literal.
- **Page CSS is interpolated from `src/theme`**, so there is still one source of truth for
  colour and metrics and no hex literal is hand-typed into the HTML.
- **Brand comes from MP's own BIN lookup** (`getPaymentMethods({ bin })` →
  `payment_method_id`), with a small local prefix table as fallback so a flaky lookup
  cannot block an otherwise valid card.

### Business logic / invariants
- **The bridge carries exactly three card-related values: `cardToken`, `lastFour`,
  `cardBrand`.** The PAN, CVV, expiry and CPF must never appear in a `postMessage`
  payload, and nothing from the bridge is ever logged. This is the whole point of the
  module — a "convenient" fourth field undoes it.
- Three message types only: `ready` (SDK initialised), `token` (success) and `error`
  (**fatal init failure** — the SDK never loaded or the key was rejected). Ordinary
  validation and card-declined failures are rendered *inside* the page, so the user keeps
  their typing and no card data has to leave the WebView to produce a message.
- `parseBridgeMessage` narrows with explicit `typeof` checks and returns `null` for
  anything unrecognised. A WebView message is untrusted input — a redirected page could
  post anything — so nothing is cast.
- MP reports field problems as `cause[].code`; the raw descriptions are provider
  internals in Spanish/Portuguese, so known codes map to English copy in-page.
- Mercado Pago Brazil requires an **identification (CPF)** alongside name/number/expiry/
  CVV to issue a card token. Dropping that field breaks tokenisation outright.

### Dependencies
`src/theme` only. Consumed by `src/components/MercadoPagoCardForm.tsx`.

### Gotchas
- The generated page is a TS template literal. **Every regex backslash must be doubled**
  (`\D` in a template literal collapses to `D`), which is why the page's regexes use
  `[^0-9]` instead. Same for `${` — use string concatenation inside the page script.
- The token is single-use *and* short-lived. `buildFailAfterTokenScript` exists precisely
  because a save failure after tokenisation is unrecoverable: it clears the card fields
  and asks for re-entry rather than resubmitting a spent token.
