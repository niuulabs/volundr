import { useAuth } from '@niuulabs/auth';
import { LoginPage } from './LoginPage';

/**
 * Route component wrapper for /login.
 * Pulls login() from AuthContext so LoginPage receives it as a prop.
 * This is only rendered inside the Shell (authenticated router context),
 * so useAuth() is always available here.
 */
export function LoginRoute() {
  const { login, loading } = useAuth();
  return <LoginPage onLogin={login} loading={loading} />;
}
