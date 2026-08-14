import * as AppleAuthentication from 'expo-apple-authentication';

import { ApiError, NetworkError, postJson } from './apiClient';

/**
 * Authentication against the TaPago API.
 *
 * Social sign-in is a token *exchange*, not an OAuth implementation: the
 * provider SDK owns the whole consent dance and hands back an ID token, and
 * this module's only job is to trade that token for a TaPago JWT. Verification
 * happens server-side against the provider's JWKS, so the app never validates a
 * provider token itself and must not treat one as proof of anything.
 *
 * `register`/`login` for email + password land here alongside these.
 */

/** The signed-in user as the API describes them. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
};

/** A completed sign-in: the TaPago JWT plus who it belongs to. */
export type AuthSession = {
  token: string;
  user: AuthenticatedUser;
};

/** Social identity providers the API can verify. */
export type SocialProvider = 'google' | 'apple';

/**
 * Outcome of a social sign-in attempt.
 *
 * Cancellation is a distinct result rather than an error because it is not a
 * failure — the user closed the sheet on purpose and must not be shown an error
 * message for it.
 */
export type SocialSignInResult =
  | { status: 'success'; session: AuthSession }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

const SOCIAL_ENDPOINTS: Record<SocialProvider, string> = {
  google: '/auth/google',
  apple: '/auth/apple',
};

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: 'Google',
  apple: 'Apple',
};

/** Narrow an unknown API payload to `AuthSession`, or reject it. */
function parseAuthSession(payload: unknown): AuthSession {
  if (typeof payload !== 'object' || payload === null) {
    throw new NetworkError('Received a malformed response from the server');
  }

  const { token, user } = payload as { token?: unknown; user?: unknown };

  if (typeof token !== 'string' || token.length === 0) {
    throw new NetworkError('Received a malformed response from the server');
  }
  if (typeof user !== 'object' || user === null) {
    throw new NetworkError('Received a malformed response from the server');
  }

  const { id, email, name } = user as { id?: unknown; email?: unknown; name?: unknown };
  if (typeof id !== 'string' || typeof email !== 'string' || typeof name !== 'string') {
    throw new NetworkError('Received a malformed response from the server');
  }

  return { token, user: { id, email, name } };
}

/**
 * Trade a provider ID token for a TaPago session.
 *
 * @throws {ApiError} when the API rejects the token.
 * @throws {NetworkError} when the request could not complete.
 */
export async function exchangeSocialIdToken(
  provider: SocialProvider,
  idToken: string,
  signal?: AbortSignal,
): Promise<AuthSession> {
  const payload = await postJson<unknown>(
    SOCIAL_ENDPOINTS[provider],
    { id_token: idToken },
    signal,
  );
  return parseAuthSession(payload);
}

/**
 * Turn a thrown error into copy we are willing to show a user.
 *
 * Every branch returns something actionable and non-technical. Raw error
 * messages are never surfaced — they leak implementation detail and read as a
 * crash to the user.
 */
export function describeSocialAuthError(error: unknown, provider: SocialProvider): string {
  const label = PROVIDER_LABELS[provider];

  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return `${label} did not return a usable sign-in token. Please try again.`;
      case 401:
        return `We couldn't verify your ${label} account. Please try again.`;
      case 409:
        return 'That email is already registered with a different sign-in method. Sign in the way you did originally.';
      case 503:
        return `${label} sign-in is unavailable right now. Please try again later.`;
      default:
        return error.status >= 500
          ? 'Something went wrong on our end. Please try again in a moment.'
          : `We couldn't finish signing you in with ${label}. Please try again.`;
    }
  }

  if (error instanceof NetworkError) {
    return "We couldn't reach TaPago. Check your connection and try again.";
  }

  return `We couldn't finish signing you in with ${label}. Please try again.`;
}

/**
 * Did this Apple error come from the user dismissing the sheet?
 *
 * `expo-apple-authentication` rejects with `ERR_REQUEST_CANCELED` on cancel.
 * The code lives on a `code` property that is not in the public type, hence the
 * structural check.
 */
function isAppleCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ERR_REQUEST_CANCELED'
  );
}

/**
 * Run the native Apple sign-in sheet and exchange the resulting ID token.
 *
 * Only ever call this on iOS — `AppleAuthentication.isAvailableAsync()` gates
 * whether the button is rendered at all.
 *
 * Note on the name: Apple returns the user's real name *only on the very first
 * authorisation* for an app, and never again. We forward just the ID token and
 * let the API decide what to store, so re-installing does not overwrite a
 * previously captured name with a blank one.
 */
export async function signInWithApple(signal?: AbortSignal): Promise<SocialSignInResult> {
  let identityToken: string | null;

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    identityToken = credential.identityToken;
  } catch (error) {
    if (isAppleCancellation(error)) {
      return { status: 'cancelled' };
    }
    return { status: 'error', message: describeSocialAuthError(error, 'apple') };
  }

  if (!identityToken) {
    // Documented as nullable; in practice only on a misconfigured entitlement.
    return {
      status: 'error',
      message: 'Apple did not return a sign-in token. Please try again.',
    };
  }

  return exchangeIdTokenAsResult('apple', identityToken, signal);
}

/**
 * Shared tail of both provider flows: exchange the token, convert throws into a
 * `SocialSignInResult` so screens never have to try/catch.
 */
export async function exchangeIdTokenAsResult(
  provider: SocialProvider,
  idToken: string,
  signal?: AbortSignal,
): Promise<SocialSignInResult> {
  try {
    const session = await exchangeSocialIdToken(provider, idToken, signal);
    return { status: 'success', session };
  } catch (error) {
    return { status: 'error', message: describeSocialAuthError(error, provider) };
  }
}

/** Is Apple sign-in usable on this device? False on Android and older iOS. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}
