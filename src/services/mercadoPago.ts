import { colors, fontSizes, MIN_TOUCH_TARGET, radii, spacing } from '../theme';

/**
 * The Mercado Pago card-tokenisation contract, as a pure module.
 *
 * Card details are collected inside a `WebView` running Mercado Pago's browser
 * SDK, **never** in React Native state. That is not a stylistic choice: a PAN or
 * CVV in RN state would put this app in PCI scope, and `src/services/CLAUDE.md`
 * forbids it outright. This module owns the page that does the collecting and
 * the narrow message protocol it speaks back over — so the only card-related
 * values that can ever reach JS are a single-use token, the last four digits and
 * the brand.
 *
 * No React and no `react-native-webview` import here on purpose: everything is a
 * string in and a string out, which keeps it testable and keeps
 * `MercadoPagoCardForm.tsx` to rendering.
 */

/** Mercado Pago's browser SDK, v2. */
export const MP_SDK_URL = 'https://sdk.mercadopago.com/js/v2';

/**
 * `baseUrl` for the WebView's HTML source.
 *
 * Load-bearing: with the default (`about:blank`) origin, Android refuses to run
 * the remote SDK script and blocks its XHRs as mixed/opaque-origin content, and
 * the form silently never initialises. Do not "simplify" this away.
 */
export const MP_BASE_URL = 'https://sdk.mercadopago.com';

/** Origins the in-form WebView is allowed to navigate to. */
export const MP_ALLOWED_URL_PREFIXES = ['about:blank', 'about:srcdoc', MP_BASE_URL] as const;

/** A token the page produced. The only card data allowed across the bridge. */
export type CardTokenResult = {
  /** Single-use, short-lived Mercado Pago card token. */
  cardToken: string;
  lastFour: string;
  /** Mercado Pago's own brand id, e.g. `visa`, `master`. */
  cardBrand: string;
};

/**
 * Everything the page may say to React Native.
 *
 * `error` means the form could not be *initialised* (the SDK script never
 * loaded, or the key was rejected) — it is fatal and RN shows a retry. Ordinary
 * validation and card-declined failures are rendered inside the page itself, so
 * the user keeps their typing and the PAN never has to leave the WebView to
 * produce a message.
 */
export type BridgeMessage =
  | { type: 'ready' }
  | ({ type: 'token' } & CardTokenResult)
  | { type: 'error'; message: string };

/**
 * Narrow a raw `onMessage` payload, or return `null`.
 *
 * Nothing is cast and nothing is logged. A WebView message is untrusted input
 * (a redirected page could send anything), so an unrecognised shape is dropped
 * rather than passed along half-checked.
 */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;

  if (record.type === 'ready') {
    return { type: 'ready' };
  }

  if (record.type === 'error') {
    const { message } = record;
    if (typeof message !== 'string' || message.length === 0) return null;
    return { type: 'error', message };
  }

  if (record.type === 'token') {
    const { cardToken, lastFour, cardBrand } = record;
    if (typeof cardToken !== 'string' || cardToken.length === 0) return null;
    if (typeof lastFour !== 'string') return null;
    if (typeof cardBrand !== 'string') return null;
    return { type: 'token', cardToken, lastFour, cardBrand };
  }

  return null;
}

/**
 * Script that tells the page a save is (or is no longer) in flight, so submit
 * stays disabled and the spinner keeps running while `addPaymentMethod` runs.
 */
export function buildSetSavingScript(isSaving: boolean): string {
  return `window.__tapagoSetSaving && window.__tapagoSetSaving(${isSaving ? 'true' : 'false'}); true;`;
}

/**
 * Script for the one recovery path that cannot be retried: Mercado Pago issued a
 * token but our API refused it. The token is spent, so the page clears the card
 * fields and asks for the card again rather than re-submitting the same one.
 */
export function buildFailAfterTokenScript(message: string): string {
  return `window.__tapagoFailAfterToken && window.__tapagoFailAfterToken(${JSON.stringify(
    message,
  )}); true;`;
}

const px = (value: number) => `${value}px`;

/**
 * The self-contained card-entry page.
 *
 * All colours and metrics are interpolated from `src/theme`, so the form still
 * has exactly one source of truth for styling even though it is a web document
 * — no hex literal is typed by hand here. The public key goes through
 * `JSON.stringify` so it can never break out of the script literal.
 */
