/**
 * Feature catalog adapter — delegates to an HTTP API for feature management.
 *
 * When a shared /api/v1/features endpoint exists, create the client
 * with that base path — no other code needs to change.
 */
import type { ApiClient } from '@niuulabs/query';
import type {
  IFeatureCatalogService,
  FeatureScope,
  FeatureModule,
  UserFeaturePreference,
} from '../ports/feature-catalog.port';

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

function mapFeatureModule(f: ApiFeatureModule): FeatureModule {
  return {
    key: f.key,
    label: f.label,
    icon: f.icon,
    scope: f.scope as FeatureScope,
    enabled: f.enabled,
    defaultEnabled: f.default_enabled,
    adminOnly: f.admin_only,
    order: f.order,
  };
}

function mapPreference(p: ApiUserFeaturePreference): UserFeaturePreference {
  return {
    featureKey: p.feature_key,
    visible: p.visible,
    sortOrder: p.sort_order,
  };
}

/**
 * Create a feature catalog service backed by an HTTP API.
 * @param client - An ApiClient pointed at the service that hosts `/features`
 */
export function createApiFeatureCatalogService(client: ApiClient): IFeatureCatalogService {
  return {
    async getFeatureModules(scope?: FeatureScope): Promise<FeatureModule[]> {
      const params = scope ? `?scope=${scope}` : '';
      const response = await client.get<ApiFeatureModule[]>(`/features${params}`);
      return response.map(mapFeatureModule);
    },

    async getUserFeaturePreferences(): Promise<UserFeaturePreference[]> {
      const response = await client.get<ApiUserFeaturePreference[]>('/features/preferences');
      return response.map(mapPreference);
    },

    async updateUserFeaturePreferences(
      preferences: UserFeaturePreference[],
    ): Promise<UserFeaturePreference[]> {
      const body = preferences.map((p) => ({
        feature_key: p.featureKey,
        visible: p.visible,
        sort_order: p.sortOrder,
      }));
      const response = await client.put<ApiUserFeaturePreference[]>('/features/preferences', body);
      return response.map(mapPreference);
    },

    async toggleFeature(key: string, enabled: boolean): Promise<FeatureModule> {
      const response = await client.patch<ApiFeatureModule>(`/features/${key}`, { enabled });
      return mapFeatureModule(response);
    },
  };
}

/**
 * Create a mock feature catalog service for development / testing.
 */
export function createMockFeatureCatalogService(): IFeatureCatalogService {
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

  return {
    async getFeatureModules(scope?: FeatureScope): Promise<FeatureModule[]> {
      if (!scope) return all;
      return all.filter((f) => f.scope === scope);
    },

    async getUserFeaturePreferences(): Promise<UserFeaturePreference[]> {
      return [];
    },

    async updateUserFeaturePreferences(
      prefs: UserFeaturePreference[],
    ): Promise<UserFeaturePreference[]> {
      return prefs;
    },

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
    },
  };
}
