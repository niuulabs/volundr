/**
 * OverviewView — Mímir landing screen.
 *
 * Layout (matches web2 home.jsx prototype):
 *   KPI strip — aggregate pages / sources / wardens / lint / last write
 *   mm-home-cols (1.2fr 1fr, border-right separator):
 *     LEFT:  mount cards grid (minmax 300px) + wardens ravn cards
 *     RIGHT: activity feed (time / kind / mount / message)
 */

import { KpiStrip, KpiCard, StateDot, RavnAvatar } from '@niuulabs/ui';
import { useMimirMounts } from './useMimirMounts';
import { useMimirRecentWrites } from './useMimirSources';
import { useRavns } from '../application/useRavns';
import { MountChip } from './components/MountChip';
import type { DotState } from '@niuulabs/ui';
import type { RavnState } from '../domain/ravn-binding';
import type { MountStatus } from '@niuulabs/domain';
import './mimir-views.css';

const FEED_LIMIT = 20;
const TIMESTAMP_HOUR_START = 11;
const TIMESTAMP_HOUR_END = 16;

const RAVN_DOT_STATE: Record<RavnState, DotState> = {
  active: 'healthy',
  idle: 'idle',
  offline: 'failed',
};

const MOUNT_DOT_STATE: Record<MountStatus, DotState> = {
  healthy: 'healthy',
  degraded: 'observing',
  down: 'failed',
};

function formatTimestamp(iso: string): string {
  return iso.slice(TIMESTAMP_HOUR_START, TIMESTAMP_HOUR_END);
}

