import { describe, it, expect, vi } from 'vitest';
import type { IFeatureCatalogService } from '@/modules/shared/ports/feature-catalog.port';

vi.mock('@/modules/shared/api/client', () => ({
  createApiClient: () => ({
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  }),
}));

// In test env (non-PROD, no VITE_USE_REAL_API), the module exports MockFeatureCatalogService
import { featureCatalogService } from './feature-catalog.adapter';

describe('featureCatalogService (MockFeatureCatalogService)', () => {
  describe('getFeatureModules', () => {
    it('returns all features when no scope is provided', async () => {
      const modules = await featureCatalogService.getFeatureModules();
      expect(modules.length).toBeGreaterThan(0);
      const scopes = new Set(modules.map(m => m.scope));
      expect(scopes.has('admin')).toBe(true);
      expect(scopes.has('user')).toBe(true);
    });

    it('filters by admin scope', async () => {
      const modules = await featureCatalogService.getFeatureModules('admin');
      expect(modules.length).toBeGreaterThan(0);
      expect(modules.every(m => m.scope === 'admin')).toBe(true);
    });

    it('filters by user scope', async () => {
      const modules = await featureCatalogService.getFeatureModules('user');
      expect(modules.length).toBeGreaterThan(0);
      expect(modules.every(m => m.scope === 'user')).toBe(true);
    });

    it('returns feature modules with expected shape', async () => {
      const modules = await featureCatalogService.getFeatureModules();
      const first = modules[0];
      expect(first).toHaveProperty('key');
      expect(first).toHaveProperty('label');
      expect(first).toHaveProperty('icon');
      expect(first).toHaveProperty('scope');
      expect(first).toHaveProperty('enabled');
      expect(first).toHaveProperty('defaultEnabled');
      expect(first).toHaveProperty('adminOnly');
      expect(first).toHaveProperty('order');
    });
  });

  describe('getUserFeaturePreferences', () => {
    it('returns empty array', async () => {
      const prefs = await featureCatalogService.getUserFeaturePreferences();
      expect(prefs).toEqual([]);
    });
  });

  describe('updateUserFeaturePreferences', () => {
    it('returns the same preferences passed in', async () => {
      const input = [
        { featureKey: 'users', visible: true, sortOrder: 1 },
        { featureKey: 'tokens', visible: false, sortOrder: 2 },
      ];
      const result = await featureCatalogService.updateUserFeaturePreferences(input);
      expect(result).toEqual(input);
    });
  });

  describe('toggleFeature', () => {
    it('returns a feature module with the toggled enabled state', async () => {
      const result = await featureCatalogService.toggleFeature('users', false);
      expect(result.key).toBe('users');
      expect(result.enabled).toBe(false);
    });

    it('returns enabled true when toggled on', async () => {
      const result = await featureCatalogService.toggleFeature('tokens', true);
      expect(result.key).toBe('tokens');
      expect(result.enabled).toBe(true);
    });
  });

  it('implements all IFeatureCatalogService methods', () => {
    const service: IFeatureCatalogService = featureCatalogService;
    expect(typeof service.getFeatureModules).toBe('function');
    expect(typeof service.getUserFeaturePreferences).toBe('function');
    expect(typeof service.updateUserFeaturePreferences).toBe('function');
    expect(typeof service.toggleFeature).toBe('function');
  });
});
