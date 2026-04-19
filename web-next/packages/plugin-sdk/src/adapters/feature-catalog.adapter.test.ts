import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@niuulabs/query';
import type { IFeatureCatalogService } from '../ports/feature-catalog.port';
import {
  createApiFeatureCatalogService,
  createMockFeatureCatalogService,
} from './feature-catalog.adapter';

const apiFeatures = [
  {
    key: 'users',
    label: 'Users',
    icon: 'Users',
    scope: 'admin',
    enabled: true,
    default_enabled: true,
    admin_only: true,
    order: 1,
  },
  {
    key: 'tenants',
    label: 'Tenants',
    icon: 'Building2',
    scope: 'admin',
    enabled: true,
    default_enabled: true,
    admin_only: true,
    order: 2,
  },
  {
    key: 'tokens',
    label: 'Access Tokens',
    icon: 'ShieldCheck',
    scope: 'user',
    enabled: true,
    default_enabled: true,
    admin_only: false,
    order: 1,
  },
];

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

describe('createApiFeatureCatalogService', () => {
  describe('getFeatureModules', () => {
    it('returns all features when no scope is provided', async () => {
      const client = mockApiClient({
        get: vi.fn().mockResolvedValue(apiFeatures),
      });
      const service = createApiFeatureCatalogService(client);
      const modules = await service.getFeatureModules();

      expect(client.get).toHaveBeenCalledWith('/features');
      expect(modules).toHaveLength(3);
    });

    it('passes scope as query parameter', async () => {
      const client = mockApiClient({
        get: vi.fn().mockResolvedValue(apiFeatures.filter((f) => f.scope === 'admin')),
      });
      const service = createApiFeatureCatalogService(client);
      await service.getFeatureModules('admin');

      expect(client.get).toHaveBeenCalledWith('/features?scope=admin');
    });

    it('maps snake_case API response to camelCase', async () => {
      const client = mockApiClient({
        get: vi.fn().mockResolvedValue([apiFeatures[0]]),
      });
      const service = createApiFeatureCatalogService(client);
      const [module] = await service.getFeatureModules();

      expect(module).toEqual({
        key: 'users',
        label: 'Users',
        icon: 'Users',
        scope: 'admin',
        enabled: true,
        defaultEnabled: true,
        adminOnly: true,
        order: 1,
      });
    });
  });

  describe('getUserFeaturePreferences', () => {
    it('fetches preferences from /features/preferences', async () => {
      const client = mockApiClient({
        get: vi.fn().mockResolvedValue([{ feature_key: 'users', visible: true, sort_order: 1 }]),
      });
      const service = createApiFeatureCatalogService(client);
      const prefs = await service.getUserFeaturePreferences();

      expect(client.get).toHaveBeenCalledWith('/features/preferences');
      expect(prefs).toEqual([{ featureKey: 'users', visible: true, sortOrder: 1 }]);
    });
  });

  describe('updateUserFeaturePreferences', () => {
    it('sends camelCase → snake_case and maps response back', async () => {
      const client = mockApiClient({
        put: vi.fn().mockResolvedValue([{ feature_key: 'users', visible: false, sort_order: 2 }]),
      });
      const service = createApiFeatureCatalogService(client);
      const result = await service.updateUserFeaturePreferences([
        { featureKey: 'users', visible: false, sortOrder: 2 },
      ]);

      expect(client.put).toHaveBeenCalledWith('/features/preferences', [
        { feature_key: 'users', visible: false, sort_order: 2 },
      ]);
      expect(result).toEqual([{ featureKey: 'users', visible: false, sortOrder: 2 }]);
    });
  });

  describe('toggleFeature', () => {
    it('patches /features/:key and maps response', async () => {
      const client = mockApiClient({
        patch: vi.fn().mockResolvedValue({ ...apiFeatures[0], enabled: false }),
      });
      const service = createApiFeatureCatalogService(client);
      const result = await service.toggleFeature('users', false);

      expect(client.patch).toHaveBeenCalledWith('/features/users', { enabled: false });
      expect(result.key).toBe('users');
      expect(result.enabled).toBe(false);
    });
  });

  it('implements IFeatureCatalogService interface', () => {
    const client = mockApiClient();
    const service: IFeatureCatalogService = createApiFeatureCatalogService(client);
    expect(typeof service.getFeatureModules).toBe('function');
    expect(typeof service.getUserFeaturePreferences).toBe('function');
    expect(typeof service.updateUserFeaturePreferences).toBe('function');
    expect(typeof service.toggleFeature).toBe('function');
  });
});

describe('createMockFeatureCatalogService', () => {
  it('returns all features when no scope is provided', async () => {
    const service = createMockFeatureCatalogService();
    const modules = await service.getFeatureModules();
    expect(modules.length).toBeGreaterThan(0);
    const scopes = new Set(modules.map((m) => m.scope));
    expect(scopes.has('admin')).toBe(true);
    expect(scopes.has('user')).toBe(true);
  });

  it('filters by admin scope', async () => {
    const service = createMockFeatureCatalogService();
    const modules = await service.getFeatureModules('admin');
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.every((m) => m.scope === 'admin')).toBe(true);
  });

  it('filters by user scope', async () => {
    const service = createMockFeatureCatalogService();
    const modules = await service.getFeatureModules('user');
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.every((m) => m.scope === 'user')).toBe(true);
  });

  it('returns empty preferences by default', async () => {
    const service = createMockFeatureCatalogService();
    expect(await service.getUserFeaturePreferences()).toEqual([]);
  });

  it('echoes preferences on update', async () => {
    const service = createMockFeatureCatalogService();
    const input = [{ featureKey: 'users', visible: true, sortOrder: 1 }];
    expect(await service.updateUserFeaturePreferences(input)).toEqual(input);
  });

  it('toggles feature and returns correct state', async () => {
    const service = createMockFeatureCatalogService();
    const result = await service.toggleFeature('users', false);
    expect(result.key).toBe('users');
    expect(result.enabled).toBe(false);
  });

  it('implements IFeatureCatalogService interface', () => {
    const service: IFeatureCatalogService = createMockFeatureCatalogService();
    expect(typeof service.getFeatureModules).toBe('function');
    expect(typeof service.getUserFeaturePreferences).toBe('function');
    expect(typeof service.updateUserFeaturePreferences).toBe('function');
    expect(typeof service.toggleFeature).toBe('function');
  });
});
