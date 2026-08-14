import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Default API base URL used when no `.env` value is provided.
 * Points at the local backend so a fresh clone boots without extra setup.
 */
const DEFAULT_API_BASE_URL = 'http://localhost:5000';

/**
 * Dynamic Expo config.
 *
 * Static app metadata lives in `app.json`; this file layers environment-derived
 * values on top of it. Expo automatically loads `.env` before evaluating this
 * module, so `process.env.EXPO_PUBLIC_*` is populated here.
 *
 * Google client IDs default to `''` rather than being omitted, so
 * `src/services/env.ts` always sees a string and can treat "empty" as
 * "not configured" without null-checking the manifest.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'TaPago',
  slug: config.slug ?? 'tapago-mobile',
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
    googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '',
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  },
});
