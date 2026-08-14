import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from './authService';

/**
 * Device persistence for the auth session.
 *
 * The **whole** `AuthSession` (JWT + user) is stored as one JSON value under one
 * key. `AuthState.user` has to survive a restart and there is no way to re-fetch
 * it — `apiClient` exposes only `postJson` and the API has no `/auth/me` — so
 * storing the bare token would force either a new endpoint or client-side JWT
 * decoding. One key and one write also means the token and the user it belongs
 * to can never disagree, which is the invariant `useAuth` exists to protect.
 *
 * `expo-secure-store` (keychain / Android keystore), never `AsyncStorage`: a JWT
 * must not sit in plaintext on the device.
 *
 * Nothing here rejects. Storage being unavailable is not a reason to fail a
 * sign-in or strand the app on a splash screen — every path degrades to
 * in-memory-only behaviour.
 */

/**
 * Storage key for the serialised session.
 *
 * Named for what it holds (the session), not `auth_token`, because the value is
 * the whole session.
 */
export const AUTH_SESSION_KEY = 'auth_session';

/**
 * Logged instead of the caught error on every failure path.
 *
 * The error object is deliberately never interpolated: SecureStore errors on
 * some platforms echo back the value they failed to handle, which would put the
 * JWT in the log.
 */
const STORAGE_WARNING = 'Auth session storage unavailable; continuing in memory only';

/**
 * Narrow a stored string to an `AuthSession`, or reject it.
 *
 * Mirrors `parseAuthSession` in `authService.ts`: nothing is cast, and the
 * returned object is freshly constructed from validated fields so no extra
 * properties from a stale schema ride along. Unlike its API-response sibling
 * this returns `null` rather than throwing — a corrupt local value means
 * "signed out", not "the network misbehaved".
 *
 * Pure and exported so it is unit-testable the day a test runner lands.
 */
export function parseStoredSession(raw: string | null): AuthSession | null {
  if (raw === null || raw.length === 0) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;

  const { token, user } = payload as { token?: unknown; user?: unknown };

  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof user !== 'object' || user === null) return null;

  const { id, email, name } = user as { id?: unknown; email?: unknown; name?: unknown };
  if (typeof id !== 'string' || typeof email !== 'string' || typeof name !== 'string') {
    return null;
  }

  return { token, user: { id, email, name } };
}

/**
 * Read the persisted session, or `null` if there isn't a usable one.
 *
 * A stored value that fails validation is deleted, so a corrupt key cannot fail
 * again on every subsequent launch.
 *
 * The restore is deliberately optimistic: the token's expiry is not checked and
 * the JWT is not decoded. Nothing sends an `Authorization` header yet, so a
 * restored-but-expired token costs nothing; clearing on a `401` is a later task.
 */
export async function loadStoredSession(): Promise<AuthSession | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(AUTH_SESSION_KEY);
  } catch {
    console.warn(STORAGE_WARNING);
    return null;
  }

  if (raw === null) return null;

  const session = parseStoredSession(raw);
  if (session === null) {
    await clearStoredSession();
    return null;
  }

  return session;
}

/** Persist the session. Resolves even when the write fails. */
export async function saveStoredSession(session: AuthSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    console.warn(STORAGE_WARNING);
  }
}

/** Delete the persisted session. Resolves even when the delete fails. */
export async function clearStoredSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
  } catch {
    console.warn(STORAGE_WARNING);
  }
}
