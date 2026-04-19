import { StateDot, Chip, RavnAvatar } from '@niuulabs/ui';
import { useRavns } from '../application/useRavns';
import type { RavnState } from '../domain/ravn-binding';
import type { DotState } from '@niuulabs/ui';
import './RavnsPage.css';

const STATE_DOT: Record<RavnState, DotState> = {
  active: 'healthy',
  idle: 'idle',
  offline: 'failed',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function RavnsPage() {
  const { data, isLoading, isError, error } = useRavns();

  return (
    <div className="ravns-page">
      <h2 className="ravns-page__title">Ravns</h2>
      <p className="ravns-page__subtitle">Per-ravn mount bindings and last dream-cycle summary.</p>

      {isLoading && (
        <div className="ravns-page__status">
          <StateDot state="processing" pulse />
          <span>loading ravns…</span>
        </div>
      )}

      {isError && (
        <div className="ravns-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'ravns load failed'}</span>
        </div>
      )}

      {!isLoading && !isError && data?.length === 0 && (
        <p className="ravns-page__empty">No ravn bindings found.</p>
      )}

      {data && data.length > 0 && (
        <ul className="ravns-page__list">
          {data.map((ravn) => (
            <li key={ravn.ravnId} className="ravns-page__item" data-testid="ravn-item">
              <div className="ravns-page__item-header">
                <RavnAvatar
                  role={ravn.role}
                  rune={ravn.ravnRune}
                  state={STATE_DOT[ravn.state]}
                  pulse={ravn.state === 'active'}
                  size={36}
                />
                <div className="ravns-page__item-identity">
                  <span className="ravns-page__item-id">{ravn.ravnId}</span>
                  <span className="ravns-page__item-role">
                    <Chip tone="muted">{ravn.role}</Chip>
                  </span>
                </div>
                <span
                  className={[
                    'ravns-page__item-state',
                    `ravns-page__item-state--${ravn.state}`,
                  ].join(' ')}
                  data-testid="ravn-state"
                >
                  {ravn.state}
                </span>
              </div>

              <div className="ravns-page__mounts">
                <span className="ravns-page__mounts-label">Mounts</span>
                <div className="ravns-page__mounts-list">
                  {ravn.mountNames.map((m) => (
                    <Chip key={m} tone={m === ravn.writeMount ? 'brand' : 'muted'}>
                      {m === ravn.writeMount ? `✎ ${m}` : m}
                    </Chip>
                  ))}
                </div>
              </div>

              {ravn.lastDream ? (
                <div className="ravns-page__dream" data-testid="ravn-dream">
                  <span className="ravns-page__dream-label">Last dream</span>
                  <span className="ravns-page__dream-time">
                    {formatTimestamp(ravn.lastDream.timestamp)}
                  </span>
                  <div className="ravns-page__dream-stats">
                    <span className="ravns-page__dream-stat">
                      <strong>{ravn.lastDream.pagesUpdated}</strong> pages updated
                    </span>
                    <span className="ravns-page__dream-stat">
                      <strong>{ravn.lastDream.entitiesCreated}</strong> entities created
                    </span>
                    <span className="ravns-page__dream-stat">
                      <strong>{ravn.lastDream.lintFixes}</strong> lint fixes
                    </span>
                    <span className="ravns-page__dream-stat ravns-page__dream-stat--duration">
                      {formatDuration(ravn.lastDream.durationMs)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="ravns-page__dream ravns-page__dream--none" data-testid="ravn-no-dream">
                  <span className="ravns-page__dream-label">Last dream</span>
                  <span className="ravns-page__dream-none-text">no dream cycles yet</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
