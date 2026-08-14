import React from 'react';
import { Redirect, Stack } from 'expo-router';

import { SplashScreenFallback } from '../../src/components/SplashScreenFallback';
import { useAuth } from '../../src/hooks/useAuth';
import { colors, fontSizes, fontWeights } from '../../src/theme';

/**
 * Layout for authenticated screens, and the app's auth guard.
 *
 * Every route under `(app)/` is gated here rather than per-screen, so a new
 * screen is protected by virtue of where the file lives. The `isRestoring`
 * check must come first: redirecting while the session is still loading would
 * eject signed-in users on every cold start.
 */
export default function AppLayout() {
  const { isAuthenticated, isRestoring } = useAuth();

  if (isRestoring) {
    return <SplashScreenFallback />;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontSize: fontSizes.lg,
          fontWeight: fontWeights.semibold,
        },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="home" options={{ title: 'TaPago' }} />
      <Stack.Screen name="create-bet" options={{ title: 'New Bet' }} />
      <Stack.Screen name="create-bet-payment" options={{ title: 'Payment Method' }} />
    </Stack>
  );
}
