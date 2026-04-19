import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@niuulabs/auth';
import styles from './CallbackPage.module.css';

/**
 * OIDC callback handler — rendered at /login/callback.
 *
 * AuthProvider detects the ?code= query param on any URL and calls
 * signinRedirectCallback(). While that is in flight, AuthProvider shows
 * its loading state. Once it completes, it renders its children and the
 * router resolves this route. CallbackPage then waits for auth state to
 * settle and navigates to "/" which the shell redirects to the default
 * plugin.
 */
export function CallbackPage(): ReactNode {
  const { authenticated, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (authenticated) {
      void navigate({ to: '/' });
    }
  }, [loading, authenticated, navigate]);

  const label = loading
    ? 'Completing sign-in…'
    : authenticated
      ? 'Redirecting…'
      : 'Sign-in failed.';

  return (
    <div className={styles.page} data-testid="callback-page">
      <div className={styles.inner}>
        {(loading || authenticated) && (
          <div className={styles.spinner} aria-label={label} role="status" />
        )}
        <p className={styles.label}>{label}</p>
      </div>
    </div>
  );
}
