/**
 * WebSocket factory that injects bearer tokens via the Sec-WebSocket-Protocol
 * header using the K8s subprotocol bearer pattern.
 *
 * Protocol format: `base64url.bearer.authorization.k8s.io.<base64url-token>`
 *
 * This allows Envoy's Lua filter to extract the token and forward it as a
 * standard Authorization header for JWT validation — the same pattern used
 * by Skuld chat and ttyd terminal connections.
 */

/** Encode a string to base64url (RFC 4648 §5, no padding). */
export function toBase64Url(input: string): string {
  const base64 = btoa(input);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The VS Code REH subprotocol identifier.
 * Included alongside the bearer token so the server can negotiate
 * the correct protocol after auth validation.
 */
export const VSCODE_REH_PROTOCOL = 'vscode-reh';

/** Prefix for K8s-style subprotocol bearer tokens. */
export const BEARER_PROTOCOL_PREFIX = 'base64url.bearer.authorization.k8s.io';

/**
 * Build the subprotocol array for a WebSocket connection.
 *
 * When a token is provided, the array contains both the VS Code REH
 * protocol identifier and the bearer token protocol. When no token is
 * available, only the REH protocol is included.
 */
export function buildSubprotocols(token: string | null): string[] {
  if (!token) {
    return [VSCODE_REH_PROTOCOL];
  }

  const encoded = toBase64Url(token);
  return [VSCODE_REH_PROTOCOL, `${BEARER_PROTOCOL_PREFIX}.${encoded}`];
}

export interface BearerWebSocketFactoryOptions {
  /** Returns the current bearer token, or null if unauthenticated. */
  getToken: () => string | null;
}

/**
 * Create a WebSocket factory that injects subprotocol bearer auth.
 *
 * Returns a function with the same signature as the `WebSocket` constructor,
 * suitable for passing to VS Code's `webSocketFactory` configuration.
 */
export function createBearerWebSocketFactory(
  options: BearerWebSocketFactoryOptions
): (url: string) => WebSocket {
  return (url: string): WebSocket => {
    const token = options.getToken();
    const protocols = buildSubprotocols(token);
    return new WebSocket(url, protocols);
  };
}
