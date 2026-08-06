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
 * module, so `process.env.EXPO_PUBLIC_API_BASE_URL` is populated here.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'TaPago',
  slug: config.slug ?? 'tapago-mobile',
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  },
});
