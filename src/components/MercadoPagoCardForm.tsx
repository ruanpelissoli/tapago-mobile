import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  buildCardFormHtml,
  buildFailAfterTokenScript,
  buildSetSavingScript,
  MP_ALLOWED_URL_PREFIXES,
  MP_BASE_URL,
  parseBridgeMessage,
  type CardTokenResult,
} from '../services/mercadoPago';
import { colors, fontSizes, fontWeights, lineHeights, MIN_TOUCH_TARGET, radii, spacing } from '../theme';

/**
 * How long to wait for the page's `ready` handshake before calling it a
 * failure. `onError` only fires when the *document* fails; here the document is
 * a local string that always renders, so a page that can't reach
 * `sdk.mercadopago.com` would otherwise sit blank forever.
 */
const READY_TIMEOUT_MS = 12_000;

type MercadoPagoCardFormProps = {
  /** Mercado Pago public key. Callers gate on `MERCADO_PAGO_ENABLED` first. */
  publicKey: string;
  /** Fired once per tokenisation, with the only card data allowed out. */
  onToken: (result: CardTokenResult) => void;
  onCancel: () => void;
  /** True while the caller is saving the token; keeps the form locked. */
  isSaving: boolean;
  /**
   * A save failure *after* Mercado Pago issued a token. Pushing it in clears the
   * card fields, because the token is spent and cannot be reused.
   */
  saveError: string | null;
};

/**
 * Hosts Mercado Pago's browser SDK in a `WebView` so card details are typed into
 * a web document and tokenised there.
 *
 * The card number and CVV exist only inside that document — never in React
 * state, props, logs, or any request to our API. That boundary is what keeps
 * TaPago out of PCI scope; see `src/services/CLAUDE.md`.
 *
 * Purely presentational: it owns no network call and no navigation. The screen
 * decides what a token means.
 */
export function MercadoPagoCardForm({
  publicKey,
  onToken,
  onCancel,
  isSaving,
  saveError,
}: MercadoPagoCardFormProps) {
  const webViewRef = useRef<WebView>(null);

  // Bumping this remounts the WebView, which is how "Try again" re-runs the
  // whole load — reloading in place would keep a half-initialised SDK around.
  const [attempt, setAttempt] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const html = useMemo(() => buildCardFormHtml(publicKey), [publicKey]);

  useEffect(() => {
    if (isReady || loadError !== null) return;

    const timer = setTimeout(() => {
      setLoadError("We couldn't load the secure card form. Check your connection and try again.");
    }, READY_TIMEOUT_MS);

    // `attempt` is deliberately absent: "Try again" clears `loadError`, and that
    // transition is what re-arms this timer.
    return () => clearTimeout(timer);
  }, [isReady, loadError]);

  // Keep the page's submit button in step with the save that follows
  // tokenisation, so it cannot be pressed twice.
  useEffect(() => {
    if (!isReady) return;
    webViewRef.current?.injectJavaScript(buildSetSavingScript(isSaving));
  }, [isReady, isSaving]);

  // A spent token can never be retried, so a save failure has to reach the page
  // and clear the card fields. Tracked by ref so the same message re-fired for a
  // second failed attempt still gets through, and a re-render never replays it.
  const handledSaveError = useRef<string | null>(null);
  useEffect(() => {
    if (!isReady) return;
    if (saveError === null) {
      handledSaveError.current = null;
      return;
    }
    if (handledSaveError.current === saveError) return;

    handledSaveError.current = saveError;
    webViewRef.current?.injectJavaScript(buildFailAfterTokenScript(saveError));
  }, [isReady, saveError]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // Never log this payload: on the token path it carries the card token.
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (message === null) return;

      switch (message.type) {
        case 'ready':
          setIsReady(true);
          setLoadError(null);
          return;
        case 'error':
          setLoadError(message.message);
          return;
        case 'token':
          onToken({
            cardToken: message.cardToken,
            lastFour: message.lastFour,
            cardBrand: message.cardBrand,
          });
      }
    },
    [onToken],
  );

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setIsReady(false);
    handledSaveError.current = null;
    setAttempt((previous) => previous + 1);
  }, []);

  const handleLoadFailure = useCallback(() => {
    setLoadError("We couldn't load the secure card form. Check your connection and try again.");
  }, []);

  return (
    <View style={styles.container} testID="wallet-card-form">
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Add card
        </Text>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel adding a card"
          testID="wallet-card-form-cancel"
          style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>

      {loadError !== null ? (
        <View style={styles.fallback}>
          <Text
            style={styles.error}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="wallet-card-form-error"
          >
            {loadError}
          </Text>
          <Pressable
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Try loading the card form again"
            testID="wallet-card-form-retry"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.webViewWrapper}>
          <WebView
            key={attempt}
            ref={webViewRef}
            // `baseUrl` gives the document an https origin. Without it Android
            // refuses to run the remote SDK script — do not remove it.
            source={{ html, baseUrl: MP_BASE_URL }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            // The page is ours and never navigates. Blocking anything else means
            // a hostile redirect can't become a `postMessage` source.
            onShouldStartLoadWithRequest={(request) =>
              MP_ALLOWED_URL_PREFIXES.some((prefix) => request.url.startsWith(prefix))
            }
            onMessage={handleMessage}
            onError={handleLoadFailure}
            onHttpError={handleLoadFailure}
            style={styles.webView}
            testID="wallet-card-form-webview"
          />

          {(!isReady || isSaving) && (
            <View
              style={styles.overlay}
              accessibilityRole="progressbar"
              accessibilityLabel={isSaving ? 'Saving card' : 'Loading card form'}
              testID="wallet-card-form-overlay"
            >
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    fontWeight: fontWeights.semibold,
  },
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  cancelPressed: {
    backgroundColor: colors.backgroundAlt,
  },
  cancelLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.medium,
  },
  webViewWrapper: {
    flex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    textAlign: 'center',
  },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  retryPressed: {
    backgroundColor: colors.primaryMuted,
  },
  retryLabel: {
    color: colors.primaryDark,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.semibold,
  },
});

export default MercadoPagoCardForm;
