import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../src/components/ScreenContainer';
import { SocialSignInButton } from '../../src/components/SocialSignInButton';
import { useAuth } from '../../src/hooks/useAuth';
import { useGoogleSignIn } from '../../src/hooks/useGoogleSignIn';
import {
  isAppleSignInAvailable,
  signInWithApple,
  type SocialProvider,
  type SocialSignInResult,
} from '../../src/services/authService';
import { GOOGLE_SIGN_IN_ENABLED } from '../../src/services/env';
import { colors, fontSizes, fontWeights, lineHeights, MIN_TOUCH_TARGET, radii, spacing } from '../../src/theme';

/**
 * Sign-in screen.
 *
 * Both providers converge on the same two lines — hand the session to
 * `signIn`, let the router react — so there is no provider-specific success
 * path to keep in sync. Navigation is deliberately *not* performed here:
 * flipping auth state makes `(auth)/_layout.tsx` redirect to `/(app)/home`.
 */
export default function SignInScreen() {
  const { signIn } = useAuth();
  const google = useGoogleSignIn();

  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAppleAvailable, setIsAppleAvailable] = useState(false);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Apple sign-in needs iOS 13+, so availability is a runtime question even on
  // iOS. On every other platform we never ask.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    let isCurrent = true;
    void isAppleSignInAvailable().then((available) => {
      if (isCurrent) setIsAppleAvailable(available);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  /**
   * Single funnel for both providers: start, await, then apply the outcome.
   * `signIn` is the only success path, matching email/password.
   */
  const runSocialSignIn = useCallback(
    async (provider: SocialProvider, start: () => Promise<SocialSignInResult>) => {
      // Ignore a tap on the other provider while one flow is already open.
      if (pendingProvider !== null) return;

      setErrorMessage(null);
      setPendingProvider(provider);

      const result = await start();

      // The screen can unmount mid-flow (deep link, process death). Bail rather
      // than setting state on a dead component.
      if (!isMounted.current) return;

      setPendingProvider(null);

      if (result.status === 'success') {
        signIn(result.session);
        return;
      }
      // Cancellation is not an error: the user chose to back out, so the screen
      // simply returns to rest with no message.
      if (result.status === 'error') {
        setErrorMessage(result.message);
      }
    },
    [pendingProvider, signIn],
  );

  const handleGooglePress = useCallback(() => {
    void runSocialSignIn('google', google.signIn);
  }, [google.signIn, runSocialSignIn]);

  const handleApplePress = useCallback(() => {
    void runSocialSignIn('apple', () => signInWithApple());
  }, [runSocialSignIn]);

  const isBusy = pendingProvider !== null;

  return (
    <ScreenContainer edges={['top', 'bottom', 'left', 'right']} testID="sign-in-screen">
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            TaPago
          </Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        <View style={styles.actions}>
          {errorMessage !== null && (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="sign-in-error"
            >
              {errorMessage}
            </Text>
          )}

          {GOOGLE_SIGN_IN_ENABLED && (
            <SocialSignInButton
              label="Continue with Google"
              icon="google"
              onPress={handleGooglePress}
              isLoading={pendingProvider === 'google'}
              disabled={!google.isReady || (isBusy && pendingProvider !== 'google')}
              testID="google-sign-in-button"
            />
          )}

          {/*
            Apple's Human Interface Guidelines require their own button asset and
            wording, so this is the system-rendered component rather than a
            look-alike. It is iOS-only by design — showing it elsewhere would be
            both non-functional and against the guidelines.
          */}
          {isAppleAvailable && (
            <View style={styles.appleButtonWrapper} testID="apple-sign-in-button">
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radii.md}
                style={styles.appleButton}
                onPress={handleApplePress}
              />
              {/*
                The native button cannot render a spinner or be disabled, so a
                scrim covers it while a flow is in progress. It also swallows
                taps, which is what stops a second Apple sheet being requested.
              */}
              {isBusy && (
                <View style={styles.appleButtonScrim}>
                  {pendingProvider === 'apple' && (
                    <ActivityIndicator size="small" color={colors.textInverse} />
                  )}
                </View>
              )}
            </View>
          )}

          {!GOOGLE_SIGN_IN_ENABLED && !isAppleAvailable && (
            <Text style={styles.subtitle} testID="sign-in-unavailable">
              No sign-in methods are configured for this build.
            </Text>
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
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
  actions: {
    gap: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.sm,
    lineHeight: lineHeights.sm,
    textAlign: 'center',
  },
  appleButtonWrapper: {
    position: 'relative',
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  appleButton: {
    width: '100%',
    height: MIN_TOUCH_TARGET,
  },
  appleButtonScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
});
