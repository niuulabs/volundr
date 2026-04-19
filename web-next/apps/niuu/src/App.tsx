import { useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from '@niuulabs/design-tokens';
import {
  ConfigProvider,
  FeatureCatalogProvider,
  ServicesProvider,
  useConfig,
} from '@niuulabs/plugin-sdk';
import { createQueryClient } from '@niuulabs/query';
import { AuthProvider } from '@niuulabs/auth';
import { Shell } from '@niuulabs/shell';
import { plugins } from './plugins';
import { buildServices } from './services';

function AppInner() {
  const config = useConfig();
  const services = useMemo(() => buildServices(config), [config]);

  return (
    <AuthProvider>
      <ServicesProvider services={services}>
        <FeatureCatalogProvider>
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
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-primary, #09090b)',
        color: 'var(--color-text-secondary, #a1a1aa)',
        fontFamily: 'var(--font-mono, ui-monospace)',
        fontSize: 12,
      }}
    >
      {label}
    </div>
  );
}
