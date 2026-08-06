import React from 'react';
import { Redirect, Stack } from 'expo-router';

import { SplashScreenFallback } from '../../src/components/SplashScreenFallback';
import { useAuth } from '../../src/hooks/useAuth';
import { colors } from '../../src/theme';

/**
 * Layout for unauthenticated screens.
 *
 * Mirror image of the `(app)` guard: an already-signed-in user has no business
 * on sign-in, so they are bounced into the app. This also handles the sign-in
 * transition itself — the moment auth state flips, this redirect fires.
 */
export default function AuthLayout() {
  const { isAuthenticated, isRestoring } = useAuth();

  if (isRestoring) {
    return <SplashScreenFallback />;
  }

  if (isAuthenticated) {
    return <Redirect href="/(app)/home" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
