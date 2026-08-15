/**
 * Bet domain constants shared by the create-bet flow.
 *
 * Everything the API cares about (`goal_type` values, the target-day range, the
 * stake bounds) lives here so reconciling with the backend contract is a
 * one-file change rather than a hunt through screens.
 */

/**
 * Selectable goal types, in display order.
 *
 * `value` is snake_case because it is sent verbatim as the API's `goal_type`
 * field; `label` is the English copy shown to the user. Adding a goal type is a
 * single entry here — the selector renders from this array.
 */
export const GOAL_TYPES = [
  { value: 'exercise', label: 'Exercise' },
  { value: 'no_smoking', label: 'No Smoking' },
] as const;

/** Union of the accepted `goal_type` values, derived from `GOAL_TYPES`. */
export type GoalType = (typeof GOAL_TYPES)[number]['value'];

/** Narrows an arbitrary string (e.g. a router param) to a known goal type. */
export function isGoalType(value: string): value is GoalType {
  return GOAL_TYPES.some((goal) => goal.value === value);
}

/** Label for a goal type, or `null` when the value is not one we know. */
export function goalTypeLabel(value: string): string | null {
  return GOAL_TYPES.find((goal) => goal.value === value)?.label ?? null;
}

/** Milliseconds in a day. A fixed duration, not a calendar day — see below. */
const MS_PER_DAY = 86_400_000;

/**
 * Days left on a bet, or `null` when `createdAt` cannot be read.
 *
 * `null` (rather than `NaN` or a guessed `0`) is what lets a screen *hide* the
 * counter instead of rendering "NaN days left" from a malformed timestamp —
 * the same "never `NaN`" rule the form parsers follow.
 *
 * Clamped at both ends:
 *  - elapsed is floored at `0`, so a `createdAt` slightly in the future (clock
 *    skew between device and server is normal) cannot inflate the number above
 *    `targetDays`;
 *  - the result is floored at `0`, so a bet past its target reads `0 days left`
 *    rather than a negative countdown.
 *
 * On the day of creation `elapsed` is `0`, so the full `targetDays` shows.
 *
 * `now` is injectable purely so this is deterministic under a test runner; no
 * caller should need to pass it.
 *
 * Note this is a fixed 86 400 000 ms division, per the product rule — a
 * *duration*, not a calendar difference, so a DST boundary can shift the tick
 * by an hour. Deliberate, not an oversight.
 */
export function daysRemaining(
  createdAt: string,
  targetDays: number,
  now: number = Date.now(),
): number | null {
  const startedAt = Date.parse(createdAt);
  if (Number.isNaN(startedAt)) return null;
  if (!Number.isFinite(targetDays)) return null;

  const elapsed = Math.max(0, Math.floor((now - startedAt) / MS_PER_DAY));

  return Math.max(0, targetDays - elapsed);
}

/** `1` → `1 day left`; `0` and `30` → `0 days left` / `30 days left`. */
export function formatDaysRemaining(days: number): string {
  return days === 1 ? '1 day left' : `${days} days left`;
}

/** `1` → `1 day`; anything else → `N days`. */
export function formatDayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

export const TARGET_DAYS_MIN = 1;
export const TARGET_DAYS_MAX = 365;
export const TARGET_DAYS_DEFAULT = 30;

/** R$ 1,00 — the smallest stake the product allows. */
export const STAKE_MIN_CENTS = 100;
/**
 * R$ 1.000,00. Deliberately stricter than the API's own ceiling; see
 * `src/domain/CLAUDE.md` before raising it.
 */
export const STAKE_MAX_CENTS = 100_000;
