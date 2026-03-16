/**
 * Editor service port — abstracts the configuration needed to connect
 * the VS Code workbench to a remote REH server in a session pod.
 */

export interface WorkbenchConfig {
  /** The remote authority string for VS Code (e.g. "pod-hostname:8445"). */
  remoteAuthority: string;
  /** The WebSocket URL for the REH server connection. */
  wsUrl: string;
  /** Base path for the session (e.g. "/s/{id}/"), used to prefix /reh/ in proxied setups. */
  basePath?: string;
}

export interface IEditorService {
  /**
   * Build the workbench connection config for a given session.
   *
   * @param sessionId    - The session UUID
   * @param hostname     - The session pod hostname (direct or gateway-routed)
   * @param codeEndpoint - The full code endpoint URL (used to derive session base path)
   * @returns Configuration for the VS Code workbench remote connection
   */
  getWorkbenchConfig(sessionId: string, hostname: string, codeEndpoint?: string): WorkbenchConfig;
}
