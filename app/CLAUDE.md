# app/ — routing tree

## Purpose
File-based routes for the TaPago mobile app, using `expo-router` (SDK 57, v57.x).
The directory structure *is* the navigation graph — there is no manually wired
React Navigation stack anywhere in this project.

## Layout
- `_layout.tsx` — root. Mounts `GestureHandlerRootView` → `SafeAreaProvider` →
  `AuthProvider`, then a headerless `Stack`. Every provider the app needs lives here.
- `index.tsx` — entry route. Redirects to the right group once auth state settles.
- `(auth)/` — unauthenticated screens. Currently `sign-in.tsx`.
- `(app)/` — authenticated screens, gated by `(app)/_layout.tsx`: `home.tsx`,
  `create-bet.tsx` (step 1 of the create-bet flow), `create-bet-payment.tsx` (step 2 —
  card selection and `POST /v1/bets`) and `wallet.tsx` (saved cards + add a card).
- `+not-found.tsx` — catch-all for unmatched routes and bad deep links.

Parenthesised segments are **route groups**: they organise files and scope a layout
without appearing in the URL. `app/(app)/home.tsx` is reachable at `/home`.

## Key decisions
- **Guard at the layout, not per screen.** `(app)/_layout.tsx` checks auth once, so a
  new file dropped into `(app)/` is protected purely by where it lives. Nobody has to
  remember to add a check.
- **`(auth)/_layout.tsx` guards in reverse** — a signed-in user gets redirected out of
  sign-in. This is also what performs the post-sign-in transition: flipping auth state
  makes the redirect fire, so no screen needs to call `router.replace` itself.
- **Headerless root stack.** Each group owns its own chrome; `(app)` sets themed
  headers, `(auth)` stays headerless for full-bleed screens.

## Business logic / invariants
- **`isRestoring` must be checked before `isAuthenticated`, in every guard.** While the
  session is loading, `isAuthenticated` is `false` but not yet *meaningful*. Redirecting
  on it would eject signed-in users to sign-in on every cold start. Guards render
  `SplashScreenFallback` until restore settles.
- Redirect targets use group-qualified hrefs (`/(app)/home`, `/(auth)/sign-in`) so the
  destination group's layout — and therefore its guard — is unambiguous.
- `home.tsx` is still a **stub** — a heading plus "Create bet" and "Payment methods"
  buttons, the only entry points into the create-bet flow and the wallet. The dashboard
  task replaces all of it.
- A screen under `(app)/` is reachable purely by existing, but it needs a `Stack.Screen`
  entry in `(app)/_layout.tsx` to get a themed header and a title.
- **Authenticated API calls belong in `(app)/`, behind the guard.** Calling one while
  signed out throws `ApiError(401, 'not_authenticated')` from `apiClient` before any
  network request — deliberately, so the mistake is loud. That is a routing bug to fix,
  not an error to display.

## (auth)/sign-in.tsx

Offers Google and Apple sign-in. Both providers converge on one funnel
(`runSocialSignIn`) that awaits a `SocialSignInResult` and then either calls
`useAuth().signIn(session)` or shows a message.

- **The screen never navigates.** Handing the session to `signIn` flips auth state, which
  makes `(auth)/_layout.tsx` redirect to `/(app)/home`. Adding a `router.replace` here
  would race that redirect and is the wrong instinct — this is why the guard exists.
- **The Apple button is the system component**, `AppleAuthenticationButton`, not a
  look-alike. App Store review requires Apple's own button, wording and styling. It is
  rendered only when `isAppleSignInAvailable()` resolves true, which is iOS 13+ only —
  availability is a *runtime* question even on iOS, not a `Platform.OS` check alone.
- **The Google button is hidden entirely when no client ID is configured**, rather than
  shown and failing on tap.
- **Cancelling shows nothing.** Only `status: 'error'` sets a message; a user who backs
  out of the sheet returns to a screen at rest.
- The native Apple button cannot show a spinner or be disabled, so an overlay scrim
  covers it while a flow is in flight; the scrim is also what blocks a second tap.
- The screen can unmount mid-flow, so the result handler checks an `isMounted` ref before
  setting state.

## (app)/create-bet.tsx — step 1 of the create-bet flow

Collects a goal type, a target-day count and a BRL stake, then hands them to the payment
step. **No network call happens here**; all rules live in `src/domain/bet.ts` and
`src/domain/betForm.ts` so this file stays layout and wiring.

- **`ScreenContainer` does not scroll**, so this screen brings its own
  `KeyboardAvoidingView` + `ScrollView`. Continue sits at the end of the scrolled content
  rather than pinned to the bottom — that avoids needing a `keyboardVerticalOffset` tied
  to the header height (and avoids importing `@react-navigation/elements`, which is only
  a transitive dependency and not in `package.json`).
