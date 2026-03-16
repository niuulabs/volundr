/**
 * Rewrite an absolute URL so it uses the current browser origin.
 *
 * Backend API responses include absolute URLs for session endpoints
 * (e.g. `ws://127.0.0.1:8080/s/{id}/session`). When the frontend is
 * served from a different origin (Vite dev server on :5174), using
 * these URLs directly causes CORS failures and bypasses the dev proxy.
 *
 * This helper keeps the pathname + search + hash but swaps the origin
 * to `window.location`, so the request routes through the Vite proxy
 * in dev and hits the same-origin gateway in production.
 *
 * WebSocket URLs (`ws://`, `wss://`) are mapped to `ws://` / `wss://`
 * based on the current page protocol.
 */
export function rewriteOrigin(url: string): string {
  try {
    const parsed = new URL(url);
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
