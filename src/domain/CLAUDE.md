# src/domain/ — domain rules, input parsing and display formatting

## Purpose
Pure, framework-free rules for the app's domain objects: the goal-type enum and numeric
bounds for bets, the functions that turn what a user typed into a value the API can
accept, and the display rules for a saved card. Screens import from here so validation
and formatting are one testable place rather than logic smeared across JSX.

- `bet.ts` / `betForm.ts` — the create-bet flow's enum, bounds, parsing and formatting.
- `paymentMethod.ts` — how a saved card is named, masked and announced.

## Key decisions
- **The `goal_type` enum lives app-side, in `GOAL_TYPES`.** There is no generated client
  or shared schema in this repo, so the values (`exercise`, `no_smoking`) are declared
  here and match the `POST /v1/bets` contract exactly. Adding a goal type is one entry in
  that array — the selector renders from it, so no screen edit is needed.
- **Money is integer centavos everywhere**, never a float. `parseStakeCents` does the
  conversion with integer arithmetic on the split string parts, because
  `parseFloat('10.55') * 100` is `1054.9999…`. The centavos value is what crosses the
  router-param boundary; formatting back to `R$ 10,55` is a display concern only.
- **Two formatters, and they are not interchangeable.** `formatCentsAsBrl` is
  **display-only** (`R$ 1.000,00` — grouping, comma). `centsToApiAmount` is the **wire**
  format for `stake_amount_brl` (`"1000.00"` — dot, always two decimals, no grouping, no
  `R$`). Sending the display string to `POST /v1/bets` is a `400`, so the mirror-image
  pair exists to make the right one obvious at a call site. Both build the string with
  integer arithmetic on the split parts for the `parseStakeCents` reason — `cents / 100`
  reintroduces exactly the binary-float error centavos exist to avoid.
- **Money crosses the wire as a `string`, never a `number`.** `createBet` types
  `stakeAmountBrl` as a string for the same reason the API sends one back; a `number`
  there would put a rounding error in the one field a user is guaranteed to notice.
- **`isGoalType` is the narrowing counterpart to `goalTypeLabel`.** Both take a raw
  string (a router param, typically); the label one answers "what do I show?" and the type
  guard answers "may this be sent as `goal_type`?". `create-bet-payment.tsx` needs the
  guard because `createBet` takes the `GoalType` union and a cast would defeat the
  deep-link re-validation. There is deliberately no third `parseGoalType` helper.
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

## paymentMethod.ts — saved-card display rules

`formatCardBrand`, `maskedCardLabel` and `cardAccessibilityLabel`. Extracted from the
wallet screen for the same reason as the bet parsers: so the screen stays layout and
wiring, and so these are unit-testable the day a runner lands.

- **The brand table is keyed by Mercado Pago's own `payment_method_id`** (`master`, not
  `mastercard`) because that is verbatim what the API stores in `card_brand`. Renaming a
  key to something more natural silently breaks the lookup.
- **Unknown brands fall back to a capitalised form of whatever arrived**, not to a blank
  or to "Card". Mercado Pago adds brands over time, and a new one should still render as
  something recognisable rather than vanishing from the row.
- **The accessibility label is built separately from the visible one.** "•••• 1234" reads
  as four bullet characters to a screen reader; "Visa ending in 1234, default card" is
  the same information said in a way that survives being spoken. Keep them in step but
  do not collapse them into one string.
- The mask is display-only. The app only ever receives `lastFour` — there is no full PAN
  anywhere to mask.

## Dependencies
Nothing outside this directory. No React, no `expo-router`, no `react-native` — that is
the point. Consumed by `app/(app)/create-bet.tsx`, `app/(app)/create-bet-payment.tsx` and
`app/(app)/wallet.tsx`.

## Gotchas
- There is no test runner in this project yet. These functions are pure and have no
  imports to mock, so they are the **first thing to unit-test** when one lands — the edge
  cases worth covering are `''`, `'007'`, a lone `,`, `'10.'`, `'10,555'`, `'0,99'` and
  `'1000,01'`. For `centsToApiAmount`: `100` → `"1.00"`, `5000` → `"50.00"`, `100000` →
  `"1000.00"`, plus `0`, a non-integer and a negative (all clamped, never `NaN`).
- `sanitizeTargetDaysInput` truncates rather than rejects: typing `3650` leaves `365`.
  That is intentional (the field cannot exceed 3 digits) but means the visible value can
  differ from the last keystroke.
- `parseTargetDays` accepts leading zeros (`007` → `7`). The API receives the parsed
  number, not the raw text, so this never reaches the wire as `007`.
