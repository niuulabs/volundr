import type { IEditorService, WorkbenchConfig } from '@/ports/editor.port';

/**
 * Constructs VS Code workbench connection config from the session hostname.
 *
 * The REH server runs inside the session pod behind nginx, which routes
 * `/reh/` to the REH container. In k3s/proxied mode, requests must go
 * through the session's base path (e.g. `/s/{id}/reh/`) so the ingress
 * can route them to the correct pod.
 *
 * `remoteAuthority` is set to the hostname (which may already include a
 * port in local k3s mode, e.g. "127.0.0.1:8080"). VS Code uses it to
 * build WebSocket URLs, which the `webSocketFactory` in EditorPanel
 * rewrites to route through the correct base path + `/reh/`.
 */
export class ApiEditorAdapter implements IEditorService {
  getWorkbenchConfig(_sessionId: string, hostname: string, codeEndpoint?: string): WorkbenchConfig {
    const remoteAuthority = hostname;
    const protocol = globalThis.location?.protocol === 'http:' ? 'ws' : 'wss';

    // Extract the base path from the code endpoint URL (e.g. "/s/{id}/")
    // so WebSocket connections route through the ingress to the correct pod.
    let basePath: string | undefined;
    if (codeEndpoint) {
      try {
        const path = new URL(codeEndpoint).pathname;
        // Ensure it ends with / so we can append reh/ directly
        basePath = path.endsWith('/') ? path : `${path}/`;
      } catch {
        // Fall through — basePath stays undefined, /reh/ used directly
      }
    }

    const rehBase = basePath ?? '/';
    const wsUrl = `${protocol}://${hostname}${rehBase}reh/`;

    return { remoteAuthority, wsUrl, basePath };
  }
}