export function buildCardFormHtml(publicKey: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
<title>Add card</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: ${px(spacing.md)};
    background: ${colors.background};
    color: ${colors.text};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: ${px(fontSizes.md)};
    -webkit-text-size-adjust: 100%;
  }
  .intro {
    margin: 0 0 ${px(spacing.md)};
    color: ${colors.textSecondary};
    font-size: ${px(fontSizes.sm)};
    line-height: 1.4;
  }
  .field { margin-bottom: ${px(spacing.md)}; }
  .row { display: flex; gap: ${px(spacing.sm)}; }
  .row .field { flex: 1; }
  label {
    display: block;
    margin-bottom: ${px(spacing.xs)};
    font-size: ${px(fontSizes.sm)};
    font-weight: 600;
    color: ${colors.text};
  }
  input {
    width: 100%;
    min-height: ${px(MIN_TOUCH_TARGET)};
    padding: ${px(spacing.sm)} ${px(spacing.md)};
    border: 1px solid ${colors.border};
    border-radius: ${px(radii.md)};
    background: ${colors.surface};
    color: ${colors.text};
    font-size: ${px(fontSizes.md)};
    font-family: inherit;
  }
  input:focus { outline: none; border-color: ${colors.primary}; }
  input.invalid { border-color: ${colors.danger}; }
  .hint {
    margin: ${px(spacing.xs)} 0 0;
    font-size: ${px(fontSizes.xs)};
    color: ${colors.textSecondary};
  }
  .error {
    margin: ${px(spacing.xs)} 0 0;
    font-size: ${px(fontSizes.xs)};
    color: ${colors.danger};
  }
  #form-error {
    margin: 0 0 ${px(spacing.md)};
    padding: ${px(spacing.sm)} ${px(spacing.md)};
    border-radius: ${px(radii.md)};
    background: ${colors.backgroundAlt};
    color: ${colors.danger};
    font-size: ${px(fontSizes.sm)};
    line-height: 1.4;
  }
  #form-error[hidden] { display: none; }
  button {
    width: 100%;
    min-height: ${px(MIN_TOUCH_TARGET)};
    margin-top: ${px(spacing.sm)};
    padding: ${px(spacing.sm)} ${px(spacing.md)};
    border: 0;
    border-radius: ${px(radii.md)};
    background: ${colors.primary};
    color: ${colors.onPrimary};
    font-size: ${px(fontSizes.md)};
    font-weight: 600;
    font-family: inherit;
  }
  button[disabled] { background: ${colors.border}; color: ${colors.textSecondary}; }
  .footnote {
    margin: ${px(spacing.md)} 0 ${px(spacing.xl)};
    font-size: ${px(fontSizes.xs)};
    color: ${colors.textMuted};
    line-height: 1.4;
  }
</style>
</head>
<body>
  <p class="intro">Your card is sent straight to Mercado Pago. TaPago only ever stores the brand and the last four digits.</p>

  <p id="form-error" role="alert" aria-live="polite" hidden></p>

  <form id="card-form" novalidate>
    <div class="field">
      <label for="card-number">Card number</label>
      <input id="card-number" name="cardNumber" type="text" inputmode="numeric" autocomplete="cc-number"
             placeholder="0000 0000 0000 0000" maxlength="23" />
      <p class="error" id="card-number-error" hidden></p>
    </div>

    <div class="row">
      <div class="field">
        <label for="card-expiry">Expiry</label>
        <input id="card-expiry" name="cardExpiry" type="text" inputmode="numeric" autocomplete="cc-exp"
               placeholder="MM/YY" maxlength="5" />
        <p class="error" id="card-expiry-error" hidden></p>
      </div>
      <div class="field">
        <label for="card-cvv">CVV</label>
        <input id="card-cvv" name="cardCvv" type="text" inputmode="numeric" autocomplete="cc-csc"
               placeholder="123" maxlength="4" />
        <p class="error" id="card-cvv-error" hidden></p>
      </div>
    </div>

    <div class="field">
      <label for="card-name">Cardholder name</label>
      <input id="card-name" name="cardName" type="text" autocomplete="cc-name" placeholder="As printed on the card" />
      <p class="error" id="card-name-error" hidden></p>
    </div>

    <div class="field">
      <label for="card-cpf">CPF</label>
      <input id="card-cpf" name="cardCpf" type="text" inputmode="numeric" placeholder="000.000.000-00" maxlength="14" />
      <p class="hint">Mercado Pago requires the cardholder's CPF to issue a card token in Brazil.</p>
      <p class="error" id="card-cpf-error" hidden></p>
    </div>

    <button type="submit" id="submit-button">Save card</button>
  </form>

  <p class="footnote">Card number and CVV never leave this form and are never sent to TaPago.</p>

