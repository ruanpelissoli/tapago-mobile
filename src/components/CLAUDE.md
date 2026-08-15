# src/components/ — shared presentational components

## Purpose
Reusable, screen-agnostic UI.

## Contents
- `ScreenContainer.tsx` — screen-level wrapper applying theme background, padding and
  safe-area insets.
- `SplashScreenFallback.tsx` — full-screen spinner shown while auth state is restoring.
- `SocialSignInButton.tsx` — neutral provider button (icon + label + spinner), used for
  Google on the sign-in screen.
- `PrimaryButton.tsx` — filled brand button for a screen's primary action (home's
  "Create bet", create-bet's "Continue").
- `MercadoPagoCardForm.tsx` — `WebView` hosting Mercado Pago's browser SDK, used by the
  wallet screen to tokenise a card.

## Key decisions
- **`ScreenContainer` defaults to `['bottom', 'left', 'right']` edges, excluding `top`.**
  Screens inside a stack already receive their top inset from the navigation header;
  insetting again double-pads and looks broken. Screens without a header (like
  `sign-in`) pass all four edges explicitly.
- **Components are purely presentational** — no data fetching, no auth reads, no
  navigation. Keeping them dumb is what makes them testable without a router or provider.
- **`SplashScreenFallback` is deliberately minimal** (background + spinner, no logo or
  text). It should read as a continuation of the native splash screen rather than as a
  distinct loading screen the user notices.
- **`SocialSignInButton` is not used for Apple.** Apple's Human Interface Guidelines
  require their own button, so the sign-in screen renders
  `AppleAuthentication.AppleAuthenticationButton` directly. This component exists to give
  Google a button of matching height and weight — it is a sibling of the Apple button,
  not a wrapper around both.
- **`PrimaryButton` is the filled counterpart to `SocialSignInButton`** — same
  `MIN_TOUCH_TARGET` height and `radii.md`, opposite weight. They are siblings rather than
  one parameterised component: a provider button carries an icon slot and a busy state it
  would otherwise have to ignore.
- **`PrimaryButton`'s disabled state is a different fill (`colors.border` +
  `colors.textMuted` label), not a lowered opacity.** The create-bet form leaves Continue
  disabled until three fields validate, so "you can't press this yet" has to read at a
  glance; fading brand green to 50% looks like a rendering glitch and drops the label
  below contrast. `SocialSignInButton` keeps its opacity fade because it is only ever
  disabled momentarily, while a sign-in flow is in flight.
- **Icon comes from `@expo/vector-icons` (`AntDesign`), not a bundled asset.** Google's
  branding guidelines do want their official multi-colour mark; swapping this glyph for
  that asset is a designer deliverable, and only this one prop changes when it arrives.

## MercadoPagoCardForm.tsx

- **The card fields live in a WebView because of PCI scope, not because it was easier.**
  A raw PAN or CVV in React Native state, props or a log would drag this app (and the
  team) into PCI scope. Everything the user types stays inside the web document; only a
  single-use token, the last four digits and the brand come back over the bridge. Never
  add a card-detail prop or lift a field into RN — `src/services/CLAUDE.md` states this
  as a hard rule.
- **It is still purely presentational.** It owns no network call and no navigation: the
  wallet screen decides what a token means. The page itself and the message protocol live
  in `src/services/mercadoPago.ts`, so this file is rendering plus three effects.
- **A `ready` handshake timeout (12s) backs up `onError`/`onHttpError`.** The document is
  a local string that *always* renders, so a device that cannot reach
  `sdk.mercadopago.com` would otherwise sit on a blank white view forever. Any of the
  three shows an inline error with "Try again".
- **"Try again" bumps a `key` to remount the WebView** rather than calling `reload()`,
  which would keep a half-initialised SDK instance around.
- **`onShouldStartLoadWithRequest` whitelists the MP/`about:` origins.** The page never
  navigates, so anything else is a redirect — and a redirected page would become a
  trusted `postMessage` source.
- **Page CSS is interpolated from `src/theme`**, so the web form and the native screens
  still share one source of truth and no hex literal is hand-typed in the HTML.
- **RN drives the page through two `window.__tapago*` hooks**, not by remounting: one
  mirrors the post-token save into the submit button, the other reports a save failure
  that spent the token and clears the card fields for re-entry.
- **Never `console.log` an `onMessage` payload** — on the token path it carries the card
  token.

## Business logic / invariants
- Any interactive element added here must be at least `MIN_TOUCH_TARGET` (48) on both
  axes — see `src/theme/CLAUDE.md`.
- Text must not disable font scaling; sizes come from `theme.fontSizes`.
- New components need an accessibility role/label. `SplashScreenFallback` uses
  `progressbar` + "Loading" so screen readers announce the wait rather than dead air.

## Dependencies
`react-native-safe-area-context` (requires `SafeAreaProvider`, mounted in
`app/_layout.tsx`) and `src/theme`. Consumed by every route under `app/`.
`MercadoPagoCardForm` additionally needs `react-native-webview` (a native module, bundled
in Expo Go) and `src/services/mercadoPago`.

## Gotchas
- `SocialSignInButton`'s label sits between two equal-width slots (icon, then an empty
  spacer) so it stays optically centred. Removing the trailing spacer shifts the text.
- `ScreenContainer` renders a fixed, non-scrolling `View`. Screens with content that can
  overflow — or with text inputs that the keyboard would cover — need their own
  `ScrollView`/`KeyboardAvoidingView` inside it. It intentionally does not guess.
- Its `flex: 1` means children stretch; use `centered` for stub/empty/error states.
