import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { goalTypeLabel, isGoalType, type GoalType } from '../../src/domain/bet';
import {
  centsToApiAmount,
  formatCentsAsBrl,
  parseStakeCentsParam,
  parseTargetDays,
} from '../../src/domain/betForm';
import {
  cardAccessibilityLabel,
  formatCardBrand,
  maskedCardLabel,
} from '../../src/domain/paymentMethod';
import { ApiError, NetworkError } from '../../src/services/apiClient';
import { createBet, describeBetError, getActiveBet } from '../../src/services/bets';
import {
  describePaymentMethodError,
  listPaymentMethods,
  type PaymentMethod,
} from '../../src/services/paymentMethods';
import {
  colors,
  fontSizes,
  fontWeights,
  lineHeights,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../src/theme';

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * What the user can *do* about a failed submit. The copy always comes from
 * `describeBetError`; only the action differs by status, and getting that wrong
 * is what turns a recoverable failure into a stuck screen.
 *
 * - `choose-card` — 400/402/404/500: the bet was not created, so picking another
 *   card and submitting again is a real fix.
 * - `go-home`     — 409: a bet is already in flight. A retry can only 409 again.
 * - `retry`       — reconciliation proved no bet exists, so `createBet` is safe
 *   to call once more.
 * - `reconcile`   — the reconciliation itself failed, so we still do not know
 *   whether a bet exists. Only `getActiveBet` may be re-run, never `createBet`.
 * - `none`        — 401: nothing on this screen can fix a dead session.
 */
type Recovery = 'choose-card' | 'go-home' | 'retry' | 'reconcile' | 'none';

type SubmitFailure = {
  message: string;
  recovery: Recovery;
};

const INVALID_PARAMS_MESSAGE =
  "We couldn't read the goal, duration and stake for this bet. Go back and set them up again.";

const SUCCESS_TITLE = 'Bet created';
const SUCCESS_BODY =
  'Your stake is on hold on the card you chose. Keep it up and nothing is charged.';

/** Router params arrive as `string | string[]`; take the first value if repeated. */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * "We could not reach a verdict" — the only two outcomes after which the server
 * may hold a bet we do not know about. A `503` leaves the bet `pending`, and a
 * client timeout or abort surfaces as `NetworkError` while the request may have
 * completed server-side anyway.
 */
function isUnresolved(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return error instanceof ApiError && error.status === 503;
}

/** Recovery for the statuses that definitely did *not* leave a bet behind. */
function recoveryForError(error: unknown): Recovery {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'go-home';
    if (error.status === 401) return 'none';
  }
  // 400 / 402 / 404 / 500 and anything unrecognised: the bet was not created,
  // so a different card plus another attempt is a genuine fix.
  return 'choose-card';
}

/**
 * Step 2 of the create-bet flow: pick a saved card and open the bet.
 *
 * Every param from step 1 is re-parsed rather than trusted — a hand-typed deep
 * link can carry anything, and submitting `NaN` days is worse than refusing.
 *
 * Two rules drive the whole file:
 *
 * 1. **`createBet` is not idempotent and is never blind-retried.** A `503`
 *    leaves the bet `pending` server-side, a `pending` bet occupies the user's
 *    single in-flight slot, and aborting the fetch cancels *nothing* on the
 *    server. So on `503`/`NetworkError` we reconcile with `getActiveBet()`
 *    instead of retrying, and an abort is only ever a reason to skip a
 *    `setState` — never evidence that the bet did not happen.
 * 2. **Abort *before* `setState`, always.** `apiClient` merges the caller's
 *    signal with its own timeout, so an abort and a timeout are indistinguishable
 *    from the error object; `controller.signal.aborted` is the only reliable
 *    "did we cancel this?".
 */
