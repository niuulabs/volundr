import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useConfig } from './ConfigProvider';

export interface FeatureCatalog {
  isEnabled: (pluginId: string) => boolean;
  order: (pluginId: string) => number;
}

const FeatureCatalogContext = createContext<FeatureCatalog | null>(null);

interface FeatureCatalogProviderProps {
  overrides?: Partial<FeatureCatalog>;
  children: ReactNode;
}

export function FeatureCatalogProvider({ overrides, children }: FeatureCatalogProviderProps) {
  const config = useConfig();

  const catalog = useMemo<FeatureCatalog>(() => {
    return {
      isEnabled:
        overrides?.isEnabled ?? ((pluginId: string) => config.plugins[pluginId]?.enabled !== false),
      order: overrides?.order ?? ((pluginId: string) => config.plugins[pluginId]?.order ?? 100),
    };
  }, [config, overrides]);

  return (
    <FeatureCatalogContext.Provider value={catalog}>{children}</FeatureCatalogContext.Provider>
  );
}

export function useFeatureCatalog(): FeatureCatalog {
  const ctx = useContext(FeatureCatalogContext);
  if (!ctx) throw new Error('useFeatureCatalog must be used within <FeatureCatalogProvider>');
  return ctx;
}
