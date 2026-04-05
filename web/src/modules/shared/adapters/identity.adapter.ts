/**
 * Identity adapter — fetches the current user's identity from the API.
 *
 * Reuses the existing /api/v1/volundr/me endpoint. When the backend
 * exposes a shared /api/v1/identity/me in the future, update the
 * basePath here — no other code needs to change.
 */
import { createApiClient } from '@/modules/shared/api/client';
import type { AppIdentity, IIdentityService } from '@/modules/shared/ports/identity.port';

interface ApiIdentityResponse {
  user_id: string;
  email: string;
  tenant_id: string;
  roles: string[];
  display_name: string;
  status: string;
}

const api = createApiClient('/api/v1/volundr');

class ApiIdentityService implements IIdentityService {
  async getIdentity(): Promise<AppIdentity> {
    const r = await api.get<ApiIdentityResponse>('/me');
    return {
      userId: r.user_id,
      email: r.email,
      tenantId: r.tenant_id,
      roles: r.roles,
      displayName: r.display_name,
      status: r.status,
    };
  }
}

class MockIdentityService implements IIdentityService {
  async getIdentity(): Promise<AppIdentity> {
    return {
      userId: 'dev-user',
      email: 'dev@localhost',
      tenantId: 'default',
      roles: ['volundr:admin'],
      displayName: 'Dev User',
      status: 'active',
    };
  }
}

function shouldUseRealApi(): boolean {
  if (import.meta.env.PROD) {
    return true;
  }
  return import.meta.env.VITE_USE_REAL_API === 'true';
}

export const identityService: IIdentityService = shouldUseRealApi()
  ? new ApiIdentityService()
  : new MockIdentityService();
