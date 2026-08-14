import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { setAuthTokenProvider } from '../services/apiClient';
import type { AuthenticatedUser, AuthSession } from '../services/authService';
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
} from '../services/sessionStorage';

/** The signed-in user, as returned by the API. */
export type AuthUser = AuthenticatedUser;

export type AuthState = {
  user: AuthUser | null;
  /**
   * The TaPago JWT for the current session, or `null` when signed out.
   *
   * Anything that needs to authenticate a request should read it from here
   * rather than threading it through props.
   */
  token: string | null;
  /** True once a session has been restored or created. */
  isAuthenticated: boolean;
  /**
   * True while the persisted session is being restored on cold start.
   * Route guards must wait for this to settle before redirecting, otherwise a
   * signed-in user briefly bounces to the sign-in screen on every launch.
   */
  isRestoring: boolean;
  /**
   * Complete a sign-in. Takes the whole session so the token and the user can
   * never disagree about who is signed in — every auth path (email/password,
   * Google, Apple) funnels through this one function.
   */
  signIn: (session: AuthSession) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * The current session's JWT, mirrored outside React so `apiClient` can attach
 * an `Authorization` header without being a context consumer.
 *
 * `useAuth` is a hook and `apiClient` is a plain module, so the token cannot be
 * read from context there. This module-scoped mirror is the seam. It is a
 * *module* value rather than a ref for two reasons:
 *
 * 1. The getter is registered at import time, before any component renders, so
 *    there is no window in which a screen's mount effect (React runs child
 *    effects before parent ones) could fire a request with no token registered.
 * 2. Writing a ref during render is forbidden by the `react-hooks/refs` lint
 *    rule, and every write below happens in an event handler or async callback.
 *
 * Safe because exactly one `AuthProvider` is ever mounted (`app/_layout.tsx`).
 * Mounting a second one would have them fight over this value.
 */
let currentToken: string | null = null;

/** Keep the mirror in step with a session change. Never call during render. */
function rememberToken(session: AuthSession | null): void {
  currentToken = session?.token ?? null;
}

// Registered once, at import time. A getter rather than a value: the token
// changes on sign-in, sign-out and cold-start restore, and a captured string
// would go stale on all three.
setAuthTokenProvider(() => currentToken);

/**
 * Auth state for the app.
 *
 * The session (user + JWT) is persisted to `expo-secure-store` by
 * `src/services/sessionStorage.ts` and restored on cold start, so a signed-in
 * user stays signed in across restarts. `restoreSession` is the single seam
 * that reads it; no consumer knows storage exists.
 *
 * React state is always the source of truth and is never gated on the store:
 * a failed read or write degrades to in-memory-only behaviour for the life of
 * the process rather than blocking sign-in or stranding the app on a splash
 * screen.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const isMounted = useRef(true);
  /**
   * Set by `signIn`/`signOut`. A restore that resolves after the user has
   * already acted must not resurrect (or clobber) their session.
   */
  const hasUserActed = useRef(false);
  /**
   * Serialises store writes so they land in call order. Two rapid `signIn`s
   * would otherwise have no ordering guarantee, and the loser could be the last
   * value written.
   */
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  /** Chain a store operation onto the queue; failures never escape. */
  const enqueueWrite = useCallback((operation: () => Promise<void>) => {
    writeQueue.current = writeQueue.current.then(operation, operation);
  }, []);

  useEffect(() => {
    isMounted.current = true;

    async function restoreSession() {
      try {
        const restored = await loadStoredSession();
        // Guard against setting state after unmount (fast reload / process death).
        if (!isMounted.current || hasUserActed.current) return;
        rememberToken(restored);
        setSession(restored);
      } finally {
        // In a `finally` so no failure path can leave the app on the splash
        // screen forever: `isRestoring` settles exactly once, on every path.
        if (isMounted.current) setIsRestoring(false);
      }
    }

    void restoreSession();

    return () => {
      isMounted.current = false;
    };
  }, []);

  // State first, storage second: the redirect in `(auth)/_layout.tsx` fires off
  // the state flip and must not wait on (or fail with) a keychain write.
  const signIn = useCallback(
    (nextSession: AuthSession) => {
      hasUserActed.current = true;
      // Before the state flip: the redirect it triggers can mount a screen that
      // fetches immediately, and that request needs the token already in place.
      rememberToken(nextSession);
      setSession(nextSession);
      enqueueWrite(() => saveStoredSession(nextSession));
    },
    [enqueueWrite],
  );

  const signOut = useCallback(() => {
    hasUserActed.current = true;
    // Cleared first, so an in-flight screen cannot start a request with the
    // token of a user who has just signed out.
    rememberToken(null);
    setSession(null);
    enqueueWrite(clearStoredSession);
  }, [enqueueWrite]);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      isAuthenticated: session !== null,
      isRestoring,
      signIn,
      signOut,
    }),
    [session, isRestoring, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Read auth state. Throws if used outside `AuthProvider` — a wiring bug. */
export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}

export default useAuth;
