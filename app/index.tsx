import React from 'react';
import { Redirect } from 'expo-router';

import { SplashScreenFallback } from '../src/components/SplashScreenFallback';
import { useAuth } from '../src/hooks/useAuth';

/**
 * Entry route. Holds the user on a neutral screen until the session has been
 * restored, then hands off to the correct route group. Redirecting before
 * restore finishes would flash the sign-in screen at returning users.
 */
export default function Index() {
  const { isAuthenticated, isRestoring } = useAuth();

  if (isRestoring) {
    return <SplashScreenFallback />;
  }

  return <Redirect href={isAuthenticated ? '/(app)/home' : '/(auth)/sign-in'} />;
}
