import React from 'react';
import { Link, Stack } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { ScreenContainer } from '../src/components/ScreenContainer';
import {
  colors,
  fontSizes,
  fontWeights,
  lineHeights,
  MIN_TOUCH_TARGET,
  spacing,
} from '../src/theme';

/**
 * Catch-all for unmatched routes, including bad deep links. Sends the user back
 * to `/`, which re-runs the auth redirect rather than guessing a destination.
 */
export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <ScreenContainer
        edges={['top', 'bottom', 'left', 'right']}
        centered
        testID="not-found-screen"
      >
        <Text style={styles.title} accessibilityRole="header">
          This screen doesn&apos;t exist.
        </Text>
        <Link href="/" style={styles.link} accessibilityRole="link">
          Go to the home screen
        </Link>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: fontSizes.lg,
    lineHeight: lineHeights.lg,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  link: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    color: colors.primary,
    fontSize: fontSizes.md,
    lineHeight: lineHeights.md,
    fontWeight: fontWeights.medium,
  },
});
