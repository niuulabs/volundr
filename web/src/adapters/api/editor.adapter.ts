import type { IEditorService, WorkbenchConfig } from '@/ports/editor.port';

/**
 * Constructs VS Code workbench connection config from the session hostname.
 *
 * The REH server runs inside the session pod behind nginx, which routes
 * `/reh/` to the REH container. All WebSocket traffic goes through the
 * same host:port as the rest of the session (nginx entry point), so no
 * separate port is needed.
 *
 * `remoteAuthority` is set to the hostname (which may already include a
 * port in local k3s mode, e.g. "127.0.0.1:8080"). VS Code uses it to
 * build WebSocket URLs, which the `webSocketFactory` in EditorPanel
 * rewrites to route through `/reh/`.
 */
export class ApiEditorAdapter implements IEditorService {
  getWorkbenchConfig(_sessionId: string, hostname: string): WorkbenchConfig {
    const remoteAuthority = hostname;
    const protocol = globalThis.location?.protocol === 'http:' ? 'ws' : 'wss';
    const wsUrl = `${protocol}://${hostname}/reh/`;

    return { remoteAuthority, wsUrl };
  }
}
