import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useConfig } from './ConfigProvider';
import type { IFeatureCatalogService, FeatureModule } from './ports/feature-catalog.port';

export interface FeatureCatalog {
  isEnabled: (pluginId: string) => boolean;
  order: (pluginId: string) => number;
}

const FeatureCatalogContext = createContext<FeatureCatalog | null>(null);

interface FeatureCatalogProviderProps {
  overrides?: Partial<FeatureCatalog>;
  service?: IFeatureCatalogService;
  children: ReactNode;
}

/**
 * Provides feature-flag lookups to the component tree.
 *
 * Resolution order:
 * 1. `overrides` prop (highest priority — used for tests / Storybook)
 * 2. `service` prop — async backend data from `IFeatureCatalogService`
 * 3. `config.plugins` — static runtime config (always available as fallback)
 */
export function FeatureCatalogProvider({
  overrides,
  service,
  children,
}: FeatureCatalogProviderProps) {
  const config = useConfig();
  const [serviceModules, setServiceModules] = useState<FeatureModule[] | null>(null);

  useEffect(() => {
    if (!service) return;

    let cancelled = false;
    service
      .getFeatureModules()
      .then((modules) => {
        if (!cancelled) setServiceModules(modules);
      })
      .catch(() => {
        // Silently fall back to config-only on error
      });

    return () => {
      cancelled = true;
    };
  }, [service]);

  const catalog = useMemo<FeatureCatalog>(() => {
    // Build a lookup map from service modules when available
    const moduleMap = new Map<string, FeatureModule>();
    if (serviceModules) {
      for (const m of serviceModules) {
        moduleMap.set(m.key, m);
      }
    }

    return {
      isEnabled:
        overrides?.isEnabled ??
        ((pluginId: string) => {
          // Service data takes precedence over config
          const serviceModule = moduleMap.get(pluginId);
          if (serviceModule) return serviceModule.enabled;
          return config.plugins[pluginId]?.enabled !== false;
        }),
      order:
        overrides?.order ??
        ((pluginId: string) => {
          const serviceModule = moduleMap.get(pluginId);
          if (serviceModule) return serviceModule.order;
          return config.plugins[pluginId]?.order ?? 100;
        }),
    };
  }, [config, overrides, serviceModules]);

  return (
    <FeatureCatalogContext.Provider value={catalog}>{children}</FeatureCatalogContext.Provider>
  );
}

export function useFeatureCatalog(): FeatureCatalog {
  const ctx = useContext(FeatureCatalogContext);
  if (!ctx) throw new Error('useFeatureCatalog must be used within <FeatureCatalogProvider>');
  return ctx;
}
