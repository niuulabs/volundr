import { useEffect, useLayoutEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import type { User } from 'oidc-client-ts';
import { setTokenProvider } from '@/modules/volundr/adapters/api/client';
import { loadRuntimeConfig } from '@/config';
import { getOidcConfig, getUserManager, type OidcConfig } from './oidc';
import { AuthContext, type AuthContextValue } from './AuthContext';
import styles from './AuthProvider.module.css';

function LoginPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        <div className={styles.loginLogo}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.loginIcon}
          >
            <path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" />
            <path d="m18 15 4-4" />
            <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
          </svg>
          <h1 className={styles.loginTitle}>Völundr</h1>
        </div>
        <p className={styles.loginSubtitle}>Sign in to manage your coding sessions</p>
        <button className={styles.loginButton} onClick={onLogin}>
          Sign in
        </button>
      </div>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [oidcConfig, setOidcConfig] = useState<OidcConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<User | null>(null);

  // Load runtime config on mount
  useEffect(() => {
    loadRuntimeConfig().then(rc => {
      const oidc = getOidcConfig(rc);
      setOidcConfig(oidc);
      if (!oidc) {
        setLoading(false);
      }
    });
  }, []);

  const enabled = oidcConfig !== null;

  // Register the token provider synchronously after commit but before
  // children's useEffect calls via useLayoutEffect.  This ensures the
  // Bearer token is available when child components fire API requests.
  useLayoutEffect(() => {
    userRef.current = user;
  }, [user]);

  useLayoutEffect(() => {
    if (!enabled) return;
    setTokenProvider(() => userRef.current?.access_token ?? null);
    return () => setTokenProvider(null);
  }, [enabled]);

  const login = useCallback(() => {
    if (!oidcConfig) return;
    const mgr = getUserManager(oidcConfig);
    mgr.signinRedirect();
  }, [oidcConfig]);

  const logout = useCallback(() => {
    if (!oidcConfig) return;
    const mgr = getUserManager(oidcConfig);
    mgr.signoutRedirect();
  }, [oidcConfig]);

  useEffect(() => {
    if (!oidcConfig) {
      return;
    }

    const mgr = getUserManager(oidcConfig);
    let cancelled = false;

    async function init() {
      try {
        // Handle callback from OIDC provider
        if (window.location.search.includes('code=') || window.location.search.includes('error=')) {
          const callbackUser = await mgr.signinRedirectCallback();
          if (!cancelled) setUser(callbackUser);
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
          if (!cancelled) setLoading(false);
          return;
        }

        // Check for existing session
        const existingUser = await mgr.getUser();
        if (!cancelled && existingUser && !existingUser.expired) {
          setUser(existingUser);
        }
      } catch (err) {
        console.error('OIDC init error:', err);
      }
      if (!cancelled) setLoading(false);
    }

    // Listen for token events
    mgr.events.addUserLoaded(loadedUser => setUser(loadedUser));
    mgr.events.addUserUnloaded(() => setUser(null));
    mgr.events.addAccessTokenExpired(() => {
      mgr.signinSilent().catch(() => setUser(null));
    });

    init();

    return () => {
      cancelled = true;
      mgr.events.removeUserLoaded(loadedUser => setUser(loadedUser));
      mgr.events.removeUserUnloaded(() => setUser(null));
    };
  }, [oidcConfig]);

  const value: AuthContextValue = {
    enabled,
    authenticated: enabled ? user !== null && !user.expired : true,
    loading,
    user,
    accessToken: user?.access_token ?? null,
    login,
    logout,
  };

  if (loading) {
    return (
      <div className={styles.loadingPage}>
        <div className={styles.loadingSpinner} />
      </div>
    );
  }

  if (enabled && !value.authenticated) {
    return <LoginPage onLogin={login} />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
