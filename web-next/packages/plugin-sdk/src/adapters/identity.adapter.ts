/**
 * Identity adapter — fetches the current user's identity from the API.
 *
 * Reuses the existing /api/v1/volundr/me endpoint. When the backend
 * exposes a shared /api/v1/identity/me in the future, update the
 * basePath here — no other code needs to change.
 */
import type { ApiClient } from '@niuulabs/query';
import type { AppIdentity, IIdentityService } from '../ports/identity.port';

interface ApiIdentityResponse {
  user_id: string;
  email: string;
  tenant_id: string;
  roles: string[];
  display_name: string;
  status: string;
}

/**
 * Create an identity service backed by an HTTP API.
 * @param client - An ApiClient pointed at the service that hosts `/me`
 */
export function createApiIdentityService(client: ApiClient): IIdentityService {
  return {
    async getIdentity(): Promise<AppIdentity> {
      const r = await client.get<ApiIdentityResponse>('/me');
      return {
        userId: r.user_id,
        email: r.email,
        tenantId: r.tenant_id,
        roles: r.roles,
        displayName: r.display_name,
        status: r.status,
      };
    },
  };
}

/**
 * Create a mock identity service for development / testing.
 */
export function createMockIdentityService(overrides: Partial<AppIdentity> = {}): IIdentityService {
  return {
    async getIdentity(): Promise<AppIdentity> {
      return {
        userId: 'dev-user',
        email: 'dev@localhost',
        tenantId: 'default',
        roles: ['volundr:admin'],
        displayName: 'Dev User',
        status: 'active',
        ...overrides,
      };
    },
  };
}
