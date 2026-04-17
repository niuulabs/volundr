import { describe, it, expect, vi } from 'vitest';
import type { IIdentityService } from '@/modules/shared/ports/identity.port';

vi.mock('@/modules/shared/api/client', () => ({
  createApiClient: () => ({
    get: vi.fn().mockResolvedValue({
      user_id: 'usr-1',
      email: 'test@example.com',
      tenant_id: 'tenant-1',
      roles: ['admin'],
      display_name: 'Test User',
      status: 'active',
    }),
  }),
}));

// In test env (non-PROD, no VITE_USE_REAL_API), exports MockIdentityService
import { identityService } from './identity.adapter';

describe('identityService (MockIdentityService)', () => {
  it('returns a valid identity', async () => {
    const identity = await identityService.getIdentity();
    expect(identity).toHaveProperty('userId');
    expect(identity).toHaveProperty('email');
    expect(identity).toHaveProperty('tenantId');
    expect(identity).toHaveProperty('roles');
    expect(identity).toHaveProperty('displayName');
    expect(identity).toHaveProperty('status');
  });

  it('returns mock dev user identity', async () => {
    const identity = await identityService.getIdentity();
    expect(identity.userId).toBe('dev-user');
    expect(identity.email).toBe('dev@localhost');
    expect(identity.tenantId).toBe('default');
    expect(identity.roles).toContain('volundr:admin');
    expect(identity.displayName).toBe('Dev User');
    expect(identity.status).toBe('active');
  });

  it('implements IIdentityService interface', () => {
    const service: IIdentityService = identityService;
    expect(typeof service.getIdentity).toBe('function');
  });
});
