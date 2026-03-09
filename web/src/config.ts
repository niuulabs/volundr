/**
 * Runtime configuration loaded from /config.json at startup.
 *
 * This file is served by nginx and generated from the Helm ConfigMap,
 * allowing deploy-time configuration without rebuilding the app.
 */

export interface RuntimeConfig {
  apiBaseUrl: string;
  oidc?: {
    authority: string;
    clientId: string;
    redirectUri?: string;
    postLogoutRedirectUri?: string;
    scope?: string;
  };
}

let cached: RuntimeConfig | null = null;

/**
 * Load runtime config from /config.json. Fetches once and caches.
 * Returns a default config if the fetch fails (local dev without nginx).
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch('/config.json');
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    cached = (await res.json()) as RuntimeConfig;
  } catch {
    cached = { apiBaseUrl: '' };
  }

  return cached;
}

/**
 * Get the cached runtime config. Returns null if not yet loaded.
 */
export function getRuntimeConfig(): RuntimeConfig | null {
  return cached;
}
