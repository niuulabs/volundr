import { useMemo, useState, useCallback, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  useConfig,
  useFeatureCatalog,
  type PluginDescriptor,
  type PluginCtx,
} from '@niuulabs/plugin-sdk';
import { LiveBadge, Kbd } from '@niuulabs/ui';
import './Shell.css';

interface ShellProps {
  plugins: PluginDescriptor[];
  brand?: string;
  version?: string;
}

export function Shell({ plugins, brand = 'ᚾ', version = '0.0.1' }: ShellProps) {
  const config = useConfig();
  const features = useFeatureCatalog();

  const enabled = useMemo(
    () =>
      plugins
        .filter((p) => features.isEnabled(p.id))
        .sort((a, b) => features.order(a.id) - features.order(b.id)),
    [plugins, features],
  );

  const [activeId, setActiveId] = useState<string | null>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('niuu.active') : null;
    if (stored && enabled.some((p) => p.id === stored)) return stored;
    return enabled[0]?.id ?? null;
  });

  const active = enabled.find((p) => p.id === activeId) ?? enabled[0] ?? null;

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    if (typeof window !== 'undefined') localStorage.setItem('niuu.active', id);
  }, []);

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
        {enabled.map((p) => (
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
          <Kbd>⌘K</Kbd>
        </div>
      </header>

      {subnavNode && <nav className="niuu-shell__subnav">{subnavNode}</nav>}

      <main className="niuu-shell__content">
        {active?.render ? (
          active.render(ctx)
        ) : (
          <div style={{ padding: 'var(--space-6)' }}>
            <p>No plugin selected.</p>
          </div>
        )}
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
