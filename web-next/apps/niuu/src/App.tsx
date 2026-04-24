import { useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from '@niuulabs/design-tokens';
import {
  buildFeatureCatalogAdapter,
  createMockFeatureCatalogService,
  ConfigProvider,
  FeatureCatalogProvider,
  ServicesProvider,
  type IFeatureCatalogService,
  useConfig,
} from '@niuulabs/plugin-sdk';
import { createApiClient, createQueryClient } from '@niuulabs/query';
import { AuthProvider } from '@niuulabs/auth';
import { Shell } from '@niuulabs/shell';
import { plugins } from './plugins';
import { buildServices, resolveSharedApiBase } from './services';

function AppInner() {
  const config = useConfig();
  const services = useMemo(() => buildServices(config), [config]);
  const featureCatalogService = useMemo<IFeatureCatalogService | undefined>(() => {
    const sharedBase = resolveSharedApiBase(config);
    if (!sharedBase) return createMockFeatureCatalogService();
    return buildFeatureCatalogAdapter(createApiClient(sharedBase));
  }, [config]);

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

export function App() {
  return (
    <ConfigProvider
      endpoint="/config.json"
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
