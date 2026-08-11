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

/** The signed-in user, as returned by the API. */
export type AuthUser = AuthenticatedUser;

export type AuthState = {
  user: AuthUser | null;
  /**
   * The TaPago JWT for the current session, or `null` when signed out.
   *
   * Held in memory only — see the note on `restoreSession` below. Anything that
   * needs to authenticate a request should read it from here rather than
   * threading it through props.
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
 * The session (user + JWT) is held **in memory only**. `restoreSession` is the
 * single seam a later task swaps for a real `expo-secure-store` read, so
 * nothing else has to change when persistence lands; until then every cold
 * start begins signed out.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    async function restoreSession() {
      // Placeholder: no persisted session exists yet.
      const restored: AuthSession | null = null;
      // Guard against setting state after unmount (fast reload / process death).
      if (!isMounted.current) return;
      setSession(restored);
      setIsRestoring(false);
    }

    void restoreSession();

    return () => {
      isMounted.current = false;
    };
  }, []);

  const signIn = useCallback((nextSession: AuthSession) => setSession(nextSession), []);
  const signOut = useCallback(() => setSession(null), []);

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
