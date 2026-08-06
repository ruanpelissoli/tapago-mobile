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

/** Minimal shape of the signed-in user. Widened when the real API lands. */
export type AuthUser = {
  id: string;
  name: string;
};

export type AuthState = {
  user: AuthUser | null;
  /** True once a session has been restored or created. */
  isAuthenticated: boolean;
  /**
   * True while the persisted session is being restored on cold start.
   * Route guards must wait for this to settle before redirecting, otherwise a
   * signed-in user briefly bounces to the sign-in screen on every launch.
   */
  isRestoring: boolean;
  signIn: (user: AuthUser) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Auth state for the app.
 *
 * This milestone ships an in-memory implementation only — there is no token
 * storage or network call yet. `restoreSession` is the single seam a later task
 * swaps for a real `expo-secure-store` read, so nothing else has to change.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    async function restoreSession() {
      // Placeholder: no persisted session exists yet.
      const restored: AuthUser | null = null;
      // Guard against setting state after unmount (fast reload / process death).
      if (!isMounted.current) return;
      setUser(restored);
      setIsRestoring(false);
    }

    void restoreSession();

    return () => {
      isMounted.current = false;
    };
  }, []);

  const signIn = useCallback((nextUser: AuthUser) => setUser(nextUser), []);
  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isRestoring,
      signIn,
      signOut,
    }),
    [user, isRestoring, signIn, signOut],
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