function formatLastWrite(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffH = Math.round((now.getTime() - d.getTime()) / 3_600_000);
  if (diffH < 1) return '< 1h ago';
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

export function OverviewView() {
  const { data: mounts, isLoading: mountsLoading, error: mountsError } = useMimirMounts();
  const { data: feed } = useMimirRecentWrites(FEED_LIMIT);
  const { data: ravns = [] } = useRavns();

  const totalPages = mounts?.reduce((a, m) => a + m.pages, 0) ?? 0;
  const totalSources = mounts?.reduce((a, m) => a + m.sources, 0) ?? 0;
  const totalLint = mounts?.reduce((a, m) => a + m.lintIssues, 0) ?? 0;
  const lastWrite = mounts
    ? mounts.reduce((latest, m) => (m.lastWrite > latest ? m.lastWrite : latest), '')
    : '';

  if (mountsLoading) {
    return (
      <div className="mm-overview">
        <div className="mm-status-row">
          <StateDot state="processing" pulse />
          <span className="mm-status-text">loading…</span>
        </div>
      </div>
    );
  }

  if (mountsError) {
    return (
      <div className="mm-overview">
        <div className="mm-error-banner">
          {mountsError instanceof Error ? mountsError.message : String(mountsError)}
        </div>
      </div>
    );
  }

  return (
    <div className="mm-overview">
      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <KpiStrip>
        <KpiCard label="pages" value={totalPages.toLocaleString()} />
        <KpiCard label="sources" value={totalSources.toLocaleString()} deltaLabel="raw ingested" />
        <KpiCard label="wardens" value={ravns.length} deltaLabel="ravns bound to mounts" />
        <KpiCard
          label="lint issues"
          value={totalLint}
          deltaTrend={totalLint > 0 ? 'up' : 'neutral'}
          delta={totalLint > 0 ? `${totalLint} open` : 'clean'}
        />
        <KpiCard
          label="last write"
          value={lastWrite ? formatLastWrite(lastWrite) : '—'}
          deltaLabel="newest across mounts"
        />
      </KpiStrip>

      {/* ── 2-column home layout ──────────────────────────────────── */}
      <div className="mm-home-cols">
        {/* LEFT column: mount grid + wardens */}
        <div className="mm-home-col mm-home-col--left">
          <div className="mm-overview__section-head">
            <h3>Mounts</h3>
            <span className="mm-overview__section-meta">
              {mounts?.length ?? 0} instance{(mounts?.length ?? 0) !== 1 ? 's' : ''} connected ·
              click to focus
            </span>
          </div>
          <div className="mm-mount-grid">
            {mounts?.map((mount) => (
              <article key={mount.name} className="mm-mount-card" aria-label={`mount ${mount.name}`}>
                <div className="mm-mount-card__head">
                  <StateDot state={MOUNT_DOT_STATE[mount.status]} />
                  <span className="mm-mount-card__name">{mount.name}</span>
                  <MountChip name={mount.name} role={mount.role} />
                </div>
                <div className="mm-mount-card__host">{mount.host}</div>
                <div className="mm-mount-card__desc">{mount.desc}</div>
                <div className="mm-mount-card__metrics">
                  <span className="mm-metric">
                    <strong>{mount.pages}</strong> pages
                  </span>
                  <span className="mm-metric">
                    <strong>{mount.sources}</strong> sources
                  </span>
                  <span className={`mm-metric${mount.lintIssues > 10 ? ' mm-metric--warn' : ''}`}>
                    <strong>{mount.lintIssues}</strong> lint
                  </span>
                  <span className="mm-metric">
                    <strong>{(mount.sizeKb / 1024).toFixed(1)}</strong> MB
                  </span>
                </div>
                {mount.categories && (
                  <div className="mm-mount-card__categories">
                    scope:{' '}
                    <span className="mm-mount-card__categories-val">
                      {mount.categories.join(', ')}
                    </span>
                  </div>
                )}
              </article>
            ))}
          </div>

          {/* Wardens section */}
          {ravns.length > 0 && (
            <>
              <div className="mm-overview__section-head" style={{ marginTop: 'var(--space-6)' }}>
                <h3>Wardens</h3>
                <span className="mm-overview__section-meta">
                  ravns bound here · read / write fan-out
                </span>
              </div>
              <div className="mm-ravn-grid">
                {ravns.map((ravn) => (
                  <div key={ravn.ravnId} className="mm-ravn-card">
                    <div className="mm-ravn-card__head">
                      <RavnAvatar
                        role={ravn.role}
                        rune={ravn.ravnRune}
                        state={RAVN_DOT_STATE[ravn.state]}
                        size={32}
                      />
                      <div className="mm-ravn-card__identity">
                        <div className="mm-ravn-card__name-row">
                          <span className="mm-ravn-card__name">{ravn.ravnId}</span>
                          <StateDot state={RAVN_DOT_STATE[ravn.state]} size={6} />
                        </div>
                        <div className="mm-ravn-card__role">{ravn.role}</div>
                      </div>
                    </div>
                    <div className="mm-ravn-card__mounts">
                      {ravn.mountNames.map((m) => (
                        <span
                          key={m}
                          className={`mm-ravn-card__bind-chip${m === ravn.writeMount ? ' mm-ravn-card__bind-chip--write' : ''}`}
                        >
                          {m}
                          {m === ravn.writeMount && (
                            <span className="mm-ravn-card__bind-mode">write</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* RIGHT column: activity feed */}
        <div className="mm-home-col mm-home-col--right">
          <div className="mm-overview__section-head">
            <h3>Activity</h3>
            <span className="mm-overview__section-meta">all mounts · newest first</span>
          </div>
          {feed && feed.length > 0 ? (
            <div className="mm-feed" aria-label="recent writes feed" role="log">
              {feed.map((entry) => (
                <div key={entry.id} className="mm-feed-row">
                  <span className="mm-feed__time">{formatTimestamp(entry.timestamp)}</span>
                  <span className={`mm-feed__kind mm-feed__kind--${entry.kind}`}>{entry.kind}</span>
                  <span>
                    <MountChip name={entry.mount} />
                  </span>
                  <span className="mm-feed__msg">
                    <span className="mm-feed__ravn">{entry.ravn}</span>
                    <span className="mm-feed__sep">{' · '}</span>
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mm-overview__empty">No recent activity.</p>
          )}
        </div>
      </div>
    </div>
  );
}
