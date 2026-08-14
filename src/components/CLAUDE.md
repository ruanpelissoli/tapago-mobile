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

## Business logic / invariants
- Any interactive element added here must be at least `MIN_TOUCH_TARGET` (48) on both
  axes — see `src/theme/CLAUDE.md`.
- Text must not disable font scaling; sizes come from `theme.fontSizes`.
- New components need an accessibility role/label. `SplashScreenFallback` uses
  `progressbar` + "Loading" so screen readers announce the wait rather than dead air.

## Dependencies
`react-native-safe-area-context` (requires `SafeAreaProvider`, mounted in
`app/_layout.tsx`) and `src/theme`. Consumed by every route under `app/`.

## Gotchas
- `SocialSignInButton`'s label sits between two equal-width slots (icon, then an empty
  spacer) so it stays optically centred. Removing the trailing spacer shifts the text.
- `ScreenContainer` renders a fixed, non-scrolling `View`. Screens with content that can
  overflow — or with text inputs that the keyboard would cover — need their own
  `ScrollView`/`KeyboardAvoidingView` inside it. It intentionally does not guess.
- Its `flex: 1` means children stretch; use `centered` for stub/empty/error states.
