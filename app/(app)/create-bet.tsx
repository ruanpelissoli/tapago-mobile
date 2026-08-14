import React, { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import {
  GOAL_TYPES,
  STAKE_MAX_CENTS,
  STAKE_MIN_CENTS,
  TARGET_DAYS_DEFAULT,
  TARGET_DAYS_MAX,
  TARGET_DAYS_MIN,
  type GoalType,
} from '../../src/domain/bet';
import {
  formatCentsAsBrl,
  parseStakeCents,
  parseTargetDays,
  sanitizeStakeInput,
  sanitizeTargetDaysInput,
} from '../../src/domain/betForm';
import {
  colors,
  fontSizes,
  fontWeights,
  lineHeights,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
} from '../../src/theme';

const TARGET_DAYS_ERROR = `Enter a whole number of days between ${TARGET_DAYS_MIN} and ${TARGET_DAYS_MAX}.`;
const STAKE_ERROR = `Enter an amount between ${formatCentsAsBrl(STAKE_MIN_CENTS)} and ${formatCentsAsBrl(
  STAKE_MAX_CENTS,
)}.`;

/**
 * Step 1 of the create-bet flow: pick a goal, a duration and a stake.
 *
 * No network call happens here — the screen validates locally and hands the
 * three values to the payment step via router params. Money crosses that
 * boundary as integer centavos (`stakeCents`) so no float ever represents an
 * amount.
 *
 * Validity is *derived* on every render rather than stored in state: clearing a
 * field therefore returns cleanly to the disabled state, with no cached flag to
 * fall out of sync with the text.
 *
 * Every state update below happens inside a synchronous press/change handler
 * and the screen performs no async work, so there is no path that sets state
 * after unmount — no `isMounted` ref is needed here (unlike `sign-in.tsx`,
 * which awaits a provider SDK).
 */
export default function CreateBetScreen() {
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [targetDaysText, setTargetDaysText] = useState(String(TARGET_DAYS_DEFAULT));
  const [stakeText, setStakeText] = useState('');
  const [touched, setTouched] = useState({ targetDays: false, stake: false });

  const targetDays = parseTargetDays(targetDaysText);
  const stakeCents = parseStakeCents(stakeText);
  const isValid = goalType !== null && targetDays !== null && stakeCents !== null;

  // Errors appear only once the user has left the field, so the first keystroke
  // of a still-incomplete value never turns the form red.
  const showTargetDaysError = touched.targetDays && targetDays === null;
  const showStakeError = touched.stake && stakeCents === null;

  /**
   * Guards against a rapid double-tap pushing the payment route twice. It is
   * reset on focus rather than after the push, so coming back from step 2
   * re-arms the button instead of leaving it dead.
   */
  const hasNavigated = useRef(false);
  useFocusEffect(
    useCallback(() => {
      hasNavigated.current = false;
    }, []),
  );

  const handleContinue = useCallback(() => {
    if (hasNavigated.current) return;
    // Re-checked here (not just via `disabled`) so TypeScript can narrow the
    // three nullable values before they reach the params object.
    if (goalType === null || targetDays === null || stakeCents === null) return;

    hasNavigated.current = true;
    router.push({
      pathname: '/(app)/create-bet-payment',
      params: {
        goalType,
        targetDays: String(targetDays),
        stakeCents: String(stakeCents),
      },
    });
  }, [goalType, stakeCents, targetDays]);

  return (
    <ScreenContainer testID="create-bet-screen">
      {/*
        `ScreenContainer` is a fixed, non-scrolling View by design, so a screen
        with text inputs brings its own scroll + keyboard avoidance. Continue
        sits at the end of the scrolled content rather than pinned to the
        bottom, which keeps every control reachable above the keyboard without
        needing a header-height offset.
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.intro}>
            Commit to a goal, choose how long you will keep it up, and put money behind it.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label} accessibilityRole="header">
              Goal
            </Text>
            <View style={styles.goalGroup} accessibilityRole="radiogroup">
              {GOAL_TYPES.map((goal) => {
                const selected = goalType === goal.value;
                return (
                  <Pressable
                    key={goal.value}
                    onPress={() => setGoalType(goal.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={goal.label}
                    testID={`goal-type-${goal.value}`}
                    style={[styles.goalCard, selected && styles.goalCardSelected]}
                  >
                    {/* No `numberOfLines`: long labels wrap and grow the card. */}
                    <Text style={[styles.goalLabel, selected && styles.goalLabelSelected]}>
                      {goal.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {goalType === null && (
              // A hint, not an error: nothing can "touch" a radio group while
              // Continue is disabled, so a red state here could never fire
              // honestly.
              <Text style={styles.hint}>Pick one to get started.</Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Target days</Text>
            <TextInput
              value={targetDaysText}
              onChangeText={(text) => setTargetDaysText(sanitizeTargetDaysInput(text))}
              onBlur={() => setTouched((previous) => ({ ...previous, targetDays: true }))}
              keyboardType="number-pad"
              maxLength={String(TARGET_DAYS_MAX).length}
              placeholder={String(TARGET_DAYS_DEFAULT)}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Target days"
              testID="target-days-input"
              style={[styles.input, showTargetDaysError && styles.inputError]}
            />
            {showTargetDaysError ? (
              <Text
                style={styles.error}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                testID="target-days-error"
              >
                {TARGET_DAYS_ERROR}
              </Text>
            ) : (
              <Text style={styles.hint}>
                How many days in a row you will keep it up ({TARGET_DAYS_MIN}–{TARGET_DAYS_MAX}).
              </Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Stake</Text>
            <View style={[styles.inputRow, showStakeError && styles.inputError]}>
              <Text style={styles.adornment}>R$</Text>
              <TextInput
                value={stakeText}
                onChangeText={(text) => setStakeText(sanitizeStakeInput(text))}
                onBlur={() => setTouched((previous) => ({ ...previous, stake: true }))}
                keyboardType="decimal-pad"
                placeholder="0,00"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Stake amount in reais"
                testID="stake-input"
                style={styles.inputRowField}
              />
            </View>
            {showStakeError ? (
              <Text
                style={styles.error}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                testID="stake-error"
              >
                {STAKE_ERROR}
              </Text>
            ) : (
              <Text style={styles.hint}>
                What you lose if you miss. {formatCentsAsBrl(STAKE_MIN_CENTS)} to{' '}
                {formatCentsAsBrl(STAKE_MAX_CENTS)}.
              </Text>
            )}
          </View>

          <View style={styles.actions}>
            <PrimaryButton
              label="Continue"
              onPress={handleContinue}
              disabled={!isValid}
              testID="continue-button"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  intro: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.semibold,
  },
  goalGroup: {
    gap: spacing.sm,
  },
  goalCard: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  goalCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  goalLabel: {
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.medium,
  },
  goalLabelSelected: {
    color: colors.primaryDark,
    fontWeight: fontWeights.semibold,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputRowField: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
  },
  adornment: {
    marginRight: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.semibold,
  },
  inputError: {
    borderColor: colors.danger,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
  },
  actions: {
    marginTop: spacing.sm,
  },
});
