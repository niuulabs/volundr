import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { niuuConfigSchema, type NiuuConfig } from './config';

const ConfigContext = createContext<NiuuConfig | null>(null);

interface ConfigProviderProps {
  endpoint?: string;
  value?: NiuuConfig;
  fallback?: ReactNode;
  errorFallback?: (error: Error) => ReactNode;
  children: ReactNode;
}

export function ConfigProvider({
  endpoint = '/config.json',
  value,
  fallback = null,
  errorFallback = (err) => <div role="alert">Config error: {err.message}</div>,
  children,
}: ConfigProviderProps) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; config: NiuuConfig }
    | { status: 'error'; error: Error }
  >(() => (value ? { status: 'ready', config: value } : { status: 'loading' }));

  useEffect(() => {
    if (value) {
      setState({ status: 'ready', config: value });
      return;
    }
    let cancelled = false;
    fetch(endpoint, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`GET ${endpoint} returned ${r.status}`);
        const raw = await r.json();
        return niuuConfigSchema.parse(raw);
      })
      .then((config) => {
        if (!cancelled) setState({ status: 'ready', config });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, value]);

  if (state.status === 'loading') return <>{fallback}</>;
  if (state.status === 'error') return <>{errorFallback(state.error)}</>;

  return <ConfigContext.Provider value={state.config}>{children}</ConfigContext.Provider>;
}

export function useConfig(): NiuuConfig {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within <ConfigProvider>');
  return ctx;
}
