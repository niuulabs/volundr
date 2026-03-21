/**
 * Rewrite an absolute URL so it uses the current browser origin,
 * but only when the URL points to a local/dev backend (loopback
 * address or same hostname on a different port).
 *
 * Backend API responses include absolute URLs for session endpoints
 * (e.g. `ws://127.0.0.1:8080/s/{id}/session`). When the frontend is
 * served from a different origin (Vite dev server on :5174), using
 * these URLs directly causes CORS failures and bypasses the dev proxy.
 *
 * In production, session endpoints may live on a different domain
 * (e.g. `sessions.example.com`) routed by a dedicated gateway.
 * Rewriting those would break connectivity, so we leave them intact.
 *
 * WebSocket URLs (`ws://`, `wss://`) are mapped to `ws://` / `wss://`
 * based on the current page protocol.
 */

const LOOPBACK_RE = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i;

function shouldRewrite(urlHost: string): boolean {
  const loc = globalThis.location;
  const urlHostname = urlHost.replace(/:\d+$/, '');
  const locHostname = loc.hostname;

  // Always rewrite loopback addresses (dev backend)
  if (LOOPBACK_RE.test(urlHostname)) return true;

  // Same hostname, different port (Vite proxy scenario)
  if (urlHostname === locHostname && urlHost !== loc.host) return true;

  return false;
}

export function rewriteOrigin(url: string): string {
  try {
    const parsed = new URL(url);

    if (!shouldRewrite(parsed.host)) {
      // Different production host — only normalise ws/wss protocol.
      const isWs = parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
      if (isWs) {
        const wsProto = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
        parsed.protocol = wsProto;
      }
      return parsed.toString();
    }

    const isWs = parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
    const loc = globalThis.location;

    if (isWs) {
      const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${loc.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return `${loc.protocol}//${loc.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Not a valid absolute URL — return as-is (already relative).
    return url;
  }
}
