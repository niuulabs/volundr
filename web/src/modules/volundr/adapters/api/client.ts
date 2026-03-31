/**
 * Re-export from shared API client.
 *
 * The canonical implementation lives in @/modules/shared/api/client.
 * This re-export preserves backwards compatibility for existing volundr imports.
 */
export {
  createApiClient,
  getAccessToken,
  setTokenProvider,
  ApiClientError,
} from '@/modules/shared/api/client';
export type { ApiClient, ApiError } from '@/modules/shared/api/client';
