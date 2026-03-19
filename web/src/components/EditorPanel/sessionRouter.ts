/**
 * Mutable session routing for the VS Code workbench.
 *
 * Because `initialize()` from @codingame/monaco-vscode-api can only be
 * called once per page load, the WebSocket factory and workspace folder
 * must be dynamically routable to different session REH servers.
 *
 * This module holds the mutable session state and tracks active WebSocket
 * connections so they can be closed on session switch, forcing VS Code
 * to reconnect through the factory (which now routes to the new session).
 */

export interface SessionRoute {
  sessionId: string;
  hostname: string;
  /** Base path for the session (e.g. "/s/{id}/"), used to prefix /reh/. */
  basePath?: string;
}

let activeRoute: SessionRoute | null = null;
const activeWebSockets = new Set<WebSocket>();

/** Get the current session route. */
export function getActiveRoute(): SessionRoute | null {
  return activeRoute;
}

/** Update the active session route. */
export function setActiveRoute(route: SessionRoute): void {
  activeRoute = route;
}

/** Register a WebSocket so it can be closed on session switch. */
export function trackWebSocket(ws: WebSocket): void {
  activeWebSockets.add(ws);
  ws.addEventListener('close', () => activeWebSockets.delete(ws));
}

/** Close all tracked WebSocket connections to force VS Code to reconnect. */
export function closeAllWebSockets(): void {
  for (const ws of activeWebSockets) {
    ws.close();
  }
  activeWebSockets.clear();
}

/** Reset all state. Exposed for testing only. @internal */
export function resetSessionRouter(): void {
  activeRoute = null;
  activeWebSockets.clear();
}
