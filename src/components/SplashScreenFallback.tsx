import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '../theme';

/**
 * Neutral full-screen placeholder shown while auth state is being restored.
 * Deliberately branded-background-only: it should read as a continuation of the
 * native splash screen, not as a distinct loading screen.
 */
export function SplashScreenFallback() {
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});

export default SplashScreenFallback;
