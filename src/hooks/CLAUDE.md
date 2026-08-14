# src/hooks/ — shared React hooks

## Purpose
Reusable stateful logic.
- `useAuth.tsx` — owns the app's auth state; every route guard reads it.
- `useGoogleSignIn.ts` — wraps the Google OAuth flow into one awaitable call.

## useAuth.tsx

### Key decisions
- **React Context, no state library.** Auth state is one small object read by two
  layouts. Redux/Zustand would be pure overhead at this size; this is a deliberate
  milestone choice, not an oversight.
- **Provider and hook live in the same file.** They are a single unit — splitting them
  invites importing one without the other and creates a needless import cycle.
- **`useAuth` throws when used outside the provider** rather than returning a default.
  A missing provider is a wiring bug that should fail loudly and immediately, not
  silently render every screen as signed-out.
- **`isRestoring` is a distinct flag, not `user === undefined`.** Callers shouldn't have
  to encode "null means signed out, undefined means still loading" — an explicit boolean
  is much harder to misread, and misreading it causes a visible auth flash.
- **One `AuthSession` state, not separate `user` and `token` states.** `signIn` takes the
  whole session, so the JWT and the user it belongs to can never disagree, and there is
  no window where one is set and the other isn't. `user`/`token` are derived for readers.
- **`AuthUser` is an alias of `authService.AuthenticatedUser`.** The API decides the shape
  of a user; re-declaring it here would let the two drift silently.
- **State first, storage second.** `signIn`/`signOut` set React state and *then* enqueue
  the store operation. They stay synchronous `void` functions: `sign-in.tsx` calls
  `signIn(session)` in a non-async flow, and the route guards' redirect must fire off the
  state flip, not wait on a keychain write that might fail.
- **Storage lives in `src/services/sessionStorage.ts`, not inline here.** Device storage is
  infrastructure; this file stays React state. `restoreSession` remains the single seam.
- **Writes go through a serialising queue (`writeQueue` ref).** Two rapid `signIn` calls
  have no ordering guarantee otherwise, and the loser could be the last value written.
- **`hasUserActed` ref guards the restore.** A `signOut` (or `signIn`) while the cold-start
  read is still in flight must not be undone when that read resolves.
