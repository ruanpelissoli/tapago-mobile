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

### Business logic / invariants
- `isAuthenticated` is derived strictly from `user !== null`. Never set it independently
  — two sources of truth for "is signed in" is exactly how auth bugs happen.
- **`isRestoring` starts `true` and settles to `false` exactly once**, after the restore
  attempt. Consumers must render a loading state while it is `true`; see `app/CLAUDE.md`.
- The context value is memoised. Without it every provider render produces a new object
  and re-renders every guard in the tree.

### Dependencies
React only. Consumed by `app/_layout.tsx` (mounts the provider) and both group layouts.

### Gotchas
- **Storage is still in-memory.** `restoreSession` always resolves to `null`, so the JWT
  lives only for the life of the process and the app starts signed out on every launch.
  This is expected: the sign-in *network* path is real, persistence is not yet.
  When it lands it belongs in `expo-secure-store` (a JWT must never go to
  `AsyncStorage`), behind `restoreSession` and `signIn`.
- `restoreSession` is the single intended seam for real persistence
  (`expo-secure-store`). Replacing its body should be sufficient; no consumer changes.
- The `isMounted` ref guards against setting state after unmount during Fast Refresh.
  Keep it when making `restoreSession` genuinely async.
- File is `.tsx`, not `.ts` — it returns JSX from the provider.

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
