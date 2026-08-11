import Constants from 'expo-constants';

/**
 * Runtime environment values, resolved once at module load.
 *
 * Values flow: `.env` -> `app.config.ts` (`extra`) -> `expo-constants` -> here.
 * We fall back to `process.env.EXPO_PUBLIC_*` because Expo also inlines those
 * directly into the bundle, which keeps unit tests and web builds working even
 * when the manifest is unavailable.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function readString(key: string, envValue: string | undefined, fallback: string): string {
  const fromExtra = extra[key];
  if (typeof fromExtra === 'string' && fromExtra.length > 0) {
    return fromExtra;
  }
  if (typeof envValue === 'string' && envValue.length > 0) {
    return envValue;
  }
  return fallback;
}

/** Base URL of the TaPago backend API. Never has a trailing slash. */
export const API_BASE_URL = readString(
  'apiBaseUrl',
  process.env.EXPO_PUBLIC_API_BASE_URL,
  'http://localhost:5000',
).replace(/\/+$/, '');

/**
 * Google OAuth client IDs.
 *
 * Public client identifiers, not secrets — Google requires them in the app, and
 * the flow is secured by PKCE and the registered redirect URI. An empty string
 * means "not configured for this platform", which hides the Google button
 * rather than failing at prompt time. See `GOOGLE_SIGN_IN_ENABLED`.
 */
export const GOOGLE_IOS_CLIENT_ID = readString(
  'googleIosClientId',
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  '',
);

export const GOOGLE_ANDROID_CLIENT_ID = readString(
  'googleAndroidClientId',
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  '',
);

export const GOOGLE_WEB_CLIENT_ID = readString(
  'googleWebClientId',
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  '',
);

/**
 * Whether any Google client ID is configured at all.
 *
 * Deliberately *not* per-platform: `expo-auth-session` falls back to the web
 * client ID when a native one is missing (that is the documented Expo Go path),
 * so a single configured ID is enough to attempt the flow.
 */
export const GOOGLE_SIGN_IN_ENABLED =
  GOOGLE_IOS_CLIENT_ID !== '' || GOOGLE_ANDROID_CLIENT_ID !== '' || GOOGLE_WEB_CLIENT_ID !== '';

export const env = {
  apiBaseUrl: API_BASE_URL,
  googleIosClientId: GOOGLE_IOS_CLIENT_ID,
  googleAndroidClientId: GOOGLE_ANDROID_CLIENT_ID,
  googleWebClientId: GOOGLE_WEB_CLIENT_ID,
  googleSignInEnabled: GOOGLE_SIGN_IN_ENABLED,
} as const;

export default env;
