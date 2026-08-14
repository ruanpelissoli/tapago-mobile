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
      setSession(nextSession);
      enqueueWrite(() => saveStoredSession(nextSession));
    },
    [enqueueWrite],
  );

  const signOut = useCallback(() => {
    hasUserActed.current = true;
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