- **The JWT is mirrored to a module-scoped `currentToken`, and `apiClient` reads it
  through a getter registered at import time.** `apiClient` is a plain module and cannot
  consume React context, so something has to bridge the two. Three alternatives were
  rejected:
  - *Passing the token per call site* — `src/services/CLAUDE.md` explicitly requires the
    header to be attached in `apiClient`, not threaded through every caller.
  - *A ref written during render* — forbidden by the `react-hooks/refs` lint rule (the
    React Compiler's), which fails `npm run lint`.
  - *Registering the getter in a `useEffect`* — React runs **child** effects before
    **parent** effects, so a screen fetching from its own mount effect would run before
    `AuthProvider`'s effect and hit the "no token registered" path. Registering at import
    time removes that window entirely.

  A *getter*, not a captured value: the token changes on sign-in, sign-out and restore,
  and a snapshot would go stale on all three.

### Business logic / invariants
- `isAuthenticated` is derived strictly from `user !== null`. Never set it independently
  — two sources of truth for "is signed in" is exactly how auth bugs happen.
- **`isRestoring` starts `true` and settles to `false` exactly once**, after the restore
  attempt. Consumers must render a loading state while it is `true`; see `app/CLAUDE.md`.
  It is set in a `finally` deliberately — no failure path may leave the app stuck on
  `SplashScreenFallback`.
- The context value is memoised. Without it every provider render produces a new object
  and re-renders every guard in the tree. `signIn`/`signOut` keep empty-ish `useCallback`
  deps (only the stable `enqueueWrite`) so the memo identity survives re-renders.
- Auth state, not the store, is the source of truth. A read/write failure is swallowed
  and the session simply lives for this process only.
- **`rememberToken` is called on every path that changes the session** — `signIn`,
  `signOut` and the cold-start restore — and always *before* `setSession`. Sign-in flips
  auth state, which triggers the guard's redirect, which can mount a screen that fetches
  immediately; that request needs the token already in place. On sign-out the ordering
  matters for the opposite reason: no request may go out carrying the token of a user who
  has just left. Adding a fourth way to set `session` without calling `rememberToken`
  silently desynchronises the API client from the UI.

### Dependencies
React, plus `src/services/sessionStorage.ts` for persistence and
`src/services/apiClient.ts` for `setAuthTokenProvider`. Consumed by `app/_layout.tsx`
(mounts the provider) and both group layouts. The import direction is one-way —
`apiClient` must never import this file, or the two become a cycle.

### Gotchas
- **The session is persisted** to `expo-secure-store` under `auth_session` — the whole
  `AuthSession`, not just the JWT, because `user` has to survive a restart and there is no
  `/auth/me` to re-fetch it. See `src/services/CLAUDE.md`. A JWT must never go to
  `AsyncStorage`.
- `restoreSession` is still the only place that reads storage, and `signIn`/`signOut` the
  only places that write it. Keep it that way; nothing else should know the key exists.
- The `isMounted` ref guards against setting state after unmount during Fast Refresh —
  the restore is genuinely async now, so removing it reintroduces the warning.
- File is `.tsx`, not `.ts` — it returns JSX from the provider.
- **`currentToken` is module state, so exactly one `AuthProvider` may ever be mounted**
  (it is, in `app/_layout.tsx`). A second provider would fight over the same value and
  the last write would win regardless of which tree made it.
- Token *expiry* is still unchecked. A restored-but-expired JWT is now actually sent, so
  it surfaces as a `401` from the service layer. Clearing the session on `401` remains a
  follow-up task — this file does not react to API failures at all today.

## useGoogleSignIn.ts

### Purpose
Turns `expo-auth-session`'s Google provider into a single `await signIn()` that resolves
to the same `SocialSignInResult` as `authService.signInWithApple`, so the sign-in screen
treats both providers identically.

### Key decisions
- **It has to be a hook.** `expo-auth-session` only exposes Google through
  `useIdTokenAuthRequest`; there is no imperative entry point to call from a handler.
- **The promise deliberately spans two renders.** On native the library uses the
  *authorization-code* flow: `promptAsync()` resolves with a `code`, **not** an ID token.
  The ID token only appears later on the hook's `response`, after the library exchanges
  the code in its own effect. `signIn()` therefore returns a promise that a `useEffect`
  settles once the token has been traded for a TaPago session. Awaiting `promptAsync()`
  alone and reading `id_token` off its result yields `undefined` on iOS and Android —
  this is the single most likely way to break this file.
- **A 20s timeout backstops the code exchange.** The library performs it with a floating
  promise and never surfaces a rejection, so without the timer a failed exchange leaves
  the caller pending forever and the button spinning for good.
- **Client IDs resolve to `''`, never `undefined`.** `useAuthRequest` *throws during
  render* if the platform's client ID is `undefined`, which would crash the screen rather
  than degrade. An empty string loads a request that is simply never prompted, because
  `GOOGLE_SIGN_IN_ENABLED` hides the button.

### Business logic / invariants
- `signIn()` never rejects. Cancellation resolves as `{status: 'cancelled'}` and must not
  be shown to the user as an error — they closed the sheet on purpose.
- A second call while one prompt is open resolves as `cancelled` instead of opening a
  second browser session.
- `WebBrowser.maybeCompleteAuthSession()` runs at module scope. Moving it inside the hook
  breaks the redirect back into the app.

### Gotchas
- `Google.useIdTokenAuthRequest` is marked `@deprecated` upstream in favour of the
  native `@react-native-google-signin/google-signin` module. It still works and keeps the
  managed workflow free of native linking; revisit if Expo removes it.
- `isReady` is `false` until the auth URL is built. Prompting before then throws inside
  the library, hence the guard and the disabled button.
- The redirect URI is derived from the app's `scheme` (`tapago`) and bundle ID. Changing
  either means re-registering the redirect URI in Google Cloud Console.
