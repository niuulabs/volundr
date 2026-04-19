import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'oidc-client-ts';
import { useConfig } from '@niuulabs/plugin-sdk';
import { setTokenProvider } from '@niuulabs/query';
import { buildOidcConfig, createUserManager } from './adapters/oidc';
import { AuthContext, type AuthContextValue } from './AuthContext';
import type { AuthUser } from './ports/auth.port';
import styles from './AuthProvider.module.css';

function toAuthUser(user: User): AuthUser {
  return {
    sub: user.profile.sub,
    email: user.profile.email,
    name: user.profile.name,
    accessToken: user.access_token,
    expired: user.expired ?? false,
  };
}

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
          <h1 className={styles.loginTitle}>Niuu</h1>
        </div>
        <p className={styles.loginSubtitle}>Sign in to continue</p>
        <button className={styles.loginButton} onClick={onLogin}>
          Sign in
        </button>
      </div>
    </div>
  );
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const config = useConfig();
  const oidcConfig = useMemo(
    () => buildOidcConfig(config.auth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.auth?.issuer, config.auth?.clientId],
  );

  const [oidcUser, setOidcUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(oidcConfig !== null);
  const oidcUserRef = useRef<User | null>(null);
  const mgrRef = useRef<ReturnType<typeof createUserManager> | null>(null);

  const enabled = oidcConfig !== null;

  // Keep ref in sync so the token provider callback always reads latest user
  // without triggering re-renders or re-registrations.
  useLayoutEffect(() => {
    oidcUserRef.current = oidcUser;
  }, [oidcUser]);

  // Register the Bearer token provider immediately after commit so children's
  // API requests in their first useEffect already carry the token.
  useLayoutEffect(() => {
    if (!enabled) return;
    setTokenProvider(() => oidcUserRef.current?.access_token ?? null);
    return () => setTokenProvider(null);
  }, [enabled]);

  const login = useCallback(() => {
    mgrRef.current?.signinRedirect();
  }, []);

  const logout = useCallback(() => {
    mgrRef.current?.signoutRedirect();
  }, []);

  useEffect(() => {
    if (!oidcConfig) return;

    const mgr = createUserManager(oidcConfig);
    mgrRef.current = mgr;
    let cancelled = false;

    async function init() {
      try {
        const params = new URLSearchParams(window.location.search);
        const isCallback = params.has('code') || params.has('error');

        if (isCallback) {
          const callbackUser = await mgr.signinRedirectCallback();
          if (!cancelled) setOidcUser(callbackUser);
          window.history.replaceState({}, document.title, window.location.pathname);
          if (!cancelled) setLoading(false);
          return;
        }

        const existingUser = await mgr.getUser();
        if (!cancelled && existingUser && !existingUser.expired) {
          setOidcUser(existingUser);
        }
      } catch (err) {
        console.error('[auth] OIDC init error:', err);
      }
      if (!cancelled) setLoading(false);
    }

    const onUserLoaded = (loaded: User) => setOidcUser(loaded);
    const onUserUnloaded = () => setOidcUser(null);
    const onTokenExpired = () => {
      mgr.signinSilent().catch(() => setOidcUser(null));
    };

    mgr.events.addUserLoaded(onUserLoaded);
    mgr.events.addUserUnloaded(onUserUnloaded);
    mgr.events.addAccessTokenExpired(onTokenExpired);

    init();

    return () => {
      cancelled = true;
      mgrRef.current = null;
      mgr.events.removeUserLoaded(onUserLoaded);
      mgr.events.removeUserUnloaded(onUserUnloaded);
      mgr.events.removeAccessTokenExpired(onTokenExpired);
    };
    // oidcConfig is compared by reference; buildOidcConfig returns a new object
    // only when config.auth values change, so spread-compare the identity fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oidcConfig?.authority, oidcConfig?.clientId]);

  const authUser = oidcUser ? toAuthUser(oidcUser) : null;

  const value: AuthContextValue = {
    enabled,
    authenticated: enabled ? authUser !== null && !authUser.expired : true,
    loading,
    user: authUser,
    accessToken: authUser?.accessToken ?? null,
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
