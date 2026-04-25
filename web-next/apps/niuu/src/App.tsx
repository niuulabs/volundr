import { useEffect, useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from '@niuulabs/design-tokens';
import {
  ConfigProvider,
  FeatureCatalogProvider,
  ServicesProvider,
  type IFeatureCatalogService,
  useConfig,
} from '@niuulabs/plugin-sdk';
import { createQueryClient } from '@niuulabs/query';
import { AuthProvider } from '@niuulabs/auth';
import { Shell } from '@niuulabs/shell';
import { plugins } from './plugins';
import { buildServiceBackendStatus, buildServices } from './services';

const DEFAULT_CONFIG_ENDPOINT = '/config.json';
const CONFIG_ENDPOINT_QUERY_KEY = 'config';
const CONFIG_ENDPOINT_STORAGE_KEY = 'niuu.config.endpoint';

export function publishServiceBackends(
  backends: Record<string, unknown>,
  target: Record<string, unknown> = globalThis as Record<string, unknown>,
): void {
  target.__NIUU_SERVICE_BACKENDS__ = backends;
}

function AppInner() {
  const config = useConfig();
  const services = useMemo(() => buildServices(config), [config]);
  const backendStatus = useMemo(() => buildServiceBackendStatus(config), [config]);
  const featureCatalogService = services.features as IFeatureCatalogService | undefined;

  useEffect(() => {
    publishServiceBackends(backendStatus);
  }, [backendStatus]);

  return (
    <AuthProvider>
      <ServicesProvider services={services}>
        <FeatureCatalogProvider service={featureCatalogService}>
          <Shell plugins={plugins} />
        </FeatureCatalogProvider>
      </ServicesProvider>
    </AuthProvider>
  );
}

const queryClient = createQueryClient();

export function resolveConfigEndpoint(
  location: Pick<Location, 'search'> = window.location,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): string {
  const params = new URLSearchParams(location.search);
  const requested = params.get(CONFIG_ENDPOINT_QUERY_KEY);

  if (requested === 'default') {
    storage.removeItem(CONFIG_ENDPOINT_STORAGE_KEY);
    return DEFAULT_CONFIG_ENDPOINT;
  }

  if (requested && requested.startsWith('/')) {
    storage.setItem(CONFIG_ENDPOINT_STORAGE_KEY, requested);
    return requested;
  }

  const stored = storage.getItem(CONFIG_ENDPOINT_STORAGE_KEY);
  if (stored && stored.startsWith('/')) return stored;
  return DEFAULT_CONFIG_ENDPOINT;
}

export function App() {
  const configEndpoint = resolveConfigEndpoint();

  return (
    <ConfigProvider
      endpoint={configEndpoint}
      fallback={<BootScreen label="loading config…" />}
      errorFallback={(err) => <BootScreen label={`config error: ${err.message}`} />}
    >
      <ThemeProvider theme="ice">
        <QueryClientProvider client={queryClient}>
          <AppInner />
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </ThemeProvider>
    </ConfigProvider>
  );
}

function BootScreen({ label }: { label: string }) {
  return (
    <div className="niuu-h-screen niuu-flex niuu-items-center niuu-justify-center niuu-bg-bg-primary niuu-text-text-secondary niuu-font-mono niuu-text-xs">
      {label}
    </div>
  );
}
