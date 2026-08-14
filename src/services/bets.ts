import { ApiError, NetworkError, getJson, postJson } from './apiClient';

/**
 * Bets against the TaPago API.
 *
 * A user may hold exactly one bet "in flight" (`pending` or `active`) at a
 * time; the API enforces that with a partial unique index and answers `409` to
 * a second attempt. Screens should treat `getActiveBet()` as the source of
 * truth for whether the user already has one.
 *
 * Creating a bet places a Mercado Pago pre-authorisation hold on a saved card,
 * so `createBet` is *not* idempotent — see the retry note on it.
 */

/** The habit a bet is staked on. */
export type GoalType = 'exercise' | 'no_smoking';

/**
 * Lifecycle state of an in-flight bet.
 *
 * `pending` means the bet exists but the pre-authorisation has not landed
 * (the provider was unavailable). It still occupies the user's one slot.
 */
export type BetStatus = 'pending' | 'active';

/** A bet as the API describes it. */
export type Bet = {
  id: string;
  goalType: GoalType;
  targetDays: number;
  /**
   * Money as exact text, e.g. `"50.00"`. Deliberately **not** a `number`:
   * binary floats cannot represent centavos exactly, and this value is echoed
   * straight back to the API and shown to the user. Format it for display;
   * never parse it into arithmetic.
   */
  stakeAmountBrl: string;
  status: BetStatus;
  /** RFC3339 timestamp. */
  createdAt: string;
};

/** Everything needed to open a bet. */
export type CreateBetParams = {
  goalType: GoalType;
  /** 1–365. The API rejects anything outside that range with `400`. */
  targetDays: number;
  /** Positive, at most two decimals, up to `"10000.00"`. */
  stakeAmountBrl: string;
  /** UUID of one of the caller's saved payment methods. */
  paymentMethodId: string;
};

const GOAL_TYPES: readonly GoalType[] = ['exercise', 'no_smoking'];
const BET_STATUSES: readonly BetStatus[] = ['pending', 'active'];

/**
 * `POST /v1/bets` performs an outbound pre-authorisation against Mercado Pago,
 * which regularly outlasts the default 15s. Aborting the client does not undo
 * a bet the server may already have created.
 */
const CREATE_BET_TIMEOUT_MS = 30_000;

function malformed(): NetworkError {
  return new NetworkError('Received a malformed response from the server');
}

/**
 * Narrow an unknown API payload to `Bet`, or reject it.
 *
 * Pure and exported so it is directly testable. Enum-ish fields are checked
 * against their literal unions rather than cast: an unfamiliar `status` from a
 * future API version must fail here, loudly, instead of leaking into a screen's
 * `switch` and rendering nothing.
 */
export function parseBet(payload: unknown): Bet {
  if (typeof payload !== 'object' || payload === null) {
    throw malformed();
  }

  const {
    id,
    goal_type: goalType,
    target_days: targetDays,
    stake_amount_brl: stakeAmountBrl,
    status,
    created_at: createdAt,
  } = payload as Record<string, unknown>;

  if (typeof id !== 'string' || id.length === 0) throw malformed();
  if (typeof goalType !== 'string' || !GOAL_TYPES.includes(goalType as GoalType)) {
    throw malformed();
  }
  if (typeof targetDays !== 'number' || !Number.isInteger(targetDays)) throw malformed();
  if (typeof stakeAmountBrl !== 'string' || stakeAmountBrl.length === 0) throw malformed();
  if (typeof status !== 'string' || !BET_STATUSES.includes(status as BetStatus)) {
    throw malformed();
  }
  if (typeof createdAt !== 'string' || createdAt.length === 0) throw malformed();

  return {
    id,
    goalType: goalType as GoalType,
    targetDays,
    stakeAmountBrl,
    status: status as BetStatus,
    createdAt,
  };
}

/**
 * Open a bet and place the pre-authorisation hold. `POST /v1/bets`.
 *
 * **Not idempotent, and never blind-retry it.** A `503` leaves the bet
 * `pending` on the server, and a `pending` bet occupies the user's single
 * in-flight slot — so calling this again returns `409`, not a new bet. The same
 * applies after a client-side timeout or abort: the server may have created the
 * bet anyway. The correct recovery on any of those outcomes is `getActiveBet()`
 * to see what actually exists.
 *
 * @throws {ApiError} 400 validation, 401 signed out, 402 card declined,
 *   404 unknown payment method, 409 a bet is already in flight, 500, 503.
 * @throws {NetworkError} when the request could not complete.
 */
export async function createBet(params: CreateBetParams, signal?: AbortSignal): Promise<Bet> {
  const payload = await postJson<unknown>(
    '/v1/bets',
    {
      goal_type: params.goalType,
      target_days: params.targetDays,
      stake_amount_brl: params.stakeAmountBrl,
      payment_method_id: params.paymentMethodId,
    },
    { signal, auth: true, timeoutMs: CREATE_BET_TIMEOUT_MS },
  );
  return parseBet(payload);
}

/**
 * The caller's in-flight bet, or `null` if they have none.
 * `GET /v1/bets/active`.
 *
 * "No active bet" is a normal state, not a failure, so the API's `404` is
 * translated to `null` and screens need no try/catch for the common case. Every
 * other status still throws.
 *
 * Includes `pending` bets deliberately: one stranded by a provider outage still
 * occupies the user's slot, and hiding it would let them try to open a second.
 *
 * @throws {ApiError} for any non-404 error status.
 * @throws {NetworkError} when the request could not complete.
 */
export async function getActiveBet(signal?: AbortSignal): Promise<Bet | null> {
  try {
    const payload = await getJson<unknown>('/v1/bets/active', { signal, auth: true });
    return parseBet(payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Turn a thrown error into copy we are willing to show a user.
 *
 * Exhaustive by status, per the API contract. Raw error messages are never
 * surfaced — they leak implementation detail and read as a crash.
 */
export function describeBetError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return "Those bet details aren't valid. Check the amount and duration, then try again.";
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 402:
        return 'Your card was declined. Try a different payment method.';
      case 404:
        return "We couldn't find that payment method. Please choose another one.";
      case 409:
        return 'You already have a bet running. Finish it before starting another.';
      case 503:
        return 'Payments are unavailable right now. Please try again in a few minutes.';
      default:
        return error.status >= 500
          ? 'Something went wrong on our end. Please try again in a moment.'
          : "We couldn't set up your bet. Please try again.";
    }
  }

  if (error instanceof NetworkError) {
    return "We couldn't reach TaPago. Check your connection and try again.";
  }

  return "We couldn't set up your bet. Please try again.";
}
