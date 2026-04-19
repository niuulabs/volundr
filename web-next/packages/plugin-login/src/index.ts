import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { LoginRoute } from './ui/LoginRoute';
import { CallbackPage } from './ui/CallbackPage';

// ---------------------------------------------------------------------------
// loginPlugin — routes at /login and /login/callback.
//
// navHidden: true  →  not shown in the shell's rail nav.
// The AuthProvider uses LoginPage directly via its loginPageComponent prop
// (wired in apps/niuu/src/App.tsx). These routes serve as the OIDC callback
// target when auth.redirectUri is set to /login/callback, and also render
// the login page for direct navigation (e.g. after session expiry within
// an already-booted shell).
// ---------------------------------------------------------------------------

export const loginPlugin = definePlugin({
  id: 'login',
  rune: 'ᚾ',
  title: 'Login',
  subtitle: 'sign in to continue',
  navHidden: true,
  routes: (rootRoute: AnyRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/login',
      component: LoginRoute,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/login/callback',
      component: CallbackPage,
    }),
  ],
});

// ---------------------------------------------------------------------------
// Named exports for consumers that need the components directly
// ---------------------------------------------------------------------------

export { LoginPage } from './ui/LoginPage';
export type { LoginPageProps } from './ui/LoginPage';
export { CallbackPage } from './ui/CallbackPage';
