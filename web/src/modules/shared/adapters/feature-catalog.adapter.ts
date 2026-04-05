/**
 * Feature catalog adapter — delegates to the Volundr API for now.
 *
 * When a shared /api/v1/features endpoint exists, update the base path
 * here — no other code needs to change.
 */
import { createApiClient } from '@/modules/shared/api/client';
import type {
  IFeatureCatalogService,
  FeatureScope,
  FeatureModule,
  UserFeaturePreference,
} from '@/modules/shared/ports/feature-catalog.port';

interface ApiFeatureModule {
  key: string;
  label: string;
  icon: string;
  scope: string;
  enabled: boolean;
  default_enabled: boolean;
  admin_only: boolean;
  order: number;
}

interface ApiUserFeaturePreference {
  feature_key: string;
  visible: boolean;
  sort_order: number;
}

const api = createApiClient('/api/v1/volundr');

class ApiFeatureCatalogService implements IFeatureCatalogService {
  async getFeatureModules(scope?: FeatureScope): Promise<FeatureModule[]> {
    const params = scope ? `?scope=${scope}` : '';
    const response = await api.get<ApiFeatureModule[]>(`/features${params}`);
    return response.map(f => ({
      key: f.key,
      label: f.label,
      icon: f.icon,
      scope: f.scope as FeatureScope,
      enabled: f.enabled,
      defaultEnabled: f.default_enabled,
      adminOnly: f.admin_only,
      order: f.order,
    }));
  }

  async getUserFeaturePreferences(): Promise<UserFeaturePreference[]> {
    const response = await api.get<ApiUserFeaturePreference[]>('/features/preferences');
    return response.map(p => ({
      featureKey: p.feature_key,
      visible: p.visible,
      sortOrder: p.sort_order,
    }));
  }

  async updateUserFeaturePreferences(
    preferences: UserFeaturePreference[]
  ): Promise<UserFeaturePreference[]> {
    const body = preferences.map(p => ({
      feature_key: p.featureKey,
      visible: p.visible,
      sort_order: p.sortOrder,
    }));
    const response = await api.put<ApiUserFeaturePreference[]>('/features/preferences', body);
    return response.map(p => ({
      featureKey: p.feature_key,
      visible: p.visible,
      sortOrder: p.sort_order,
    }));
  }

  async toggleFeature(key: string, enabled: boolean): Promise<FeatureModule> {
    const response = await api.patch<ApiFeatureModule>(`/features/${key}`, { enabled });
    return {
      key: response.key,
      label: response.label,
      icon: response.icon,
      scope: response.scope as FeatureScope,
      enabled: response.enabled,
      defaultEnabled: response.default_enabled,
      adminOnly: response.admin_only,
      order: response.order,
    };
  }
}

class MockFeatureCatalogService implements IFeatureCatalogService {
  async getFeatureModules(scope?: FeatureScope): Promise<FeatureModule[]> {
    const all: FeatureModule[] = [
      {
        key: 'users',
        label: 'Users',
        icon: 'Users',
        scope: 'admin',
        enabled: true,
        defaultEnabled: true,
        adminOnly: true,
        order: 1,
      },
      {
        key: 'tenants',
        label: 'Tenants',
        icon: 'Building2',
        scope: 'admin',
        enabled: true,
        defaultEnabled: true,
        adminOnly: true,
        order: 2,
      },
      {
        key: 'tokens',
        label: 'Access Tokens',
        icon: 'ShieldCheck',
        scope: 'user',
        enabled: true,
        defaultEnabled: true,
        adminOnly: false,
        order: 1,
      },
      {
        key: 'credentials',
        label: 'Credentials',
        icon: 'KeyRound',
        scope: 'user',
        enabled: true,
        defaultEnabled: true,
        adminOnly: false,
        order: 2,
      },
    ];
    if (!scope) return all;
    return all.filter(f => f.scope === scope);
  }

  async getUserFeaturePreferences(): Promise<UserFeaturePreference[]> {
    return [];
  }

  async updateUserFeaturePreferences(
    prefs: UserFeaturePreference[]
  ): Promise<UserFeaturePreference[]> {
    return prefs;
  }

  async toggleFeature(key: string, enabled: boolean): Promise<FeatureModule> {
    return {
      key,
      label: key,
      icon: 'Box',
      scope: 'user',
      enabled,
      defaultEnabled: true,
      adminOnly: false,
      order: 0,
    };
  }
}

function shouldUseRealApi(): boolean {
  if (import.meta.env.PROD) return true;
  return import.meta.env.VITE_USE_REAL_API === 'true';
}

export const featureCatalogService: IFeatureCatalogService = shouldUseRealApi()
  ? new ApiFeatureCatalogService()
  : new MockFeatureCatalogService();