<script>
(function () {
  var PUBLIC_KEY = ${JSON.stringify(publicKey)};
  var SDK_URL = ${JSON.stringify(MP_SDK_URL)};
  var mp = null;
  var busy = false;

  function post(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  var el = function (id) { return document.getElementById(id); };
  var form = el('card-form');
  var submitButton = el('submit-button');
  var formError = el('form-error');
  var inputs = {
    number: el('card-number'),
    expiry: el('card-expiry'),
    cvv: el('card-cvv'),
    name: el('card-name'),
    cpf: el('card-cpf')
  };

  function digits(value) { return String(value || '').replace(/[^0-9]+/g, ''); }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
    formError.scrollIntoView({ block: 'nearest' });
  }

  function clearFormError() {
    formError.textContent = '';
    formError.hidden = true;
  }

  function setFieldError(key, message) {
    var input = inputs[key];
    var node = el('card-' + key + '-error');
    if (message) {
      node.textContent = message;
      node.hidden = false;
      input.classList.add('invalid');
    } else {
      node.textContent = '';
      node.hidden = true;
      input.classList.remove('invalid');
    }
  }

  function clearFieldErrors() {
    ['number', 'expiry', 'cvv', 'name', 'cpf'].forEach(function (key) { setFieldError(key, ''); });
  }

  function setBusy(next) {
    busy = next;
    submitButton.disabled = next;
    submitButton.textContent = next ? 'Saving…' : 'Save card';
  }

  // --- input masking (display only; nothing here is ever transmitted) --------
  inputs.number.addEventListener('input', function () {
    var value = digits(inputs.number.value).slice(0, 19);
    inputs.number.value = value.replace(/(.{4})/g, '$1 ').trim();
  });

  inputs.expiry.addEventListener('input', function () {
    var value = digits(inputs.expiry.value).slice(0, 4);
    inputs.expiry.value = value.length > 2 ? value.slice(0, 2) + '/' + value.slice(2) : value;
  });

  inputs.cvv.addEventListener('input', function () {
    inputs.cvv.value = digits(inputs.cvv.value).slice(0, 4);
  });

  inputs.cpf.addEventListener('input', function () {
    var value = digits(inputs.cpf.value).slice(0, 11);
    var out = value.slice(0, 3);
    if (value.length > 3) out += '.' + value.slice(3, 6);
    if (value.length > 6) out += '.' + value.slice(6, 9);
    if (value.length > 9) out += '-' + value.slice(9, 11);
    inputs.cpf.value = out;
  });

  // --- local validation, so an obviously wrong card never costs a round trip -
  function luhn(value) {
    var sum = 0;
    var alternate = false;
    for (var i = value.length - 1; i >= 0; i--) {
      var digit = parseInt(value.charAt(i), 10);
      if (alternate) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      alternate = !alternate;
    }
    return value.length > 0 && sum % 10 === 0;
  }

  function readExpiry() {
    var value = digits(inputs.expiry.value);
    if (value.length !== 4) return null;
    var month = parseInt(value.slice(0, 2), 10);
    if (!(month >= 1 && month <= 12)) return null;
    var year = 2000 + parseInt(value.slice(2), 10);
    var now = new Date();
    // Expired is "before the end of the printed month", so compare on month.
    if (year < now.getFullYear()) return null;
    if (year === now.getFullYear() && month < now.getMonth() + 1) return null;
    return { month: value.slice(0, 2), year: String(year) };
  }

  function validate() {
    clearFieldErrors();
    var ok = true;

    var pan = digits(inputs.number.value);
    if (pan.length < 13 || pan.length > 19 || !luhn(pan)) {
      setFieldError('number', 'Enter a valid card number.');
      ok = false;
    }

    var expiry = readExpiry();
    if (expiry === null) {
      setFieldError('expiry', 'Enter a valid expiry date (MM/YY).');
      ok = false;
    }

    var cvv = digits(inputs.cvv.value);
    if (cvv.length < 3 || cvv.length > 4) {
      setFieldError('cvv', 'Enter the 3 or 4 digit security code.');
      ok = false;
    }

    var name = String(inputs.name.value || '').trim();
    if (name.length < 2) {
      setFieldError('name', 'Enter the name printed on the card.');
      ok = false;
    }

    var cpf = digits(inputs.cpf.value);
    if (cpf.length !== 11) {
      setFieldError('cpf', 'Enter the 11 digit CPF.');
      ok = false;
    }

    return ok ? { pan: pan, expiry: expiry, cvv: cvv, name: name, cpf: cpf } : null;
  }

  // Fallback only. Mercado Pago's own BIN lookup is authoritative; this exists
  // so a flaky lookup does not block an otherwise valid card.
  function guessBrand(pan) {
    if (/^4/.test(pan)) return 'visa';
    if (/^(5[1-5]|2[2-7])/.test(pan)) return 'master';
    if (/^3[47]/.test(pan)) return 'amex';
    if (/^(4011|4312|4389|4514|4576|5041|5066|5067|5090|6277|6362|6363|650|6516|6550)/.test(pan)) return 'elo';
    if (/^(38|60)/.test(pan)) return 'hipercard';
    if (/^3(0[0-5]|[68])/.test(pan)) return 'diners';
    return 'unknown';
  }

  // Mercado Pago reports field-level problems as cause codes; the raw
  // descriptions are Spanish/Portuguese internals, so map the ones we know.
  var CAUSE_COPY = {
    '205': 'Enter a valid card number.',
    '208': 'Enter a valid expiry date (MM/YY).',
    '209': 'Enter a valid expiry date (MM/YY).',
    '212': "Enter the cardholder's CPF.",
    '213': "Enter the cardholder's CPF.",
    '214': "Enter the cardholder's CPF.",
    '220': 'That card issuer is not supported.',
    '221': 'Enter the name printed on the card.',
    '224': 'Enter the 3 or 4 digit security code.',
    'E301': 'Enter a valid card number.',
    'E302': 'Enter the 3 or 4 digit security code.',
    '316': 'Enter the name printed on the card.',
    '322': 'Enter a valid CPF.',
    '323': 'Enter a valid CPF.',
    '324': 'Enter a valid CPF.',
    '325': 'Enter a valid expiry date (MM/YY).',
    '326': 'Enter a valid expiry date (MM/YY).'
  };

  function describeMpError(error) {
    var causes = (error && error.cause) || [];
    for (var i = 0; i < causes.length; i++) {
      var code = causes[i] && causes[i].code;
      if (code !== undefined && CAUSE_COPY[String(code)]) {
        return CAUSE_COPY[String(code)];
      }
    }
    return "Mercado Pago couldn't accept that card. Check the details and try again.";
  }

  function resolveBrand(pan) {
    var bin = pan.slice(0, 8);
    if (!mp || typeof mp.getPaymentMethods !== 'function') {
      return Promise.resolve(guessBrand(pan));
    }
    return mp.getPaymentMethods({ bin: bin }).then(function (response) {
      var results = (response && response.results) || [];
      if (results.length > 0 && typeof results[0].id === 'string') {
        return results[0].id;
      }
      return guessBrand(pan);
    }).catch(function () {
      return guessBrand(pan);
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;

    clearFormError();

    if (mp === null) {
      showFormError('The card form is still loading. Please wait a moment and try again.');
      return;
    }

    var values = validate();
    if (values === null) return;

    setBusy(true);

    resolveBrand(values.pan).then(function (brand) {
      return mp.createCardToken({
        cardNumber: values.pan,
        cardholderName: values.name,
        cardExpirationMonth: values.expiry.month,
        cardExpirationYear: values.expiry.year,
        securityCode: values.cvv,
        identificationType: 'CPF',
        identificationNumber: values.cpf
      }).then(function (token) {
        if (!token || typeof token.id !== 'string') {
          throw new Error('no token');
        }
        var lastFour = typeof token.last_four_digits === 'string'
          ? token.last_four_digits
          : values.pan.slice(-4);
        // The only card data that ever crosses the bridge.
        post({ type: 'token', cardToken: token.id, lastFour: lastFour, cardBrand: brand });
      });
    }).catch(function (error) {
      setBusy(false);
      showFormError(describeMpError(error));
    });
  });

  // --- hooks React Native drives via injectJavaScript -----------------------
  window.__tapagoSetSaving = function (next) {
    setBusy(Boolean(next));
  };

  window.__tapagoFailAfterToken = function (message) {
    // The token is single-use and has now been spent, so the card must be
    // re-entered rather than resubmitted. Non-sensitive fields are kept.
    inputs.number.value = '';
    inputs.cvv.value = '';
    setBusy(false);
    showFormError(message);
    inputs.number.focus();
  };

  // --- SDK bootstrap --------------------------------------------------------
  var script = document.createElement('script');
  script.src = SDK_URL;
  script.onload = function () {
    try {
      mp = new window.MercadoPago(PUBLIC_KEY, { locale: 'pt-BR' });
      post({ type: 'ready' });
    } catch (error) {
      post({ type: 'error', message: 'Card payments are not configured correctly. Please try again later.' });
    }
  };
  script.onerror = function () {
    post({ type: 'error', message: "We couldn't load the secure card form. Check your connection and try again." });
  };
  document.head.appendChild(script);
})();
</script>
</body>
</html>`;
}
