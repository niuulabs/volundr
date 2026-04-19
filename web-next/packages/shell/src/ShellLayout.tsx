import { useState, useCallback, useEffect, useContext, type ReactNode } from 'react';
import clsx from 'clsx';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useConfig, type PluginCtx } from '@niuulabs/plugin-sdk';
import { LiveBadge, Kbd } from '@niuulabs/ui';
import { ShellContext } from './Shell';

export function ShellLayout() {
  const { plugins, brand, version } = useContext(ShellContext);
  const config = useConfig();
  const location = useLocation();
  const navigate = useNavigate();

  const activeId = deriveActivePlugin(location.pathname, plugins);
  const active = plugins.find((p) => p.id === activeId) ?? plugins[0] ?? null;

  useEffect(() => {
    if (activeId) {
      localStorage.setItem('niuu.active', activeId);
    }
  }, [activeId]);

  const [tweaks, setTweaks] = useState<Record<string, unknown>>({});
  const setTweak = useCallback((key: string, value: unknown) => {
    setTweaks((t) => ({ ...t, [key]: value }));
  }, []);

  const ctx: PluginCtx = { tweaks, setTweak };
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
        {plugins.map((p) => (
          <button
            key={p.id}
            type="button"
            className={clsx(
              'niuu-shell__rail-item',
              active?.id === p.id && 'niuu-shell__rail-item--active',
            )}
            title={`${p.title} · ${p.subtitle}`}
            onClick={() => navigate({ to: `/${p.id}` })}
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
          <Kbd>⌘K</Kbd>
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
          <span>{plugins.length} plugins loaded</span>
        </div>
      </footer>
    </div>
  );
}

function deriveActivePlugin(pathname: string, plugins: { id: string }[]): string | null {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) {
    return plugins[0]?.id ?? null;
  }
  const match = plugins.find((p) => p.id === segment);
  return match?.id ?? null;
}
