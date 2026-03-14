import type { IEditorService, WorkbenchConfig } from '@/ports/editor.port';

/**
 * Default REH server port inside the session pod.
 * Must match the `reh.port` value in the Skuld Helm chart.
 */
const DEFAULT_REH_PORT = 8445;

/**
 * Constructs VS Code workbench connection config from the session hostname.
 *
 * The REH server runs inside the session pod behind nginx, which routes
 * `/reh/` to the REH container. The WebSocket URL uses the same hostname
 * with the `wss://` scheme so it flows through the Envoy sidecar for
 * JWT validation via the subprotocol bearer pattern.
 */
export class ApiEditorAdapter implements IEditorService {
  getWorkbenchConfig(_sessionId: string, hostname: string): WorkbenchConfig {
    const remoteAuthority = `${hostname}:${DEFAULT_REH_PORT}`;
    const protocol = globalThis.location?.protocol === 'http:' ? 'ws' : 'wss';
    const wsUrl = `${protocol}://${hostname}/reh/`;

    return { remoteAuthority, wsUrl };
  }
}
