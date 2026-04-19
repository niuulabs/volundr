import { useContext } from 'react';
import { AuthContext } from '../AuthContext';

/**
 * Returns the current access token string, or null when not authenticated.
 * Use this to forward the Bearer token to API calls made outside the
 * HTTP client (e.g. WebSocket handshakes).
 */
export function useAccessToken(): string | null {
  return useContext(AuthContext).accessToken;
}
