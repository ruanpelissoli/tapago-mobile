import React, { useCallback } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../src/components/PrimaryButton';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { colors, fontSizes, fontWeights, lineHeights, spacing } from '../../src/theme';

/**
 * Home stub. Replaced by the real dashboard later; it exists now so the `(app)`
 * group has a resolvable initial route behind the auth guard, and so the
 * create-bet flow has an entry point a signed-in user can actually reach.
 */
export default function HomeScreen() {
  const handleCreateBet = useCallback(() => {
    router.push('/(app)/create-bet');
  }, []);

  const handleWallet = useCallback(() => {
    router.push('/(app)/wallet');
  }, []);

  return (
    <ScreenContainer centered testID="home-screen">
      <Text style={styles.title} accessibilityRole="header">
        Home
      </Text>
      <Text style={styles.subtitle}>You are signed in.</Text>

      <View style={styles.actions}>
        <PrimaryButton label="Create bet" onPress={handleCreateBet} testID="home-create-bet-button" />
        <PrimaryButton label="Payment methods" onPress={handleWallet} testID="home-wallet-button" />
      </View>
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
  actions: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});
