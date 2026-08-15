import React, { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { daysRemaining, formatDayCount, formatDaysRemaining, goalTypeLabel } from '../../src/domain/bet';
import { formatApiAmountAsBrl } from '../../src/domain/betForm';
import { describeBetError, getActiveBet, type Bet } from '../../src/services/bets';
import {
  colors,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  spacing,
} from '../../src/theme';

type LoadStatus = 'loading' | 'ready' | 'error';

const EMPTY_TITLE = 'No bet running';
const EMPTY_BODY =
  'Put money behind a habit. Pick a goal and how long you want to keep it up — your stake is only held, never charged, while you stay on track.';

const PENDING_NOTE =
  "We're still confirming the hold on your card. Your bet is saved and already counting — nothing else is needed from you.";

/**
 * Home dashboard: the user's one in-flight bet, or an invitation to open one.
 *
 * Four states, and they are deliberately four rather than three: a failed fetch
 * must never degrade into "you have no bet", because the recovery from those two
 * is opposite (retry vs. start a bet).
 *
 * Two rules drive the data layer, both inherited from `wallet.tsx`:
 *
 * 1. **`loadBet` is a promise chain that never sets `loading` itself.**
 *    `react-hooks/set-state-in-effect` is an *error* in this repo's lint config
 *    and rejects a `setState` reachable synchronously from an effect body. The
 *    initial state is already `loading`; `reload` is the wrapper that brings the
 *    spinner back for the retry path. That is also what makes the focus refresh
 *    *silent* — returning from the create-bet flow swaps the content in place
 *    instead of blinking through a full-screen spinner. Do not "simplify" this
 *    to `async`/`await`; lint will fail.
 * 2. **Abort *before* `setState`, always.** `apiClient` merges the caller's
 *    signal with its own 15s timeout, so an abort and a timeout arrive as the
 *    same `NetworkError` and cannot be told apart from the error object.
 *    `controller.signal.aborted` is the only reliable "did we cancel this?".
 *
 * `getActiveBet` maps the API's `404` to `null`, so "no active bet" needs no
 * try/catch. That mapping is slightly lossy: a misconfigured `API_BASE_URL` or a
 * renamed route also 404s and reads here as "no bet" — check the base URL before
 * the data if this screen insists a known bet does not exist.
 */
export default function HomeScreen() {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [bet, setBet] = useState<Bet | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const betController = useRef<AbortController | null>(null);

  const loadBet = useCallback(() => {
    betController.current?.abort();
    const controller = new AbortController();
    betController.current = controller;

    return getActiveBet(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        // `null` is a state to render (the empty CTA), never an error.
        setBet(result);
        setErrorMessage(null);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        setErrorMessage(describeBetError(error));
        setStatus('error');
      });
  }, []);

  const reload = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    await loadBet();
  }, [loadBet]);

  /**
   * Refetch on focus covers the first mount *and* every return from the
   * create-bet flow or the wallet — this screen is where the flow lands on
   * success, so it has to show the bet that was just opened. The cleanup aborts
   * on blur and on unmount.
   *
   * `loadBet` must keep a stable identity (no state deps, controller in a ref)
   * or this effect re-fires on every render.
   */
  useFocusEffect(
    useCallback(() => {
      void loadBet();
      return () => {
        betController.current?.abort();
      };
    }, [loadBet]),
  );

  const handleCreateBet = useCallback(() => {
    router.push('/(app)/create-bet');
  }, []);

  const handleWallet = useCallback(() => {
    router.push('/(app)/wallet');
  }, []);

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <View
          style={styles.centeredBlock}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your bet"
          testID="home-loading"
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={styles.section} testID="home-error">
          <Text
            style={styles.error}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="home-error-message"
          >
            {errorMessage}
          </Text>
          <PrimaryButton label="Try again" onPress={() => void reload()} testID="home-retry-button" />
        </View>
      );
    }

    if (bet === null) {
      return (
        <View style={styles.section} testID="home-empty">
          <Text style={styles.emptyTitle} accessibilityRole="header">
            {EMPTY_TITLE}
          </Text>
          <Text style={styles.emptyBody}>{EMPTY_BODY}</Text>
          <PrimaryButton
            label="Start a bet"
            onPress={handleCreateBet}
            testID="home-create-bet-button"
          />
        </View>
      );
    }

    // `goalTypeLabel` returns `null` for a value we do not know; falling back to
    // the raw value keeps an unfamiliar goal visible rather than blank. The
    // labels are never hardcoded here.
    const goalLabel = goalTypeLabel(bet.goalType) ?? bet.goalType;
    // `null` when `createdAt` cannot be parsed — the row is then omitted
    // entirely rather than rendering "NaN days left".
    const remaining = daysRemaining(bet.createdAt, bet.targetDays);
    const isPending = bet.status === 'pending';

    return (
      <View style={styles.card} testID="home-active-bet">
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} accessibilityRole="header">
            {goalLabel}
          </Text>
          {isPending && (
            <View style={styles.badge} testID="home-bet-pending">
              <Text style={styles.badgeLabel}>Confirming</Text>
            </View>
          )}
        </View>

        {remaining !== null && (
          <Text style={styles.countdown} testID="home-days-remaining">
            {formatDaysRemaining(remaining)}
          </Text>
        )}

        <View style={styles.summary}>
          <SummaryRow label="Stake" value={formatApiAmountAsBrl(bet.stakeAmountBrl)} testID="home-stake" />
          <SummaryRow
            label="Target"
            value={formatDayCount(bet.targetDays)}
            testID="home-target-days"
          />
        </View>

        {/*
          A `pending` bet renders the card, not the empty state: it still
          occupies the user's single in-flight slot, so a "Start a bet" CTA here
          could only ever produce a `409`.
        */}
        {isPending && (
          <Text style={styles.pendingNote} accessibilityLiveRegion="polite">
            {PENDING_NOTE}
          </Text>
        )}
      </View>
    );
  };

  return (
    <ScreenContainer testID="home-screen">
      {/*
        `ScreenContainer` is a fixed, non-scrolling View by design, and the
        summary plus the actions overflow a small screen at large system type
        sizes — so this screen brings its own `ScrollView`, per the
        `create-bet-payment.tsx` precedent.
      */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title} accessibilityRole="header">
          Home
        </Text>

        {renderBody()}

        {/*
          "Payment methods" renders in *every* state, including loading: it is
          the only route into the wallet, so hiding it behind a successful fetch
          would strand that screen whenever the API is down.
        */}
        <View style={styles.actions}>
          <PrimaryButton label="Payment methods" onPress={handleWallet} testID="home-wallet-button" />
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
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.xxl,
    lineHeight: lineHeights.xxl,
    fontWeight: fontWeights.bold,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.backgroundAlt,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    flexShrink: 1,
    color: colors.text,
    fontSize: fontSizes.xl,
    lineHeight: lineHeights.xl,
    fontWeight: fontWeights.bold,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.warning,
  },
  badgeLabel: {
    color: colors.text,
    fontSize: fontSizes.xs,
    lineHeight: lineHeights.xs,
    fontWeight: fontWeights.semibold,
  },
  countdown: {
    color: colors.primaryDark,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    fontWeight: fontWeights.semibold,
  },
  summary: {
    gap: spacing.sm,
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
  pendingNote: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
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
});
