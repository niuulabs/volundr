import { useMemo, useState, useCallback } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import {
  useConfig,
  useFeatureCatalog,
  type PluginDescriptor,
  type PluginCtx,
} from '@niuulabs/plugin-sdk';
import { ShellContext } from './ShellContext';
import { composeRouter } from './composeRouter';

interface ShellProps {
  plugins: PluginDescriptor[];
  brand?: string;
  version?: string;
  /** @internal Override the router history — for tests and Storybook only. */
  _testHistory?: RouterHistory;
}

export function Shell({ plugins, brand = 'ᚾ', version = '0.0.1', _testHistory }: ShellProps) {
  const config = useConfig();
  const features = useFeatureCatalog();

  const enabled = useMemo(
    () =>
      plugins
        .filter((p) => features.isEnabled(p.id))
        .sort((a, b) => features.order(a.id) - features.order(b.id)),
    [plugins, features],
  );

  const [tweaks, setTweaks] = useState<Record<string, unknown>>({});
  const setTweak = useCallback((key: string, value: unknown) => {
    setTweaks((t) => ({ ...t, [key]: value }));
  }, []);

  const ctx: PluginCtx = useMemo(() => ({ tweaks, setTweak }), [tweaks, setTweak]);

  // Rebuild the router whenever the enabled plugin set changes. Passing
  // _testHistory lets tests inject a memory history to avoid clobbering
  // window.location between specs.
  const router = useMemo(
    () => composeRouter(enabled, { history: _testHistory }),
    [enabled, _testHistory],
  );

  // useConfig is called to satisfy the hook contract; the value is only
  // consumed downstream in ShellLayout (which reads it from context).
  void config;

  return (
    <ShellContext.Provider value={{ enabled, brand, version, ctx }}>
      <RouterProvider router={router} />
    </ShellContext.Provider>
  );
}
