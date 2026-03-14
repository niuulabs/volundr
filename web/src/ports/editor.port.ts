/**
 * Editor service port — abstracts the configuration needed to connect
 * the VS Code workbench to a remote REH server in a session pod.
 */

export interface WorkbenchConfig {
  /** The remote authority string for VS Code (e.g. "pod-hostname:8445"). */
  remoteAuthority: string;
  /** The WebSocket URL for the REH server connection. */
  wsUrl: string;
}

export interface IEditorService {
  /**
   * Build the workbench connection config for a given session.
   *
   * @param sessionId - The session UUID
   * @param hostname  - The session pod hostname (direct or gateway-routed)
   * @returns Configuration for the VS Code workbench remote connection
   */
  getWorkbenchConfig(sessionId: string, hostname: string): WorkbenchConfig;
}
