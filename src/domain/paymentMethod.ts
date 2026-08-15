/**
 * Display rules for saved cards.
 *
 * Pure and framework-free, like the rest of `src/domain`: the wallet screen
 * stays layout and wiring, and these are directly unit-testable the day a test
 * runner lands.
 */

/**
 * Mercado Pago `payment_method_id` values we know how to name.
 *
 * These are the provider's own identifiers (`master`, not `mastercard`), which
 * is exactly what the API stores in `card_brand` — so the keys must stay in
 * Mercado Pago's spelling, not ours.
 */
const BRAND_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  visa: 'Visa',
  master: 'Mastercard',
  amex: 'American Express',
  elo: 'Elo',
  hipercard: 'Hipercard',
  hiper: 'Hiper',
  diners: 'Diners Club',
  discover: 'Discover',
  jcb: 'JCB',
  cabal: 'Cabal',
  maestro: 'Maestro',
  debvisa: 'Visa Débito',
  debmaster: 'Mastercard Débito',
  debelo: 'Elo Débito',
};

/** The mask shown in place of the digits we never receive. */
const MASK = '••••';

/**
 * Human-readable brand name.
 *
 * Unknown identifiers fall back to a capitalised form of whatever the API sent
 * rather than to a blank or to "Card": Mercado Pago adds brands over time, and a
 * new one should still render as *something* recognisable instead of silently
 * disappearing from the row.
 */
export function formatCardBrand(cardBrand: string): string {
  const key = cardBrand.trim().toLowerCase();
  if (key === '') return 'Card';

  const known = BRAND_DISPLAY_NAMES[key];
  if (known !== undefined) return known;

  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** `•••• 1234`, or just the mask when the API sent no last four. */
export function maskedCardLabel(lastFour: string): string {
  const digits = lastFour.trim();
  return digits === '' ? MASK : `${MASK} ${digits}`;
}

/**
 * What a screen reader should announce for a card row.
 *
 * Built separately from the visible label because reading out four bullet
 * characters is noise: "Visa ending in 1234" is the same information said in a
 * way that survives being spoken.
 */
export function cardAccessibilityLabel(params: {
  cardBrand: string;
  lastFour: string;
  isDefault: boolean;
}): string {
  const brand = formatCardBrand(params.cardBrand);
  const digits = params.lastFour.trim();
  const base = digits === '' ? brand : `${brand} ending in ${digits}`;
  return params.isDefault ? `${base}, default card` : base;
}
