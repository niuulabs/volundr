import { Rune, StateDot, Chip } from '@niuulabs/ui';
import { useMimirMounts } from './useMimirMounts';
import './MimirPage.css';

export function MimirPage() {
  const { data, isLoading, isError, error } = useMimirMounts();

  return (
    <div className="mimir-page">
      <div className="mimir-page__header">
        <Rune glyph="ᛗ" size={32} />
        <h2>Mímir · the well of knowledge</h2>
      </div>
      <p className="mimir-page__subtitle">
        Knowledge-base management: mounts, pages, sources, entities, lint, and dream cycles.
      </p>

      {isLoading && (
        <div className="mimir-page__status">
          <StateDot state="processing" pulse />
          <span>loading mounts…</span>
        </div>
      )}

      {isError && (
        <div className="mimir-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <div>
          <p className="mimir-page__count">
            <strong>{data.length}</strong> mount{data.length !== 1 ? 's' : ''} connected
          </p>
          <ul className="mimir-page__list">
            {data.map((mount) => (
              <li key={mount.name} className="mimir-page__item">
                <StateDot
                  state={
                    mount.status === 'healthy'
                      ? 'healthy'
                      : mount.status === 'degraded'
                        ? 'observing'
                        : 'failed'
                  }
                />
                <span className="mimir-page__item-name">{mount.name}</span>
                <Chip tone="muted">{mount.role}</Chip>
                <span className="mimir-page__item-pages">{mount.pages} pages</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
