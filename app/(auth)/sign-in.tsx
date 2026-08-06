import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { ScreenContainer } from '../../src/components/ScreenContainer';
import { colors, fontSizes, fontWeights, lineHeights, spacing } from '../../src/theme';

/**
 * Sign-in stub. Replaced by the real credential form in the auth-flow task;
 * it exists now so the `(auth)` group has a resolvable initial route.
 */
export default function SignInScreen() {
  return (
    <ScreenContainer edges={['top', 'bottom', 'left', 'right']} centered testID="sign-in-screen">
      <Text style={styles.title} accessibilityRole="header">
        TaPago
      </Text>
      <Text style={styles.subtitle}>Sign in to continue</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.primary,
    fontSize: fontSizes.xxxl,
    lineHeight: lineHeights.xxxl,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    textAlign: 'center',
  },
});
