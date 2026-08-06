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

export const env = {
  apiBaseUrl: API_BASE_URL,
} as const;

export default env;
