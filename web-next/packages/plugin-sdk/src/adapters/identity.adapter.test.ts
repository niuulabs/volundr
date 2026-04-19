import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@niuulabs/query';
import type { IIdentityService } from '../ports/identity.port';
import { createApiIdentityService, createMockIdentityService } from './identity.adapter';

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe('createApiIdentityService', () => {
  it('fetches identity from /me and maps snake_case to camelCase', async () => {
    const client = mockApiClient({
      get: vi.fn().mockResolvedValue({
        user_id: 'u-123',
        email: 'alice@example.com',
        tenant_id: 't-456',
        roles: ['admin', 'editor'],
        display_name: 'Alice',
        status: 'active',
      }),
    });

    const service = createApiIdentityService(client);
    const identity = await service.getIdentity();

    expect(client.get).toHaveBeenCalledWith('/me');
    expect(identity).toEqual({
      userId: 'u-123',
      email: 'alice@example.com',
      tenantId: 't-456',
      roles: ['admin', 'editor'],
      displayName: 'Alice',
      status: 'active',
    });
  });

  it('returns all required AppIdentity fields', async () => {
    const client = mockApiClient({
      get: vi.fn().mockResolvedValue({
        user_id: 'x',
        email: 'x@x.com',
        tenant_id: 'x',
        roles: [],
        display_name: 'X',
        status: 'inactive',
      }),
    });

    const identity = await createApiIdentityService(client).getIdentity();
    expect(identity).toHaveProperty('userId');
    expect(identity).toHaveProperty('email');
    expect(identity).toHaveProperty('tenantId');
    expect(identity).toHaveProperty('roles');
    expect(identity).toHaveProperty('displayName');
    expect(identity).toHaveProperty('status');
  });

  it('implements IIdentityService interface', () => {
    const client = mockApiClient();
    const service: IIdentityService = createApiIdentityService(client);
    expect(typeof service.getIdentity).toBe('function');
  });
});

describe('createMockIdentityService', () => {
  it('returns default dev identity', async () => {
    const service = createMockIdentityService();
    const identity = await service.getIdentity();
    expect(identity.userId).toBe('dev-user');
    expect(identity.email).toBe('dev@localhost');
    expect(identity.tenantId).toBe('default');
    expect(identity.roles).toContain('volundr:admin');
    expect(identity.displayName).toBe('Dev User');
    expect(identity.status).toBe('active');
  });

  it('applies overrides', async () => {
    const service = createMockIdentityService({
      userId: 'custom-user',
      roles: ['reader'],
    });
    const identity = await service.getIdentity();
    expect(identity.userId).toBe('custom-user');
    expect(identity.roles).toEqual(['reader']);
    expect(identity.email).toBe('dev@localhost');
  });

  it('implements IIdentityService interface', () => {
    const service: IIdentityService = createMockIdentityService();
    expect(typeof service.getIdentity).toBe('function');
  });
});
