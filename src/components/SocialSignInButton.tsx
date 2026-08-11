import React from 'react';
import { AntDesign } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSizes, fontWeights, lineHeights, MIN_TOUCH_TARGET, radii, spacing } from '../theme';

type SocialSignInButtonProps = {
  label: string;
  /** Icon glyph from `AntDesign`, e.g. `google`. */
  icon: React.ComponentProps<typeof AntDesign>['name'];
  onPress: () => void;
  /** Shows a spinner in place of the icon and blocks presses. */
  isLoading?: boolean;
  /** Blocks presses without implying work is happening. */
  disabled?: boolean;
  testID?: string;
};

/**
 * Neutral, Apple-adjacent button used for non-Apple providers.
 *
 * Apple's sign-in button must be the system-rendered
 * `AppleAuthentication.AppleAuthenticationButton`, so this component is
 * deliberately *not* used for Apple — it exists so Google (and any future
 * provider) matches that button's height and weight visually.
 */
export function SocialSignInButton({
  label,
  icon,
  onPress,
  isLoading = false,
  disabled = false,
  testID,
}: SocialSignInButtonProps) {
  const isInteractive = !isLoading && !disabled;

  return (
    <Pressable
      onPress={onPress}
      disabled={!isInteractive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !isInteractive, busy: isLoading }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        !isInteractive && styles.buttonDisabled,
      ]}
    >
      <View style={styles.iconSlot}>
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <AntDesign name={icon} size={20} color={colors.text} />
        )}
      </View>
      {/* `allowFontScaling` stays on: the label must grow with system type size. */}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {/* Balances the icon slot so the label stays optically centred. */}
      <View style={styles.iconSlot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  buttonPressed: {
    backgroundColor: colors.backgroundAlt,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  iconSlot: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flexShrink: 1,
    marginHorizontal: spacing.sm,
    color: colors.text,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.medium,
  },
});

export default SocialSignInButton;