- **Validity is derived on every render, never stored.** `parseTargetDays` /
  `parseStakeCents` are called inline and `isValid` falls out of them, so clearing a field
  returns cleanly to the disabled state with no cached flag to desync.
- **No default goal selection** (a bet's goal must be a deliberate choice), but target
  days defaults to `30`. The unselected group shows a muted *hint*, not an error: nothing
  can "touch" a radio group, so a red state there could never fire honestly.
- **Errors appear only after blur** (`touched` per field), so typing the first character
  of an incomplete value never turns the form red.
- **`handleContinue` re-checks all three values** rather than relying on the `disabled`
  prop — that re-check is also what narrows the nullable parses for TypeScript, which
  makes an unguarded push a compile error.
- **Double-tap guard**: a `hasNavigated` ref set before `router.push`, reset in
  `useFocusEffect` so returning from step 2 re-arms the button instead of leaving it dead.
- No async work happens on this screen, so there is no set-state-after-unmount path and no
  `isMounted` ref is needed (unlike `sign-in.tsx`, which awaits a provider SDK).

**Param contract with `create-bet-payment.tsx`**: `goalType` (the raw `goal_type` value),
`targetDays` and `stakeCents` — money as **integer centavos**, so no float ever represents
an amount. Params serialise to `string | string[]`, so step 2 re-parses and re-validates
every one instead of trusting them; a bad deep link gets an explanatory screen and a way
back here, never `NaN` in a request.

## (app)/create-bet-payment.tsx — step 2 of the create-bet flow

Keeps the bet summary from step 1 on screen, lists the user's saved cards as a
single-select radio group, and submits `POST /v1/bets` — which places the Mercado Pago
pre-authorisation hold.

- **`createBet` is not idempotent, and this screen never blind-retries it.** A `503`
  leaves the bet `pending` server-side; a `pending` bet occupies the user's single
  in-flight slot, so a retry returns `409` instead of creating a bet. A client timeout or
  abort is the same problem — the request may have completed anyway. So `503` and
  `NetworkError` reconcile through `getActiveBet()`: a bet comes back → treat it as
  success; `null` → the bet genuinely was not created, so a retry is offered; the
  reconcile itself throws → "Check bet status", which re-runs `getActiveBet` **only**.
- **Copy always comes from `describeBetError`; only the *recovery* varies by status.**
  400/402/404/500 keep the card list interactive so a different card can be picked; 409
  offers "Go to home" (a retry can only 409 again); 401 shows the session-expired copy
  with no action — clearing the session on 401 is a separate, known follow-up. Raw error
  messages are never surfaced.
- **`isSubmittingRef` on top of the `disabled` prop.** A second tap can already be queued
  when the first flips state, and each extra `createBet` is a real pre-authorisation
  attempt. Same reason as `hasNavigated` here and `isSavingRef` in the wallet. It is
  deliberately left `true` on success, so a queued tap cannot open a second bet while the
  confirmation alert is up.
- **Refetch-on-focus *is* the contract with the wallet.** "Add card" pushes
  `/(app)/wallet` and the user comes back with the system back button; `useFocusEffect`
  re-runs the list fetch, so no callback or return-param channel exists. Because
  `loadMethods` does not set `loading` itself, that refresh is silent — the list is
  replaced in place rather than blinking through a spinner.
- **Selection is reconciled in one functional `setSelectedId`** inside the fetch's success
  callback: keep a still-present selection, otherwise fall back to the first card (server
  order puts the default first), otherwise `null` for an empty list. Functional so the
  callback never closes over `selectedId`, which would re-fire the focus effect on every
  load.
- **`dismissAll` + `replace`, not a bare `replace`.** Replacing only the top of the stack
  would leave `create-bet` sitting under home, so Back would re-enter the flow with params
  already spent on a bet.
- **Success uses React Native's `Alert`** (`cancelable: false`, OK navigates). There is no
  toast library here and adding a dependency for one confirmation is out of scope.
- **`ScrollView` + `.map()`, where the wallet uses a `FlatList`** — the one deliberate
  divergence. A `FlatList` nested in a `ScrollView` warns about nested virtualisation, and
  a saved-card count is inherently small. `ScreenContainer` does not scroll, and summary +
  cards + actions overflows a small screen at large system type.
- **`isGoalType` narrows the param, rather than a cast.** `createBet` takes the `GoalType`
  union; a cast is exactly what the deep-link re-validation exists to avoid.
  `goalTypeLabel` stays the display path. The two `GoalType` unions (`src/domain/bet` and
  `src/services/bets`) are structurally identical string unions, so the domain value flows
  in without conversion — if they ever diverge, this is where it breaks.
- An Active Bet / dashboard screen is out of scope; success lands on the `home` stub.

## (app)/wallet.tsx — saved cards, and adding one

Lists the user's saved cards (`listPaymentMethods`) and adds a new one by tokenising it
in a Mercado Pago WebView (`src/components/MercadoPagoCardForm.tsx`) and posting the
token to `addPaymentMethod`. First consumer of `src/services/paymentMethods.ts`.

- **The add-card form is a `Modal`, not a route.** A Mercado Pago token is single-use and
  short-lived, so card entry must not be something the back stack or a deep link can
  resurrect. It also keeps the list mounted underneath, which makes "cancel leaves the
  list untouched" true by construction rather than by care.
- **Abort *before* setState, always.** `apiClient` merges the caller's signal with its own
  15s timeout, so an abort and a timeout both arrive as `NetworkError` and cannot be told
  apart from the error object. `controller.signal.aborted` is the only reliable "did we
  cancel this?" — every `then`/`catch` checks it first. Both controllers are aborted on
  unmount and on cancel.
- **`loadMethods` is a promise chain, not `async`/`await`, and does not set `loading`
  itself.** `react-hooks/set-state-in-effect` is an *error* in this repo's lint config and
  rejects a `setState` reachable synchronously from an effect body. Initial state is
  already `loading`; `reload()` is the wrapper that shows the spinner for retry and
  post-add refresh. Do not "simplify" it back to `async` — lint will fail.
- **An empty list is a state, never an error.** `[]` renders the empty state with the same
  "Add card" action; only a thrown error shows the inline `describePaymentMethodError`
  message plus "Try again".
- **Server order is rendered as received** (`is_default DESC, created_at DESC`). No client
  sort — that is what keeps the default card first.
- **A save that fails *after* tokenisation cannot be retried.** The token is spent, so the
  message appends "enter the card again" and is pushed into the WebView, which clears the
  card fields. Re-submitting the same token would only ever 400.
- **`isSavingRef` guards a double-fired token**, mirroring `create-bet.tsx`'s
  `hasNavigated`: a WebView can post the same message more than once.
- Deleting a card and setting a default are **out of scope** — no API exists for either.
  `isDefault` only drives a badge.
- With no `MERCADO_PAGO_PUBLIC_KEY` configured, "Add card" is disabled with an inline
  explanation rather than opening a form that can only fail (the `GOOGLE_SIGN_IN_ENABLED`
  precedent).

## Dependencies
- `src/domain/bet`, `src/domain/betForm` — goal-type enum, bounds, parsing/formatting.
- `src/domain/paymentMethod` — card brand/mask/accessibility-label display rules.
- `src/services/paymentMethods`, `src/services/mercadoPago` — the wallet's data and
  tokenisation layers; `paymentMethods` is also step 2's card list.
- `src/services/bets` — `createBet`/`getActiveBet`/`describeBetError`, used by
  `(app)/create-bet-payment.tsx`.
- `src/services/apiClient` — `ApiError`/`NetworkError`, which step 2 switches on to pick a
  recovery action (the *copy* still comes from `describe*Error`).
- `src/hooks/useAuth` — the `AuthProvider`/`useAuth` pair both guards read.
- `src/hooks/useGoogleSignIn`, `src/services/authService` — the two social sign-in flows.
- `src/components/ScreenContainer`, `SplashScreenFallback`, `SocialSignInButton`,
  `PrimaryButton`
- `src/theme` — all colour/type values; no literals in route files.

## Gotchas
- `package.json` `main` is `expo-router/entry`, **not** `index.ts`. There is no `App.tsx`
  in this project; adding one back does nothing.
- `typedRoutes` is on (`app.json` → `experiments`). Route types are generated by the dev
  server into `.expo/types` (gitignored) — there is no standalone typegen command, so a
  fresh clone typechecks against loose `string` hrefs until `expo start` runs once.
- Auth state **survives restarts**: the session is persisted to `expo-secure-store` and
  read back on cold start (`src/services/sessionStorage.ts`). This is exactly why every
  guard must check `isRestoring` first — the read is async, so `isAuthenticated` is `false`
  but meaningless for the first frames. The token is *not* validated or expiry-checked on
  restore, but authenticated requests **do** now carry it: `AuthProvider` registers a
  token getter with `src/services/apiClient.ts`, so `bets.ts`/`paymentMethods.ts` attach
  it automatically. A restored-but-expired token therefore shows up as a `401` from a
  screen's first fetch; clearing the session on `401` is still a follow-up task.
- Adding a native module (as `expo-secure-store` and now `react-native-webview` were)
  needs the bundler restarted with `npx expo start --clear`, and a dev client built
  before it was added must be rebuilt. `react-native-webview` *is* bundled in Expo Go, so
  the wallet's add-card form works there without a custom build.
- **Social sign-in cannot work in Expo Go on a device without native config.** Apple
  Sign-In needs the entitlement from `usesAppleSignIn`, so it requires a development
  build; the button simply does not appear where the module reports unavailable.
- Do not add a `babel.config.js` naming `babel-preset-expo`: in SDK 57 that preset is
  nested under `expo/node_modules` and is not resolvable from the project root. Metro
  applies it internally — a hand-written config breaks bundling outright.
