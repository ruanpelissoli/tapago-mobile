import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from 'react-native';

import { MercadoPagoCardForm } from '../../src/components/MercadoPagoCardForm';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import {
  cardAccessibilityLabel,
  formatCardBrand,
  maskedCardLabel,
} from '../../src/domain/paymentMethod';
import { MERCADO_PAGO_ENABLED, MERCADO_PAGO_PUBLIC_KEY } from '../../src/services/env';
import {
  describePaymentMethodError,
  listPaymentMethods,
  addPaymentMethod,
  type PaymentMethod,
} from '../../src/services/paymentMethods';
import type { CardTokenResult } from '../../src/services/mercadoPago';
import {
  colors,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  spacing,
} from '../../src/theme';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Appended when a save fails after Mercado Pago has already spent the token. */
const RE_ENTER_CARD =
  'Your card details were not saved. Please enter the card again — the previous attempt can no longer be reused.';

const UNCONFIGURED_MESSAGE =
  'Adding a card is not available in this build because card payments are not configured.';

/**
 * Wallet: the saved cards a user can pay a bet stake with, plus the flow that
 * adds one.
 *
 * The add-card form is a **modal, not a route**. A Mercado Pago card token is
 * single-use and short-lived, so card entry must not be something a back stack
 * or a deep link can resurrect — and keeping the list mounted underneath is what
 * makes "cancel leaves the list untouched" true by construction rather than by
 * care.
 *
 * Every async path checks `signal.aborted` *before* touching state.
 * `apiClient` combines the caller's signal with its own 15s timeout, so an abort
 * and a timeout both surface as `NetworkError` and cannot be told apart from the
 * error — the signal is the only reliable "did we cancel this?" answer.
 */
export default function WalletScreen() {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const listController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  /** Double-fire guard: the WebView can post a token more than once. */
  const isSavingRef = useRef(false);

  /**
   * Fetches and applies the list. Deliberately does **not** flip `status` to
   * `loading` itself: doing so synchronously inside the mount effect trips
   * `react-hooks/set-state-in-effect`, and the initial state is already
   * `loading`. Callers that re-fetch use `reload`, which shows the spinner
   * first.
   *
   * Written as a promise chain rather than `async`/`await` so every `setState`
   * provably lives in a callback — the same shape `sign-in.tsx` uses, and what
   * keeps `react-hooks/set-state-in-effect` satisfied at the mount call below.
   */
  const loadMethods = useCallback(() => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;

    return listPaymentMethods(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        // `[]` is a state to render, never an error. Server order
        // (`is_default DESC, created_at DESC`) is kept exactly as received.
        setMethods(result);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setErrorMessage(describePaymentMethodError(error));
        setStatus('error');
      });
  }, []);

  const reload = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    await loadMethods();
  }, [loadMethods]);

  useEffect(() => {
    void loadMethods();
    return () => {
      listController.current?.abort();
      saveController.current?.abort();
    };
  }, [loadMethods]);

  const handleOpenForm = useCallback(() => {
    setSaveError(null);
    setIsFormOpen(true);
  }, []);

  const handleCloseForm = useCallback(() => {
    saveController.current?.abort();
    isSavingRef.current = false;
    setIsSaving(false);
    setSaveError(null);
    setIsFormOpen(false);
  }, []);

  /**
   * A token arrived from the WebView. It is spent the moment we use it, so a
   * failed save cannot be retried — the form is told to ask for the card again.
   */
  const handleToken = useCallback(
    async ({ cardToken, lastFour, cardBrand }: CardTokenResult) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;

      saveController.current?.abort();
      const controller = new AbortController();
      saveController.current = controller;

      setSaveError(null);
      setIsSaving(true);

      try {
        await addPaymentMethod({ cardToken, lastFour, cardBrand }, controller.signal);
        if (controller.signal.aborted) return;

        isSavingRef.current = false;
        setIsSaving(false);
        setIsFormOpen(false);
        await reload();
      } catch (error) {
        if (controller.signal.aborted) return;

        isSavingRef.current = false;
        setIsSaving(false);
        setSaveError(`${describePaymentMethodError(error)} ${RE_ENTER_CARD}`);
      }
    },
    [reload],
  );

  const handleTokenReceived = useCallback(
    (result: CardTokenResult) => {
      void handleToken(result);
    },
    [handleToken],
  );

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <View
          style={styles.centered}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading payment methods"
          testID="wallet-loading"
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={styles.centered}>
          <Text
            style={styles.error}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="wallet-error"
          >
            {errorMessage}
          </Text>
          <View style={styles.retryAction}>
            <PrimaryButton
              label="Try again"
              onPress={() => void reload()}
              testID="wallet-retry-button"
            />
          </View>
        </View>
      );
    }

    return (
      <FlatList
        data={methods}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          methods.length === 0 && styles.listContentEmpty,
        ]}
        renderItem={({ item }) => (
          <View
            style={styles.card}
            accessible
            accessibilityLabel={cardAccessibilityLabel(item)}
            testID={`payment-method-${item.id}`}
          >
            <View style={styles.cardText}>
              <Text style={styles.cardBrand}>{formatCardBrand(item.cardBrand)}</Text>
              <Text style={styles.cardNumber}>{maskedCardLabel(item.lastFour)}</Text>
            </View>
            {item.isDefault && (
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>Default</Text>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.centered} testID="wallet-empty">
            <Text style={styles.emptyTitle} accessibilityRole="header">
              No cards yet
            </Text>
            <Text style={styles.emptyBody}>
              Add a card to put money behind your next bet. We only ever store its brand and
              last four digits.
            </Text>
          </View>
        }
      />
    );
  };

  return (
    <ScreenContainer testID="wallet-screen">
      <View style={styles.body}>{renderBody()}</View>

      {status !== 'loading' && (
        <View style={styles.actions}>
          {!MERCADO_PAGO_ENABLED && (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="wallet-unconfigured"
            >
              {UNCONFIGURED_MESSAGE}
            </Text>
          )}
          <PrimaryButton
            label="Add card"
            onPress={handleOpenForm}
            disabled={!MERCADO_PAGO_ENABLED}
            testID="wallet-add-card-button"
          />
        </View>
      )}

      {/*
        `onRequestClose` covers the Android hardware back button, which would
        otherwise dismiss the modal without aborting the in-flight save.
      */}
      <Modal
        visible={isFormOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCloseForm}
      >
        <MercadoPagoCardForm
          publicKey={MERCADO_PAGO_PUBLIC_KEY}
          onToken={handleTokenReceived}
          onCancel={handleCloseForm}
          isSaving={isSaving}
          saveError={saveError}
        />
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardBrand: {
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.semibold,
  },
  cardNumber: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryMuted,
  },
  badgeLabel: {
    color: colors.primaryDark,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    fontWeight: fontWeights.semibold,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    fontWeight: fontWeights.semibold,
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    textAlign: 'center',
  },
  retryAction: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
});
