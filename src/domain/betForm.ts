/**
 * Pure input helpers for the create-bet form.
 *
 * Deliberately free of React and of the router: sanitising, parsing and
 * formatting are decisions about *values*, not about a screen, so they can be
 * reasoned about (and unit-tested) on their own.
 *
 * Two separate jobs, kept separate on purpose:
 *  - `sanitize*` runs on every keystroke and only ever *removes* characters the
 *    field can never accept. It never rejects a partially-typed value, so the
 *    user is not fought mid-typing.
 *  - `parse*` runs to decide validity. It returns `null` — never `NaN` — for
 *    anything incomplete or out of range.
 */

import {
  STAKE_MAX_CENTS,
  STAKE_MIN_CENTS,
  TARGET_DAYS_MAX,
  TARGET_DAYS_MIN,
} from './bet';

/** Digits only, capped at the width of `TARGET_DAYS_MAX` (365 → 3 chars). */
const TARGET_DAYS_MAX_LENGTH = String(TARGET_DAYS_MAX).length;

/** `1000` → 4 digits, so a fifth integer digit is refused at the keystroke. */
const STAKE_MAX_INTEGER_DIGITS = String(Math.floor(STAKE_MAX_CENTS / 100)).length;
const STAKE_MAX_FRACTION_DIGITS = 2;

/**
 * Strips everything that is not a digit and caps the length.
 *
 * `007` survives as `007` (the user may still be typing) and parses to `7`;
 * `3650` is truncated to `365` rather than silently accepted then rejected.
 */
export function sanitizeTargetDaysInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, TARGET_DAYS_MAX_LENGTH);
}

/**
 * Normalises a BRL amount as it is typed.
 *
 * pt-BR users type `10,50`, so the comma is accepted and normalised to a dot —
 * the canonical form the parser expects. Only the first separator is kept, the
 * integer part is capped at `STAKE_MAX_INTEGER_DIGITS` and the fraction at two,
 * so a third decimal (`10,555`) is a no-op keystroke instead of a mangled value.
 */
export function sanitizeStakeInput(raw: string): string {
  const normalised = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');

  const firstSeparator = normalised.indexOf('.');
  if (firstSeparator === -1) {
    return normalised.slice(0, STAKE_MAX_INTEGER_DIGITS);
  }

  const integerPart = normalised.slice(0, firstSeparator).slice(0, STAKE_MAX_INTEGER_DIGITS);
  const fractionPart = normalised
    .slice(firstSeparator + 1)
    .replace(/\./g, '')
    .slice(0, STAKE_MAX_FRACTION_DIGITS);

  return `${integerPart}.${fractionPart}`;
}

/**
 * `'30'` → `30`; `''`, `'0'`, `'366'` → `null`.
 *
 * The regex gates the numeric conversion, so `Number('')` (which is `0`) and
 * `parseInt('')` (which is `NaN`) are both unreachable.
 */
export function parseTargetDays(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;

  const days = Number(text);
  if (days < TARGET_DAYS_MIN || days > TARGET_DAYS_MAX) return null;

  return days;
}

/**
 * `'10.5'` → `1050`; `''`, `'.'`, `'10.'`, `'0.99'`, `'1000.01'` → `null`.
 *
 * Money is converted with integer arithmetic on the split string parts rather
 * than `parseFloat(text) * 100`, which drifts (`10.55 * 100 === 1054.9999…`).
 * Callers must treat `null` as "not valid yet" — it is never `NaN`.
 */
export function parseStakeCents(text: string): number | null {
  const normalised = text.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;

  const [integerPart, fractionPart = ''] = normalised.split('.');
  const cents = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, '0'));

  if (cents < STAKE_MIN_CENTS || cents > STAKE_MAX_CENTS) return null;

  return cents;
}

/**
 * Reverse of the value the create-bet screen puts in the router params.
 *
 * Router params are strings and a deep link can carry anything, so the value is
 * re-validated against the same bounds instead of being trusted — `'abc'`,
 * `'12.5'` and an out-of-range amount all return `null`, never `NaN`.
 */
export function parseStakeCentsParam(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;

  const cents = Number(text);
  if (cents < STAKE_MIN_CENTS || cents > STAKE_MAX_CENTS) return null;

  return cents;
}

/**
 * `5000` → `"50.00"`; `100000` → `"1000.00"`.
 *
 * The **wire** format for `stake_amount_brl`, and the deliberate mirror image of
 * `formatCentsAsBrl`, which is display-only: a dot separator, always two
 * decimals, no thousands grouping and no `R$`. Sending `R$ 1.000,00` to
 * `POST /v1/bets` is a `400`.
 *
 * Built with integer arithmetic on the split parts for the same reason as
 * `parseStakeCents` — `cents / 100` reintroduces the binary-float error the
 * centavos representation exists to avoid.
 *
 * Money crosses the wire as a **string**, never a `number`: binary floats cannot
 * represent centavos exactly, and this is the one field a user would notice
 * being off by a cent.
 */
export function centsToApiAmount(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;

  const whole = String(Math.floor(safeCents / 100));
  const fraction = String(safeCents % 100).padStart(2, '0');

  return `${whole}.${fraction}`;
}

/**
 * `1000` → `1.000`. Shared by both display formatters so the two cannot drift
 * apart on how thousands are marked.
 */
function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * `100000` → `R$ 1.000,00`.
 *
 * Display only — see `centsToApiAmount` for the value the API accepts.
 *
 * Grouping and the decimal mark are applied by hand: Hermes ships without the
 * full ICU locale data, so `Intl.NumberFormat('pt-BR')` cannot be relied on to
 * produce pt-BR separators on every device.
 */
export function formatCentsAsBrl(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;

  const whole = groupThousands(String(Math.floor(safeCents / 100)));
  const fraction = String(safeCents % 100).padStart(2, '0');

  return `R$ ${whole},${fraction}`;
}

/**
 * `"50.00"` → `R$ 50,00`; `"1000.00"` → `R$ 1.000,00`.
 *
 * The display counterpart of `centsToApiAmount`, for money that arrives *from*
 * the API. `stake_amount_brl` is exact text, and the third member of this
 * formatter family exists so nobody is tempted to bridge the gap with
 * `parseFloat` — **this function does no arithmetic at all**, it reshapes the
 * string. That is the invariant `src/services/CLAUDE.md` states for `Bet`.
 *
 * Anything that does not match the wire shape (`parseBet` only guarantees a
 * non-empty string) degrades to `R$ <raw>` — the exact value the server sent,
 * which is always better than `R$ NaN`.
 */
export function formatApiAmountAsBrl(amount: string): string {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return `R$ ${amount}`;

  const [integerPart, fractionPart = ''] = amount.split('.');

  return `R$ ${groupThousands(integerPart)},${fractionPart.padEnd(2, '0')}`;
}
