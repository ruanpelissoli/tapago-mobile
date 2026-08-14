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
