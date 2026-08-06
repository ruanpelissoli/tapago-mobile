# src/theme/ — design tokens

## Purpose
Single source of truth for colour, spacing, radii and the type scale. Screens and
components import tokens from here so a brand change is a one-file edit.

## Key decisions
- **Plain exported objects, not a Context/provider.** Tokens are static this milestone,
  so a provider would add re-render surface and prop drilling for zero benefit. If
  runtime theming (dark mode toggle) is ever needed, wrap these in a Context — the
  token *names* are the stable API and won't have to change.
- **Named exports plus a `theme` aggregate.** Screens usually want two or three tokens
  (`colors`, `spacing`), so named imports keep call sites short; `theme` exists for code
  that needs to pass the whole set around.
- **`as const` everywhere.** This is load-bearing: it narrows `fontWeights.semibold` to
  the literal `'600'` rather than `string`, which is what React Native's `fontWeight`
  style prop requires. Dropping `as const` breaks typechecking at every call site.
- **Separate `lineHeights` keyed identically to `fontSizes`** rather than a computed
  ratio, so individual steps can be hand-tuned without a formula fighting the designer.

## Business logic / invariants
- `primary` is `#2ECC71` — the TaPago brand green, fixed by the product spec.
- `MIN_TOUCH_TARGET` is `48`. One constant covers both platforms: it satisfies Apple's
  44pt minimum and Android's 48dp minimum simultaneously. Never shrink it below 48.
- `spacing` is a 4pt scale. Add steps to it rather than using raw numbers in styles.
- Font sizes are **unscaled points**. React Native multiplies them by the user's system
  font-size setting, so never pair these with `allowFontScaling={false}`.

## Dependencies
Nothing — this module imports zero code, deliberately. Everything under `app/` and
`src/components/` depends on it, so keeping it dependency-free avoids import cycles.

## Gotchas
- Colours are currently light-mode only, while `app.json` sets
  `userInterfaceStyle: "automatic"`. Dark mode will need a parallel palette; the
  aggregate `theme` object is the seam to swap.
- `colors.success` intentionally equals `colors.primary`. They are separate tokens
  because they diverge in meaning — don't collapse them.
