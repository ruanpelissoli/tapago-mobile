import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontSizes, fontWeights, lineHeights, MIN_TOUCH_TARGET, radii, spacing } from '../theme';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  /** Blocks presses and switches to the muted, visibly-inactive style. */
  disabled?: boolean;
  testID?: string;
};

/**
 * Filled brand button for a screen's primary action.
 *
 * The filled counterpart to the outlined `SocialSignInButton`: same height and
 * radius, opposite weight. Its disabled state is a *different fill*, not a
 * lowered opacity, so "you can't press this yet" reads at a glance and still
 * meets contrast — an opacity fade on brand green goes ambiguous instead.
 */
export function PrimaryButton({ label, onPress, disabled = false, testID }: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.buttonDisabled : pressed && styles.buttonPressed,
      ]}
    >
      {/*
        No `numberOfLines` and no `allowFontScaling={false}`: at large system
        type sizes the label wraps and the button grows rather than clipping.
      */}
      <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  buttonPressed: {
    backgroundColor: colors.primaryDark,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  label: {
    color: colors.onPrimary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  labelDisabled: {
    color: colors.textSecondary,
  },
});

export default PrimaryButton;
