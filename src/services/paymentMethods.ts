import { ApiError, NetworkError, getJson, postJson } from './apiClient';

/**
 * Saved payment methods (cards) against the TaPago API.
 *
 * The app never handles raw card data. The Mercado Pago SDK collects the card
 * and returns a single-use token; only that token, the last four digits and the
 * brand ever reach this module. Keeping a PAN or CVV out of the bundle is what
 * keeps this app out of PCI scope — **never add a raw card field to these
 * types**, however convenient it looks.
 *
 * Responses never carry the provider's `mp_card_token` or `mp_customer_id`, so
 * nothing here should try to read them.
 */

/** A saved card as the API describes it. */
export type PaymentMethod = {
  id: string;
  /** Last four digits, for display only. */
  lastFour: string;
  /** Provider's brand string, e.g. `"visa"`. */
  cardBrand: string;
  isDefault: boolean;
  /** RFC3339 timestamp. */
  createdAt: string;
};

/** Everything needed to save a card. Tokenised — no raw card data. */
export type AddPaymentMethodParams = {
  /** Single-use card token from the Mercado Pago SDK. */
  cardToken: string;
  lastFour: string;
  cardBrand: string;
};

function malformed(): NetworkError {
  return new NetworkError('Received a malformed response from the server');
}

/**
 * Narrow an unknown API payload to `PaymentMethod`, or reject it.
 *
 * Pure and exported so it is directly testable. Nothing is cast: a missing
 * `isDefault` reaching a screen would silently render every card as
 * non-default, which is worse than a visible failure.
 */
export function parsePaymentMethod(payload: unknown): PaymentMethod {
  if (typeof payload !== 'object' || payload === null) {
    throw malformed();
  }

  const {
    id,
    last_four: lastFour,
    card_brand: cardBrand,
    is_default: isDefault,
    created_at: createdAt,
  } = payload as Record<string, unknown>;

  if (typeof id !== 'string' || id.length === 0) throw malformed();
  if (typeof lastFour !== 'string') throw malformed();
  if (typeof cardBrand !== 'string') throw malformed();
  if (typeof isDefault !== 'boolean') throw malformed();
  if (typeof createdAt !== 'string' || createdAt.length === 0) throw malformed();

  return { id, lastFour, cardBrand, isDefault, createdAt };
}

/**
 * Unwrap `{ "payment_methods": [...] }`, or reject it.
 *
 * The array is always present and `[]` is a valid, non-error result — a user
 * with no saved cards is a normal state, not a failure. Server order
 * (`is_default DESC, created_at DESC`) is preserved: re-sorting here would stop
 * the default card being first.
 */
export function parsePaymentMethodList(payload: unknown): PaymentMethod[] {
  if (typeof payload !== 'object' || payload === null) {
    throw malformed();
  }

  const { payment_methods: paymentMethods } = payload as Record<string, unknown>;
  if (!Array.isArray(paymentMethods)) {
    throw malformed();
  }

  return paymentMethods.map(parsePaymentMethod);
}

/**
 * Save a tokenised card. `POST /v1/payment-methods`.
 *
 * @throws {ApiError} 400 validation, 401 signed out, 503 provider unavailable, 500.
 * @throws {NetworkError} when the request could not complete.
 */
export async function addPaymentMethod(
  params: AddPaymentMethodParams,
  signal?: AbortSignal,
): Promise<PaymentMethod> {
  const payload = await postJson<unknown>(
    '/v1/payment-methods',
    {
      card_token: params.cardToken,
      last_four: params.lastFour,
      card_brand: params.cardBrand,
    },
    { signal, auth: true },
  );
  return parsePaymentMethod(payload);
}

/**
 * The caller's saved cards, in server order. `GET /v1/payment-methods`.
 *
 * An empty array means "no cards saved yet", which is a state to render, not an
 * error to report.
 *
 * @throws {ApiError} 401 signed out, 500.
 * @throws {NetworkError} when the request could not complete.
 */
export async function listPaymentMethods(signal?: AbortSignal): Promise<PaymentMethod[]> {
  const payload = await getJson<unknown>('/v1/payment-methods', { signal, auth: true });
  return parsePaymentMethodList(payload);
}

/**
 * Turn a thrown error into copy we are willing to show a user.
 *
 * Raw error messages are never surfaced. Provider detail in particular is not
 * in the response by design, so there is nothing more specific to say than this.
 */
export function describePaymentMethodError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return "Those card details weren't accepted. Please check them and try again.";
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 503:
        return 'Card payments are unavailable right now. Please try again in a few minutes.';
      default:
        return error.status >= 500
          ? 'Something went wrong on our end. Please try again in a moment.'
          : "We couldn't save that card. Please try again.";
    }
  }

  if (error instanceof NetworkError) {
    return "We couldn't reach TaPago. Check your connection and try again.";
  }

  return "We couldn't save that card. Please try again.";
}
