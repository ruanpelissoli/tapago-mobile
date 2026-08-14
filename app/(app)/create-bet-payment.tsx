import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../src/components/ScreenContainer';
import { goalTypeLabel } from '../../src/domain/bet';
import { formatCentsAsBrl, parseStakeCentsParam, parseTargetDays } from '../../src/domain/betForm';
import { colors, fontSizes, fontWeights, lineHeights, spacing } from '../../src/theme';

const MISSING = 'Not provided';

/** Router params arrive as `string | string[]`; take the first value if repeated. */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Step 2 of the create-bet flow — a deliberate stub.
 *
 * It exists so `Continue` on `create-bet` resolves to a real route instead of
 * `+not-found`, and so the params contract between the two steps is visible.
 * The real payment-method UI (saved cards from `GET /v1/payment-methods`, plus
 * the `POST /v1/bets` call) lands in a follow-up task.
 *
 * Every param is re-parsed rather than trusted: a hand-typed deep link can put
 * anything in the URL, and rendering `NaN` is worse than saying "not provided".
 */
export default function CreateBetPaymentScreen() {
  const params = useLocalSearchParams<{
    goalType?: string;
    targetDays?: string;
    stakeCents?: string;
  }>();

  const goal = goalTypeLabel(firstParam(params.goalType));
  const targetDays = parseTargetDays(firstParam(params.targetDays));
  const stakeCents = parseStakeCentsParam(firstParam(params.stakeCents));

  return (
    <ScreenContainer testID="create-bet-payment-screen">
      <Text style={styles.title} accessibilityRole="header">
        Payment method
      </Text>
      <Text style={styles.subtitle}>
        Choosing a card comes next. Here is the bet you just configured.
      </Text>

      <View style={styles.summary}>
        <SummaryRow label="Goal" value={goal ?? MISSING} testID="summary-goal" />
        <SummaryRow
          label="Target days"
          value={targetDays === null ? MISSING : String(targetDays)}
          testID="summary-target-days"
        />
        <SummaryRow
          label="Stake"
          value={stakeCents === null ? MISSING : formatCentsAsBrl(stakeCents)}
          testID="summary-stake"
        />
      </View>
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
  title: {
    color: colors.text,
    fontSize: fontSizes.xl,
    lineHeight: lineHeights.xl,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    marginBottom: spacing.lg,
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
});