export default function CreateBetPaymentScreen() {
  const params = useLocalSearchParams<{
    goalType?: string;
    targetDays?: string;
    stakeCents?: string;
  }>();

  const goalTypeParam = firstParam(params.goalType);
  // Narrowed to the union rather than cast: `createBet` takes a `GoalType`, and
  // a cast is exactly what this re-validation exists to avoid.
  const goalType: GoalType | null = isGoalType(goalTypeParam) ? goalTypeParam : null;
  const targetDays = parseTargetDays(firstParam(params.targetDays));
  const stakeCents = parseStakeCentsParam(firstParam(params.stakeCents));
  const paramsValid = goalType !== null && targetDays !== null && stakeCents !== null;

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<SubmitFailure | null>(null);

  const listController = useRef<AbortController | null>(null);
  const submitController = useRef<AbortController | null>(null);
  /**
   * Double-submit guard. The `disabled` prop alone is not enough: a second tap
   * can already be queued when the first one flips state, and each extra
   * `createBet` is a real pre-authorisation attempt. Mirrors `hasNavigated` in
   * `create-bet.tsx` and `isSavingRef` in `wallet.tsx`.
   */
  const isSubmittingRef = useRef(false);
  /** The `createBet` error being reconciled, so "Check bet status" can re-run. */
  const submitErrorRef = useRef<unknown>(null);

  /**
   * Fetches and applies the card list. Deliberately does **not** flip `status`
   * to `loading` itself: doing so synchronously from an effect body trips
   * `react-hooks/set-state-in-effect`, which is an *error* in this repo's lint
   * config. Initial state is already `loading`; `reload` is the wrapper that
   * shows the spinner for the retry path.
   *
   * Written as a promise chain rather than `async`/`await` so every `setState`
   * provably lives in a callback — the same shape `wallet.tsx` uses. Do not
   * "simplify" it back to `async`; lint will fail.
   *
   * Not flipping `status` also makes the refetch-on-focus *silent*: returning
   * from the wallet replaces the list in place instead of blinking through a
   * full-screen spinner.
   */
  const loadMethods = useCallback(() => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;

    return listPaymentMethods(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        // `[]` is a state to render, never an error. Server order
        // (`is_default DESC, created_at DESC`) is kept exactly as received —
        // no client sort, which is what keeps the default card first.
        setMethods(result);
        // Functional update so this callback never closes over `selectedId`,
        // which would re-create it and re-fire the focus effect on every load.
        // One expression covers all three selection rules: pre-select the
        // first card, keep a still-present selection, and fall back to the
        // first when the previous card is gone or nothing was selected.
        setSelectedId((previous) => {
          if (result.length === 0) return null;
          if (previous !== null && result.some((method) => method.id === previous)) {
            return previous;
          }
          return result[0].id;
        });
        setListError(null);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        setListError(describePaymentMethodError(error));
        setStatus('error');
      });
  }, []);

  const reload = useCallback(async () => {
    setStatus('loading');
    setListError(null);
    await loadMethods();
  }, [loadMethods]);

  /**
   * Refetch on focus is the *whole* contract with the wallet: the user adds a
   * card there and comes back with the system back button, so there is no
   * callback or return-param channel to build. It also covers the first mount.
   */
  useFocusEffect(
    useCallback(() => {
      if (!paramsValid) return;

      void loadMethods();
      return () => {
        listController.current?.abort();
      };
    }, [paramsValid, loadMethods]),
  );

  useEffect(() => {
    return () => {
      // Aborting here cancels nothing server-side — it only stops us touching
      // state after unmount. Never read it as "the bet did not happen".
      submitController.current?.abort();
    };
  }, []);

  /**
   * Leave the create-bet flow for good. `dismissAll` rather than a bare
   * `replace`: replacing only the top of the stack would leave `create-bet`
   * sitting under home, so Back would re-enter the flow with params that have
   * already been spent on a bet.
   */
  const goHome = useCallback(() => {
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace('/(app)/home');
  }, []);

  /**
   * A bet exists. `isSubmittingRef` is deliberately left `true` — a queued tap
   * must not be able to open a second bet while the alert is up.
   *
   * `Alert` is React Native's own: there is no toast library in this project
   * and adding a dependency for one confirmation is out of scope.
   */
  const handleSuccess = useCallback(() => {
    setIsSubmitting(false);
    setFailure(null);
    Alert.alert(SUCCESS_TITLE, SUCCESS_BODY, [{ text: 'OK', onPress: goHome }], {
      cancelable: false,
    });
  }, [goHome]);

  /**
   * We could not tell whether the bet was created. `getActiveBet` is the only
   * safe question to ask — `createBet` must not be called again until it says
   * there is nothing there.
   */
  const reconcile = useCallback(
    async (controller: AbortController) => {
      const originalError = submitErrorRef.current;

      try {
        const bet = await getActiveBet(controller.signal);
        if (controller.signal.aborted) return;

        if (bet !== null) {
          // The bet landed despite the failure. Treat it as the success it is.
          handleSuccess();
          return;
        }

        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setFailure({ message: describeBetError(originalError), recovery: 'retry' });
      } catch {
        if (controller.signal.aborted) return;

        // The reconciliation failed too, so we still do not know. Offer to ask
        // again — never to submit again.
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setFailure({ message: describeBetError(originalError), recovery: 'reconcile' });
      }
    },
    [handleSuccess],
  );

  const submit = useCallback(async () => {
    if (isSubmittingRef.current) return;
    // Re-checked here (not just via `disabled`) so TypeScript narrows the four
    // nullable values before they reach the request — an unguarded call is then
    // a compile error rather than a runtime one.
    if (goalType === null || targetDays === null || stakeCents === null || selectedId === null) {
      return;
    }

    isSubmittingRef.current = true;

    submitController.current?.abort();
    const controller = new AbortController();
    submitController.current = controller;

    submitErrorRef.current = null;
    setFailure(null);
    setIsSubmitting(true);

    try {
      await createBet(
        {
          goalType,
          targetDays,
          // Integer centavos → the exact `"50.00"` string the API wants. Money
          // never crosses the wire as a `number`.
          stakeAmountBrl: centsToApiAmount(stakeCents),
          paymentMethodId: selectedId,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      handleSuccess();
    } catch (error) {
      if (controller.signal.aborted) return;

      if (isUnresolved(error)) {
        submitErrorRef.current = error;
        await reconcile(controller);
        return;
      }

      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setFailure({ message: describeBetError(error), recovery: recoveryForError(error) });
    }
  }, [goalType, handleSuccess, reconcile, selectedId, stakeCents, targetDays]);

  /** Re-runs the reconciliation only, for the `reconcile` recovery. */
  const handleCheckStatus = useCallback(() => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    submitController.current?.abort();
    const controller = new AbortController();
    submitController.current = controller;

    setFailure(null);
    setIsSubmitting(true);
    void reconcile(controller);
  }, [reconcile]);

  const handleAddCard = useCallback(() => {
    router.push('/(app)/wallet');
  }, []);

  if (!paramsValid) {
    // A bad deep link. Nothing here could be submitted, so the card list is
    // never fetched; `replace` (not `push`) keeps the broken screen out of the
    // back stack.
    return (
      <ScreenContainer testID="create-bet-payment-screen">
        <View style={styles.centered}>
          <Text style={styles.title} accessibilityRole="header">
            Bet details missing
          </Text>
          <Text
            style={styles.emptyBody}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="invalid-params-message"
          >
            {INVALID_PARAMS_MESSAGE}
          </Text>
          <View style={styles.stretch}>
            <PrimaryButton
              label="Back to bet details"
              onPress={() => router.replace('/(app)/create-bet')}
              testID="back-to-details-button"
            />
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const goalLabel = goalTypeLabel(goalTypeParam) ?? goalTypeParam;
  const hasCards = methods.length > 0;
  // `retry`, `reconcile` and `go-home` each render their own, more specific
  // action; leaving Confirm live alongside them would invite exactly the
  // blind retry the recovery model exists to prevent.
  const blockedByFailure =
    failure !== null && failure.recovery !== 'choose-card' && failure.recovery !== 'none';
  const canSubmit = status === 'ready' && hasCards && selectedId !== null && !isSubmitting && !blockedByFailure;

  const renderCards = () => {
    if (status === 'loading') {
      return (
        <View
          style={styles.centeredBlock}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your cards"
          testID="payment-methods-loading"
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={styles.section}>
          <Text
            style={styles.error}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="payment-methods-error"
          >
            {listError}
          </Text>
          <PrimaryButton
            label="Try again"
            onPress={() => void reload()}
            testID="payment-methods-retry-button"
          />
        </View>
      );
    }

    if (!hasCards) {
      // `[]` is a state, not an error: the user simply has no cards yet.
      return (
        <View style={styles.section} testID="payment-methods-empty">
          <Text style={styles.emptyTitle} accessibilityRole="header">
            No cards yet
          </Text>
          <Text style={styles.emptyBody}>
            Add a card to hold your stake. We only ever store its brand and last four digits.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.cardList} accessibilityRole="radiogroup">
        {methods.map((item) => {
          const selected = selectedId === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setSelectedId(item.id)}
              disabled={isSubmitting}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: isSubmitting }}
              accessibilityLabel={cardAccessibilityLabel(item)}
              testID={`payment-method-${item.id}`}
              style={[styles.card, selected && styles.cardSelected]}
            >
              {/* No `numberOfLines`: long brand names wrap and grow the row. */}
              <View style={styles.cardText}>
                <Text style={[styles.cardBrand, selected && styles.cardBrandSelected]}>
                  {formatCardBrand(item.cardBrand)}
                </Text>
                <Text style={styles.cardNumber}>{maskedCardLabel(item.lastFour)}</Text>
              </View>
              {item.isDefault && (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>Default</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <ScreenContainer testID="create-bet-payment-screen">
      {/*
        `ScreenContainer` is a fixed, non-scrolling View by design, and a long
        card list plus the summary overflows a small screen at large system
        type sizes — so this screen brings its own `ScrollView`.

        The list is a `.map()` rather than a `FlatList` (the one deliberate
        divergence from `wallet.tsx`): a `FlatList` nested in a `ScrollView`
        warns about nested virtualisation, and a user's saved-card count is
        inherently small.
      */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title} accessibilityRole="header">
          Payment method
        </Text>
        <Text style={styles.subtitle}>
          Choose the card your stake is held on. Nothing is charged unless you miss your goal.
        </Text>

        <View style={styles.summary}>
          <SummaryRow label="Goal" value={goalLabel} testID="summary-goal" />
          <SummaryRow
            label="Target days"
            value={String(targetDays)}
            testID="summary-target-days"
          />
          <SummaryRow label="Stake" value={formatCentsAsBrl(stakeCents)} testID="summary-stake" />
        </View>

        {renderCards()}

        {status !== 'loading' && (
          <Pressable
            onPress={handleAddCard}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Add card"
            accessibilityState={{ disabled: isSubmitting }}
            testID="add-card-button"
            style={styles.addCard}
          >
            <Text style={styles.addCardLabel}>+ Add card</Text>
          </Pressable>
        )}

        {failure !== null && (
          <View style={styles.section} testID="submit-failure">
            <Text
              style={styles.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="submit-error"
            >
              {failure.message}
            </Text>
            {failure.recovery === 'go-home' && (
              <PrimaryButton label="Go to home" onPress={goHome} testID="failure-home-button" />
            )}
            {failure.recovery === 'retry' && (
              <PrimaryButton
                label="Try again"
                onPress={() => void submit()}
                disabled={isSubmitting}
                testID="failure-retry-button"
              />
            )}
            {failure.recovery === 'reconcile' && (
              <PrimaryButton
                label="Check bet status"
                onPress={handleCheckStatus}
                disabled={isSubmitting}
                testID="failure-check-status-button"
              />
            )}
          </View>
        )}

        <View style={styles.actions}>
          <PrimaryButton
            label="Confirm Bet"
            onPress={() => void submit()}
            disabled={!canSubmit}
            testID="confirm-bet-button"
          />
          {isSubmitting && (
            // An adjacent indicator rather than a busy state on the shared
            // `PrimaryButton`: the button is used by three other screens that
            // do not need one.
            <View
              style={styles.progress}
              accessibilityRole="progressbar"
              accessibilityLabel="Creating your bet"
              testID="submit-progress"
            >
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function SummaryRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  stretch: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.xl,
    lineHeight: lineHeights.xl,
    fontWeight: fontWeights.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
  },
  summary: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.backgroundAlt,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowLabel: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
  },
  rowValue: {
    flexShrink: 1,
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.semibold,
    textAlign: 'right',
  },
  section: {
    gap: spacing.sm,
  },
  cardList: {
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  cardText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardBrand: {
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.medium,
  },
  cardBrandSelected: {
    color: colors.primaryDark,
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
  addCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  addCardLabel: {
    color: colors.primaryDark,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
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
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  actions: {
    gap: spacing.sm,
    marginTop: 'auto',
    paddingTop: spacing.sm,
  },
  progress: {
    alignItems: 'center',
  },
});
