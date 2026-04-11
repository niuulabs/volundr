/**
 * Proxy manifest — declares dev-server proxy entries for all modules.
 *
 * This file is imported by vite.config.ts (Node context) to generate
 * proxy configuration dynamically. Add entries here when a new module
 * has its own backend on a separate port.
 *
 * The base /api proxy (Volundr) and /s/ WebSocket proxy are always
 * included by the Vite config and do not need entries here.
 */
export interface ProxyEntry {
  /** URL path prefix to proxy, e.g. "/api/v1/tyr" */
  path: string;
  /** Environment variable that overrides the target */
  targetEnvVar: string;
  /** Default proxy target when the env var is not set */
  defaultTarget: string;
  /** Enable WebSocket proxying */
  ws?: boolean;
}

export const MODULE_PROXIES: ProxyEntry[] = [
  {
    path: '/api/v1/tyr',
    targetEnvVar: 'VITE_TYR_API_TARGET',
    defaultTarget: 'http://localhost:8081',
  },
  {
    path: '/mimir',
    targetEnvVar: 'VITE_MIMIR_API_TARGET',
    defaultTarget: 'http://localhost:7477',
  },
];
