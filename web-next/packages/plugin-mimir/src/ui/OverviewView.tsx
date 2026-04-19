/**
 * OverviewView — Mímir landing screen.
 *
 * Shows:
 *   1. KPI strip  — aggregate pages / sources / lint issues / last write
 *   2. Mount grid — one card per mount with health + metrics
 *   3. Activity feed — recent-writes tail (newest first)
 */

import { KpiStrip, KpiCard, StateDot } from '@niuulabs/ui';
import { useMimirMounts } from './useMimirMounts';
import { useMimirRecentWrites } from './useMimirSources';
import { MountChip } from './components/MountChip';
import './mimir-views.css';

const FEED_LIMIT = 12;
const TIMESTAMP_HOUR_START = 11;
const TIMESTAMP_HOUR_END = 16;

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

      {/* ── Mount grid ────────────────────────────────────────────── */}
      <div>
        <div className="mm-overview__section-head">
          <h3>Mounts</h3>
          <span className="mm-overview__section-meta">
            {mounts?.length ?? 0} instance{(mounts?.length ?? 0) !== 1 ? 's' : ''} connected
          </span>
        </div>
        <div className="mm-mount-grid">
          {mounts?.map((mount) => (
            <article key={mount.name} className="mm-mount-card" aria-label={`mount ${mount.name}`}>
              <div className="mm-mount-card__head">
                <StateDot
                  state={
                    mount.status === 'healthy'
                      ? 'healthy'
                      : mount.status === 'degraded'
                        ? 'observing'
                        : 'failed'
                  }
                />
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
      </div>

      {/* ── Activity feed ────────────────────────────────────────── */}
      {feed && feed.length > 0 && (
        <div>
          <div className="mm-overview__section-head">
            <h3>Recent writes</h3>
            <span className="mm-overview__section-meta">all mounts · newest first</span>
          </div>
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
        </div>
      )}
    </div>
  );
}
