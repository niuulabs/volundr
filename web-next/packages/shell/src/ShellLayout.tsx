import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useConfig } from '@niuulabs/plugin-sdk';
import { LiveBadge, Kbd, useCommandPalette, useCommandPaletteRegistry } from '@niuulabs/ui';
import { useShellContext } from './ShellContext';
import './Shell.css';

function activePluginId(pathname: string, ids: string[]): string | null {
  for (const id of ids) {
    if (pathname === `/${id}` || pathname.startsWith(`/${id}/`)) return id;
  }
  return null;
}

export function ShellLayout() {
  const config = useConfig();
  const { enabled, brand, version, ctx } = useShellContext();
  const router = useRouter();
  const { location } = useRouterState({ select: (s) => ({ location: s.location }) });
  const pathname = location.pathname;
  const { setOpen } = useCommandPalette();
  const { register, unregister } = useCommandPaletteRegistry();

  // System plugins (e.g. login) register routes but stay out of the nav rail.
  const navPlugins = useMemo(() => enabled.filter((p) => !p.system), [enabled]);

  const activeId = activePluginId(
    pathname,
    navPlugins.map((p) => p.id),
  );
  const active = navPlugins.find((p) => p.id === activeId) ?? navPlugins[0] ?? null;

  // localStorage follows the router — not the other way around
  useEffect(() => {
    if (activeId && typeof window !== 'undefined') {
      localStorage.setItem('niuu.active', activeId);
    }
  }, [activeId]);

  const handleSelect = useCallback(
    (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.navigate({ to: `/${id}` as any });
    },
    [router],
  );

  // Register "switch plugin" default commands for all nav plugins
  useEffect(() => {
    for (const plugin of navPlugins) {
      register({
        id: `switch:${plugin.id}`,
        title: plugin.title,
        subtitle: plugin.subtitle,
        keywords: ['switch', 'navigate', 'go', 'plugin', plugin.id],
        execute: () => handleSelect(plugin.id),
      });
    }
    return () => {
      for (const plugin of navPlugins) {
        unregister(`switch:${plugin.id}`);
      }
    };
  }, [navPlugins, register, unregister, handleSelect]);

  const subnavNode: ReactNode = active?.subnav?.(ctx) ?? null;

  return (
    <div
      className={clsx('niuu-shell', !subnavNode && 'niuu-shell--no-subnav')}
      data-theme={config.theme}
    >
      <aside className="niuu-shell__rail">
        <div className="niuu-shell__rail-brand" title="Niuu">
          {brand}
        </div>
        {navPlugins.map((p) => (
          <button
            key={p.id}
            type="button"
            className={clsx(
              'niuu-shell__rail-item',
              active?.id === p.id && 'niuu-shell__rail-item--active',
            )}
            title={`${p.title} · ${p.subtitle}`}
            onClick={() => handleSelect(p.id)}
          >
            {p.rune}
          </button>
        ))}
        <div className="niuu-shell__rail-spacer" />
        <div className="niuu-shell__rail-foot">v{version}</div>
      </aside>

      <header className="niuu-shell__topbar">
        <div className="niuu-shell__topbar-title">
          {active && (
            <>
              <h1>{active.title}</h1>
              <span className="niuu-shell__topbar-subtitle">{active.subtitle}</span>
            </>
          )}
        </div>
        <div className="niuu-shell__topbar-right">
          {active?.topbarRight?.(ctx)}
          <LiveBadge />
          <button
            type="button"
            className="niuu-shell__cp-btn"
            onClick={() => setOpen(true)}
            aria-label="Open command palette (⌘K)"
          >
            <Kbd>⌘K</Kbd>
          </button>
        </div>
      </header>

      {subnavNode && <nav className="niuu-shell__subnav">{subnavNode}</nav>}

      <main className="niuu-shell__content">
        <Outlet />
      </main>

      <footer className="niuu-shell__footer">
        <div>
          {active && <code>plugin:{active.id}</code>}
          <span className="niuu-shell__footer-sep">·</span>
          <span>niuu.world</span>
        </div>
        <div>
          <span>{enabled.length} plugins loaded</span>
        </div>
      </footer>
    </div>
  );
}
