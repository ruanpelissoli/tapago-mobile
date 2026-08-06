import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { ScreenContainer } from '../../src/components/ScreenContainer';
import { colors, fontSizes, fontWeights, lineHeights, spacing } from '../../src/theme';

/**
 * Home stub. Replaced by the real dashboard later; it exists now so the `(app)`
 * group has a resolvable initial route behind the auth guard.
 */
export default function HomeScreen() {
  return (
    <ScreenContainer centered testID="home-screen">
      <Text style={styles.title} accessibilityRole="header">
        Home
      </Text>
      <Text style={styles.subtitle}>You are signed in.</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: fontSizes.xxl,
    lineHeight: lineHeights.xxl,
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
