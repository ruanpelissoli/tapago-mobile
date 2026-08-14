# src/domain/ — bet domain rules and input parsing

## Purpose
Pure, framework-free rules for the create-bet flow: the goal-type enum, the numeric
bounds, and the functions that turn what a user typed into a value the API can accept.
Screens import from here so validation is one testable place rather than logic smeared
across JSX.

## Key decisions
- **The `goal_type` enum lives app-side, in `GOAL_TYPES`.** There is no generated client
  or shared schema in this repo, so the values (`exercise`, `no_smoking`) are declared
  here and match the `POST /v1/bets` contract exactly. Adding a goal type is one entry in
  that array — the selector renders from it, so no screen edit is needed.
- **Money is integer centavos everywhere**, never a float. `parseStakeCents` does the
  conversion with integer arithmetic on the split string parts, because
  `parseFloat('10.55') * 100` is `1054.9999…`. The centavos value is what crosses the
  router-param boundary; formatting back to `R$ 10,55` is a display concern only.
- **Parsers return `null`, never `NaN`.** Each is gated by a regex before any numeric
  conversion, so `parseInt('')`, `Number('.')` and friends are unreachable. `null` means
  "not a valid value (yet)"; a caller that forgets to handle it gets a TypeScript error
  under `strict`, whereas `NaN` would flow silently into router params.
- **Sanitising and parsing are separate jobs.** `sanitize*` runs on every keystroke and
  only ever *removes* characters that can never be valid, so a half-typed `10.` is left
  alone. `parse*` decides validity and is what the screen shows errors from, after blur.
  Merging the two would fight the user mid-typing.
- **`formatCentsAsBrl` groups and marks decimals by hand** rather than using
  `Intl.NumberFormat('pt-BR')`. Hermes does not ship the full ICU locale data, so `Intl`
  cannot be relied on to produce pt-BR separators on every device.
- **`as const` on `GOAL_TYPES`** is load-bearing: it is what derives the `GoalType` union
  from the data instead of duplicating it as a hand-written type.

## Business logic / invariants
- `target_days` is an integer in **1–365**; the form defaults to 30.
- The stake is **R$ 1,00 – R$ 1.000,00** (`STAKE_MIN_CENTS` / `STAKE_MAX_CENTS`).
  This client ceiling is **deliberately stricter** than the API's own `"10000.00"` limit
  from the `POST /v1/bets` contract — a stricter subset can never be rejected by the
  server, so it is safe, but raising it should be a deliberate product decision, not a
  side effect of some other change. Change it here and nowhere else.
- `sanitizeStakeInput` accepts a comma or a dot as the decimal separator (pt-BR users
  type `10,50`) and normalises to a dot, which is the only form the parsers accept.
- Max 2 decimal places, max 4 integer digits — enforced at the keystroke *and* re-checked
  by the parser, because a paste can arrive without keystrokes.
- `parseStakeCentsParam` exists separately from `parseStakeCents`: params carry the
  already-converted integer centavos, and a deep link can put anything in the URL, so the
  value is re-validated against the same bounds instead of being trusted.

## Dependencies
Nothing outside this directory. No React, no `expo-router`, no `react-native` — that is
the point. Consumed by `app/(app)/create-bet.tsx` and `app/(app)/create-bet-payment.tsx`.

## Gotchas
- There is no test runner in this project yet. These functions are pure and have no
  imports to mock, so they are the **first thing to unit-test** when one lands — the edge
  cases worth covering are `''`, `'007'`, a lone `,`, `'10.'`, `'10,555'`, `'0,99'` and
  `'1000,01'`.
- `sanitizeTargetDaysInput` truncates rather than rejects: typing `3650` leaves `365`.
  That is intentional (the field cannot exceed 3 digits) but means the visible value can
  differ from the last keystroke.
- `parseTargetDays` accepts leading zeros (`007` → `7`). The API receives the parsed
  number, not the raw text, so this never reaches the wire as `007`.
