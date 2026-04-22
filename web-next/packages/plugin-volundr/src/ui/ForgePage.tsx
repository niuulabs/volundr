import { useNavigate } from '@tanstack/react-router';
import { KpiStrip, KpiCard, StateDot, LoadingState, Sparkline } from '@niuulabs/ui';
import { useVolundrStats } from './useVolundrSessions';
import { useVolundrClusters } from './hooks/useVolundrClusters';
import { useSessionList } from './hooks/useSessionStore';
import { useTemplates } from './useTemplates';
import { MiniBar, ConnectionTypeBadge } from './atoms';
import { tokens, money } from './utils/formatters';
import type { Session } from '../domain/session';
import type { Cluster } from '../domain/cluster';
import type { ClusterKind } from '../domain/cluster';
import type { Template } from '../domain/template';

// ---------------------------------------------------------------------------
// In-flight pod row
// ---------------------------------------------------------------------------

function InflightRow({ session, onClick }: { session: Session; onClick: () => void }) {
  const isBooting = session.state === 'provisioning' || session.state === 'requested';
  const totalTokens = (session.tokensIn ?? 0) + (session.tokensOut ?? 0);
  const cpuPct =
    session.resources.cpuLimit > 0 ? session.resources.cpuUsed / session.resources.cpuLimit : 0;
  const memPct =
    session.resources.memLimitMi > 0
      ? session.resources.memUsedMi / session.resources.memLimitMi
      : 0;

  return (
    <button
      className="niuu-relative niuu-flex niuu-w-full niuu-items-start niuu-gap-3 niuu-rounded niuu-px-3 niuu-py-2 niuu-text-left hover:niuu-bg-bg-tertiary"
      onClick={onClick}
      data-testid="inflight-row"
    >
      <StateDot
        state={isBooting ? 'processing' : session.state === 'idle' ? 'idle' : 'running'}
        pulse={isBooting || session.state === 'running'}
      />
      <div className="niuu-flex-1 niuu-min-w-0">
        <div className="niuu-font-mono niuu-text-sm niuu-font-medium niuu-text-text-primary niuu-truncate">
          {session.id}
        </div>
        <div className="niuu-text-xs niuu-text-text-faint">
          {session.personaName} · {session.clusterId}
        </div>
      </div>

      {/* Preview / activity text */}
      {session.preview && !isBooting && (
        <div
          className="niuu-flex-[2] niuu-min-w-0 niuu-font-mono niuu-text-xs niuu-text-text-muted niuu-truncate"
          data-testid="inflight-preview"
          title={session.preview}
        >
          {session.preview}
        </div>
      )}
      {isBooting && (
        <div className="niuu-flex-[2] niuu-min-w-0 niuu-font-mono niuu-text-xs niuu-text-text-muted">
          {session.state === 'provisioning' ? 'provisioning…' : 'requested'}
        </div>
      )}

      {/* Inline resource bars */}
      {!isBooting && (
        <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-w-36">
          <MiniBar value={cpuPct} label="cpu" />
          <MiniBar value={memPct} label="mem" />
          {session.resources.gpuCount > 0 && <MiniBar value={0} label="gpu" />}
        </div>
      )}

      {/* Token + cost */}
      {!isBooting && (totalTokens > 0 || session.costCents !== undefined) && (
        <div className="niuu-flex niuu-items-center niuu-gap-1 niuu-font-mono niuu-text-[10px] niuu-text-text-muted niuu-whitespace-nowrap">
          {totalTokens > 0 && <span data-testid="token-stat">{tokens(totalTokens)}</span>}
          {totalTokens > 0 && session.costCents !== undefined && (
            <span className="niuu-text-text-faint">·</span>
          )}
          {session.costCents !== undefined && (
            <span data-testid="cost-stat">{money(session.costCents)}</span>
          )}
        </div>
      )}

      {/* Connection type icon */}
      {session.connectionType && <ConnectionTypeBadge connectionType={session.connectionType} />}

      {/* Boot progress bar */}
      {isBooting && (
        <div
          className="niuu-absolute niuu-bottom-0 niuu-left-0 niuu-h-0.5 niuu-w-full niuu-bg-bg-elevated"
          aria-hidden="true"
        >
          <div
            className="niuu-h-full niuu-bg-brand niuu-transition-all niuu-duration-500"
            style={{ width: `${Math.round((session.bootProgress ?? 0.1) * 100)}%` }}
            data-testid="boot-progress-bar"
          />
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cluster kind badge
// ---------------------------------------------------------------------------

const KIND_BG: Record<ClusterKind, string> = {
  primary: 'niuu-bg-brand niuu-text-bg-primary',
  gpu: 'niuu-bg-state-warn niuu-text-bg-primary',
  edge: 'niuu-bg-bg-elevated niuu-text-text-secondary',
  local: 'niuu-bg-bg-elevated niuu-text-text-secondary',
  observ: 'niuu-bg-bg-elevated niuu-text-text-secondary',
  media: 'niuu-bg-bg-elevated niuu-text-text-secondary',
};

function ClusterKindBadge({ kind }: { kind: ClusterKind }) {
  return (
    <span
      className={`niuu-inline-flex niuu-items-center niuu-rounded niuu-px-1.5 niuu-py-0.5 niuu-font-mono niuu-text-[10px] niuu-font-semibold niuu-uppercase ${KIND_BG[kind] ?? KIND_BG.edge}`}
      data-testid="cluster-kind-badge"
    >
      {kind}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cluster load row
// ---------------------------------------------------------------------------

function ClusterLoadRow({ cluster }: { cluster: Cluster }) {
  const cpuPct = cluster.capacity.cpu > 0 ? cluster.used.cpu / cluster.capacity.cpu : 0;
  const memPct = cluster.capacity.memMi > 0 ? cluster.used.memMi / cluster.capacity.memMi : 0;
  const gpuPct = cluster.capacity.gpu > 0 ? cluster.used.gpu / cluster.capacity.gpu : 0;

  return (
    <div
      className="niuu-flex niuu-flex-col niuu-gap-1 niuu-py-2"
      data-testid="cluster-load-row"
    >
      {/* Name + realm */}
      <div className="niuu-flex niuu-items-center niuu-gap-1">
        <span className="niuu-font-medium niuu-text-sm niuu-text-text-primary">
          {cluster.name}
        </span>
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">· {cluster.realm}</span>
      </div>
      {/* Kind badge + pod count */}
      <div className="niuu-flex niuu-items-center niuu-gap-2">
        <ClusterKindBadge kind={cluster.kind} />
        <span className="niuu-text-xs niuu-text-text-muted">
          {cluster.runningSessions} pod{cluster.runningSessions !== 1 ? 's' : ''}
        </span>
      </div>
      {/* Full-width resource bars */}
      <div className="niuu-flex niuu-gap-3 niuu-mt-0.5">
        <MiniBar value={cpuPct} label="cpu" />
        <MiniBar value={memPct} label="mem" />
        {cluster.capacity.gpu > 0 ? (
          <MiniBar value={gpuPct} label="gpu" />
        ) : (
          <div className="niuu-flex niuu-flex-col niuu-gap-0.5 niuu-flex-1">
            <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-faint">gpu</span>
            <div className="niuu-h-1 niuu-rounded-full niuu-bg-bg-elevated" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick launch card
// ---------------------------------------------------------------------------

function QuickLaunchCard({
  template,
  isDefault,
  onClick,
}: {
  template: Template;
  isDefault?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="niuu-relative niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-3 niuu-text-left hover:niuu-border-brand"
      onClick={onClick}
      data-testid="quick-launch-card"
    >
      {/* Tool badge row */}
      <div className="niuu-flex niuu-items-center niuu-gap-2">
        <span className="niuu-inline-flex niuu-items-center niuu-gap-1 niuu-rounded niuu-border niuu-border-border-subtle niuu-bg-bg-tertiary niuu-px-1.5 niuu-py-0.5 niuu-font-mono niuu-text-[10px] niuu-text-text-secondary">
          <span aria-hidden="true">⊡</span> Claude Code
        </span>
        {isDefault && (
          <span className="niuu-rounded niuu-bg-brand niuu-px-1.5 niuu-py-0.5 niuu-font-mono niuu-text-[10px] niuu-font-semibold niuu-text-bg-primary niuu-uppercase">
            default
          </span>
        )}
      </div>
      {/* Template name */}
      <div className="niuu-font-mono niuu-text-sm niuu-font-medium niuu-text-text-primary">
        {template.name}
      </div>
      {/* Description */}
      {template.description && (
        <div className="niuu-text-xs niuu-text-text-muted niuu-line-clamp-2">
          {template.description}
        </div>
      )}
      {/* Spec line */}
      <div className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
        {template.spec.resources.cpuRequest}c · {template.spec.resources.memRequestMi}Mi
        {template.usageCount !== undefined && (
          <span data-testid="usage-count"> {template.usageCount}×</span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// GPU heatmap — colored blocks showing GPU utilization
// ---------------------------------------------------------------------------

function GpuHeatmap({ used, total }: { used: number; total: number }) {
  const blocks = Array.from({ length: total }, (_, i) => i < used);
  return (
    <div className="niuu-flex niuu-items-center niuu-gap-0.5" data-testid="gpu-heatmap">
      {blocks.map((active, i) => (
        <div
          key={i}
          className={`niuu-h-3 niuu-w-2.5 niuu-rounded-sm ${active ? 'niuu-bg-brand' : 'niuu-bg-bg-elevated'}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ForgePage
// ---------------------------------------------------------------------------

/** Forge overview — the primary landing page for Volundr. */
export function ForgePage() {
  const navigate = useNavigate();

  const stats = useVolundrStats();
  const clusters = useVolundrClusters();
  const domainSessions = useSessionList();
  const templates = useTemplates();

  // Derive categorized sessions
  const allSessions = domainSessions.data ?? [];
  const activeSessions = allSessions.filter((s) => s.state === 'running' || s.state === 'idle');
  const bootingSessions = allSessions.filter(
    (s) => s.state === 'provisioning' || s.state === 'requested',
  );
  const erroredSessions = allSessions.filter((s) => s.state === 'failed');
  const inflightSessions = [...bootingSessions, ...activeSessions].slice(0, 6);

  // Cluster aggregates
  const totalGpuCap = clusters.data?.reduce((s, c) => s + c.capacity.gpu, 0) ?? 0;
  const totalGpuUsed = clusters.data?.reduce((s, c) => s + c.used.gpu, 0) ?? 0;

  // Sparkline data from stats
  const sparklines = stats.data?.sparklines;

  function handleOpenSession(sessionId: string) {
    void navigate({ to: '/volundr/session/$sessionId', params: { sessionId } });
  }

  const isLoading = domainSessions.isLoading || clusters.isLoading;

  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-6 niuu-p-6" data-testid="forge-page">
      {/* Metric strip */}
      <section aria-label="Forge metrics">
        {isLoading ? (
          <LoadingState label="Loading metrics…" />
        ) : (
          <KpiStrip>
            <KpiCard
              label="active pods"
              value={activeSessions.length}
              delta={`${bootingSessions.length} booting · ${erroredSessions.length} error`}
              deltaTrend="neutral"
              sparkline={
                sparklines?.activePods ? (
                  <Sparkline
                    values={sparklines.activePods}
                    width={200}
                    height={40}
                    fill
                  />
                ) : undefined
              }
            />
            <KpiCard
              label="tokens today"
              value={stats.data ? tokens(stats.data.tokensToday) : '—'}
              delta={
                stats.data
                  ? `${tokens(Math.round(stats.data.tokensToday / 24))}/s · 5m avg`
                  : 'burn rate'
              }
              deltaTrend="neutral"
            />
            <KpiCard
              label="cost today"
              value={stats.data ? `$${stats.data.costToday.toFixed(2)}` : '—'}
              delta={
                stats.data
                  ? `$${Math.round(stats.data.costToday * 1.25)} projected 24h`
                  : 'projected 24h'
              }
              deltaTrend="neutral"
            />
            <KpiCard
              label="GPUs"
              value={`${totalGpuUsed}/${totalGpuCap}`}
              delta={`across ${clusters.data?.length ?? 0} clusters`}
              deltaTrend="neutral"
              sparkline={<GpuHeatmap used={totalGpuUsed} total={totalGpuCap} />}
            />
          </KpiStrip>
        )}
      </section>

      {/* Body grid — 2-column: left (inflight + quick launch), right (forge load) */}
      <div className="niuu-grid niuu-grid-cols-[3fr_2fr] niuu-gap-6">
        {/* Left column */}
        <div className="niuu-flex niuu-flex-col niuu-gap-6">
          {/* In-flight pods */}
          <section
            className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
            aria-label="In-flight pods"
            data-testid="inflight-panel"
          >
            <div className="niuu-flex niuu-items-center niuu-justify-between">
              <div className="niuu-flex niuu-items-baseline niuu-gap-2">
                <h2 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">
                  In-flight pods
                </h2>
                <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
                  {inflightSessions.length}
                </span>
              </div>
              <button
                className="niuu-text-xs niuu-text-text-muted hover:niuu-text-text-primary"
                onClick={() => void navigate({ to: '/volundr/sessions' })}
                data-testid="all-sessions-link"
              >
                all sessions ›
              </button>
            </div>
            {inflightSessions.length === 0 && (
              <p className="niuu-text-xs niuu-text-text-muted">No active pods.</p>
            )}
            {inflightSessions.map((s) => (
              <InflightRow key={s.id} session={s} onClick={() => handleOpenSession(s.id)} />
            ))}
          </section>

          {/* Quick launch */}
          <section
            className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
            aria-label="Quick launch"
            data-testid="quick-launch-panel"
          >
            <div className="niuu-flex niuu-items-baseline niuu-gap-2">
              <h2 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">Quick launch</h2>
              <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
                from a template
              </span>
            </div>
            <div className="niuu-grid niuu-grid-cols-2 niuu-gap-2">
              {templates.data?.slice(0, 4).map((t, i) => (
                <QuickLaunchCard
                  key={t.id}
                  template={t}
                  isDefault={i === 0}
                  onClick={() => void navigate({ to: '/volundr/templates' })}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Right column — Forge load */}
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
          aria-label="Forge load"
          data-testid="forge-load-panel"
        >
          <div className="niuu-flex niuu-items-center niuu-justify-between">
            <div className="niuu-flex niuu-items-baseline niuu-gap-2">
              <h2 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">Forge load</h2>
              <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
                {clusters.data?.length ?? 0} clusters
              </span>
            </div>
            <button
              className="niuu-text-xs niuu-text-text-muted hover:niuu-text-text-primary"
              onClick={() => void navigate({ to: '/volundr/clusters' })}
              data-testid="cluster-details-link"
            >
              details ›
            </button>
          </div>
          {clusters.isLoading && <LoadingState label="Loading clusters…" />}
          {clusters.data?.map((c) => (
            <ClusterLoadRow key={c.id} cluster={c} />
          ))}
        </section>
      </div>

      {/* Error strip */}
      {erroredSessions.length > 0 && (
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-critical-bo niuu-bg-bg-secondary niuu-p-4"
          aria-label="Needs attention"
          data-testid="error-strip"
        >
          <h2 className="niuu-text-sm niuu-font-medium niuu-text-critical">Needs attention</h2>
          {erroredSessions.map((s) => (
            <div key={s.id} className="niuu-flex niuu-items-center niuu-gap-3">
              <StateDot state="failed" />
              <div className="niuu-flex-1">
                <div className="niuu-font-mono niuu-text-sm niuu-text-text-primary">{s.id}</div>
                <div className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
                  {s.events[s.events.length - 1]?.body ?? 'unknown error'}
                </div>
              </div>
              <button className="niuu-py-1 niuu-px-3 niuu-bg-brand niuu-text-bg-primary niuu-border niuu-border-brand niuu-rounded-sm niuu-cursor-pointer niuu-font-mono niuu-text-xs">
                retry
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
