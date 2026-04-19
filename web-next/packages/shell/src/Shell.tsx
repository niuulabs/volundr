import { createContext, useMemo } from 'react';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useFeatureCatalog, type PluginDescriptor } from '@niuulabs/plugin-sdk';
import { composeRoutes } from './composeRoutes';
import './Shell.css';

export interface ShellContextValue {
  plugins: PluginDescriptor[];
  brand: string;
  version: string;
}

export const ShellContext = createContext<ShellContextValue>({
  plugins: [],
  brand: 'ᚾ',
  version: '0.0.1',
});

interface ShellProps {
  plugins: PluginDescriptor[];
  brand?: string;
  version?: string;
  history?: RouterHistory;
}

export function Shell({ plugins, brand = 'ᚾ', version = '0.0.1', history }: ShellProps) {
  const features = useFeatureCatalog();

  const enabled = useMemo(
    () =>
      plugins
        .filter((p) => features.isEnabled(p.id))
        .sort((a, b) => features.order(a.id) - features.order(b.id)),
    [plugins, features],
  );

  const router = useMemo(
    () => composeRoutes(enabled, history ? { history } : undefined),
    [enabled, history],
  );

  const ctx = useMemo(() => ({ plugins: enabled, brand, version }), [enabled, brand, version]);

  return (
    <ShellContext.Provider value={ctx}>
      <RouterProvider router={router} />
    </ShellContext.Provider>
  );
}
