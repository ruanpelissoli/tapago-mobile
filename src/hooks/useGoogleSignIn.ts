import { useCallback, useEffect, useRef } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

import {
  exchangeIdTokenAsResult,
  type SocialSignInResult,
} from '../services/authService';
import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from '../services/env';

/**
 * Dismisses the auth popup when the browser redirects back. Required on web and
 * harmless on native; must run at module scope, before the component mounts.
 */
WebBrowser.maybeCompleteAuthSession();

/**
 * How long to wait for the authorization code to be exchanged for an ID token
 * after the user finishes at Google's consent screen. This covers one network
 * round trip, so it can be short — the user is already staring at a spinner.
 */
const CODE_EXCHANGE_TIMEOUT_MS = 20_000;

const NOT_READY_MESSAGE = "Google sign-in isn't ready yet. Please try again in a moment.";
const FAILED_MESSAGE = "We couldn't finish signing you in with Google. Please try again.";
const TIMEOUT_MESSAGE = 'Google sign-in took too long to respond. Please try again.';

/**
 * Whichever client ID applies when no platform-specific one is set.
 *
 * `useAuthRequest` throws during render if the resolved client ID is
 * `undefined`, so this is always a string. An empty string is deliberate: the
 * hook then loads a request that would never succeed, but the button is hidden
 * (`GOOGLE_SIGN_IN_ENABLED`) so it is never prompted.
 */
const FALLBACK_CLIENT_ID =
  GOOGLE_WEB_CLIENT_ID || GOOGLE_IOS_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID || '';

type PendingPrompt = {
  resolve: (result: SocialSignInResult) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

/**
 * Google sign-in as a single awaitable call.
 *
 * ## Why this is a hook, and why it is this shape
 *
 * `expo-auth-session` only exposes Google through a hook, and on native it uses
 * the authorization-code flow: `promptAsync()` resolves with a `code`, **not**
 * an ID token. The ID token appears later, on the hook's `response` value, once
 * the library has exchanged that code in a `useEffect`. So the flow genuinely
 * spans two renders and cannot be expressed as one `await`.
 *
 * This hook hides that: `signIn()` returns a promise that stays pending across
 * the exchange and settles once the ID token has been traded for a TaPago
 * session. Callers get the same `SocialSignInResult` contract as
 * `signInWithApple`, so the screen treats both providers identically.
 *
 * A timeout backstops the exchange. The library performs it with a floating
 * promise whose rejection it never surfaces, so without this a failed exchange
 * would leave the caller — and the button's spinner — pending forever.
 */
export function useGoogleSignIn() {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    // `|| undefined` so a blank value falls through to `clientId` rather than
    // being taken as a real (empty) platform ID.
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    clientId: FALLBACK_CLIENT_ID,
  });

  const pendingRef = useRef<PendingPrompt | null>(null);

  /** Resolve the in-flight `signIn()` promise exactly once. */
  const settle = useCallback((result: SocialSignInResult) => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.timeoutId !== null) {
      clearTimeout(pending.timeoutId);
    }
    pendingRef.current = null;
    pending.resolve(result);
  }, []);

  // Clean up a dangling timer if the screen unmounts mid-flow. The promise is
  // intentionally left unresolved — its only caller is gone.
  useEffect(() => {
    return () => {
      const pending = pendingRef.current;
      if (pending?.timeoutId != null) {
        clearTimeout(pending.timeoutId);
      }
      pendingRef.current = null;
    };
  }, []);

  // Second half of the flow: the library has finished the code exchange and an
  // ID token is now available on `response`.
  useEffect(() => {
    if (!response || !pendingRef.current) return;

    if (response.type === 'success') {
      const idToken = response.params?.id_token;
      // Empty until the code exchange resolves; a later render brings the token.
      if (!idToken) return;

      let isCurrent = true;
      void exchangeIdTokenAsResult('google', idToken).then((result) => {
        if (isCurrent) settle(result);
      });
      return () => {
        isCurrent = false;
      };
    }

    if (response.type === 'error') {
      settle({ status: 'error', message: FAILED_MESSAGE });
      return;
    }

    settle({ status: 'cancelled' });
  }, [response, settle]);

  /**
   * Open Google's consent screen and resolve with the resulting session.
   *
   * Never rejects — failures and cancellations come back as a
   * `SocialSignInResult` so the caller does not need a try/catch.
   */
  const signIn = useCallback(async (): Promise<SocialSignInResult> => {
    // `request` is null until the auth URL has been built; prompting before
    // then throws inside the library.
    if (!request) {
      return { status: 'error', message: NOT_READY_MESSAGE };
    }
    // Double-tap while a prompt is open: ignore rather than open a second one.
    if (pendingRef.current) {
      return { status: 'cancelled' };
    }

    // Executors run synchronously, so `resolvePending` is assigned before the
    // constructor returns — hence the definite-assignment annotation.
    let resolvePending!: (result: SocialSignInResult) => void;
    const settled = new Promise<SocialSignInResult>((resolve) => {
      resolvePending = resolve;
    });
    pendingRef.current = { resolve: resolvePending, timeoutId: null };

    let promptResult;
    try {
      promptResult = await promptAsync();
    } catch {
      settle({ status: 'error', message: FAILED_MESSAGE });
      return settled;
    }

    if (promptResult.type === 'success') {
      // Start the exchange clock only now — the user may have spent minutes on
      // the consent screen, and that is not a timeout. The exchange can already
      // have completed while we were awaiting, so re-check before arming it.
      const pending = pendingRef.current;
      if (pending) {
        pending.timeoutId = setTimeout(() => {
          settle({ status: 'error', message: TIMEOUT_MESSAGE });
        }, CODE_EXCHANGE_TIMEOUT_MS);
      }
    } else if (promptResult.type === 'error') {
      settle({ status: 'error', message: FAILED_MESSAGE });
    } else if (
      promptResult.type === 'cancel' ||
      promptResult.type === 'dismiss' ||
      promptResult.type === 'locked'
    ) {
      // The user backed out, or another prompt already held the browser.
      settle({ status: 'cancelled' });
    }
    // The only remaining case is 'opened', which belongs to the web redirect
    // flow. This app ships iOS and Android only, so it is unreachable here; if
    // web is ever added, the response effect is what settles it.

    return settled;
  }, [promptAsync, request, settle]);

  return {
    signIn,
    /** False until the auth request has loaded; disable the button until then. */
    isReady: request !== null,
  };
}

export default useGoogleSignIn;
