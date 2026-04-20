import { useNavigate } from '@tanstack/react-router';
import { KpiStrip, KpiCard, StateDot, LoadingState, Meter, relTime, Sparkline } from '@niuulabs/ui';
import { useVolundrStats } from './useVolundrSessions';
import { useVolundrClusters } from './hooks/useVolundrClusters';
import { useSessionList } from './hooks/useSessionStore';
import { useTemplates } from './useTemplates';
import { MiniBar, ConnectionTypeBadge } from './atoms';
import { tokens, money } from './utils/formatters';
import type { Session } from '../domain/session';
import type { Cluster } from '../domain/cluster';
import type { Template } from '../domain/template';

// ---------------------------------------------------------------------------
// In-flight pod row
// ---------------------------------------------------------------------------

function InflightRow({ session, onClick }: { session: Session; onClick: () => void }) {
  const isBooting = session.state === 'provisioning' || session.state === 'requested';

  if (isBooting) {
    const progress = session.bootProgress ?? 0.1;
    return (
      <button
        className="niuu-relative niuu-flex niuu-w-full niuu-flex-col niuu-overflow-hidden niuu-rounded niuu-px-3 niuu-py-2 niuu-text-left hover:niuu-bg-bg-tertiary"
        onClick={onClick}
        data-testid="inflight-row"
      >
        <div className="niuu-flex niuu-w-full niuu-items-center niuu-gap-3">
          <StateDot state="processing" pulse />
          <div className="niuu-flex-1">
            <div className="niuu-font-mono niuu-text-sm niuu-text-text-primary">{session.id}</div>
            <div className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
              {session.personaName}
            </div>
          </div>
          {session.connectionType && (
            <ConnectionTypeBadge connectionType={session.connectionType} />
          )}
        </div>
        {/* Boot progress bar */}
        <div
          className="niuu-absolute niuu-bottom-0 niuu-left-0 niuu-h-0.5 niuu-w-full niuu-bg-bg-elevated"
          aria-hidden="true"
        >
          <div
            className="niuu-h-full niuu-bg-brand niuu-transition-all niuu-duration-500"
            style={{ width: `${Math.round(progress * 100)}%` }}
            data-testid="boot-progress-bar"
          />
        </div>
      </button>
    );
  }

  const totalTokens = (session.tokensIn ?? 0) + (session.tokensOut ?? 0);

  return (
    <button
      className="niuu-flex niuu-w-full niuu-items-start niuu-gap-3 niuu-rounded niuu-px-3 niuu-py-2 niuu-text-left hover:niuu-bg-bg-tertiary"
      onClick={onClick}
      data-testid="inflight-row"
    >
      <StateDot
        state={session.state === 'idle' ? 'idle' : 'running'}
        pulse={session.state === 'running'}
      />
      <div className="niuu-flex-1 niuu-min-w-0">
        <div className="niuu-font-mono niuu-text-sm niuu-text-text-primary niuu-truncate">
          {session.id}
        </div>
        <div className="niuu-text-xs niuu-text-text-faint">
          {session.personaName} · {session.clusterId}
        </div>
        {(totalTokens > 0 || session.costCents !== undefined) && (
          <div className="niuu-flex niuu-items-center niuu-gap-1 niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
            {totalTokens > 0 && <span data-testid="token-stat">{tokens(totalTokens)}</span>}
            {totalTokens > 0 && session.costCents !== undefined && (
              <span className="niuu-text-text-faint">·</span>
            )}
            {session.costCents !== undefined && (
              <span data-testid="cost-stat">{money(session.costCents)}</span>
            )}
          </div>
        )}
      </div>
      <div className="niuu-flex niuu-flex-col niuu-items-end niuu-gap-1.5">
        {session.connectionType && (
          <ConnectionTypeBadge connectionType={session.connectionType} />
        )}
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <Meter
            used={session.resources.cpuUsed}
            limit={session.resources.cpuLimit}
            label="cpu"
            className="niuu-w-16"
          />
          <Meter
            used={session.resources.memUsedMi}
            limit={session.resources.memLimitMi}
            label="mem"
            className="niuu-w-16"
          />
        </div>
      </div>
    </button>
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
      className="niuu-flex niuu-items-center niuu-gap-3 niuu-py-2"
      data-testid="cluster-load-row"
    >
      <div className="niuu-flex-1 niuu-min-w-0">
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <span className="niuu-font-medium niuu-text-sm niuu-text-text-primary">
            {cluster.name}
          </span>
          <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
            · {cluster.realm}
          </span>
        </div>
        <div className="niuu-text-xs niuu-text-text-muted">
          {cluster.runningSessions} pod{cluster.runningSessions !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="niuu-flex niuu-gap-2 niuu-w-48">
        <MiniBar value={cpuPct} label="cpu" />
        <MiniBar value={memPct} label="mem" />
        {cluster.capacity.gpu > 0 ? (
          <MiniBar value={gpuPct} label="gpu" />
        ) : (
          <div className="niuu-flex niuu-flex-col niuu-gap-0.5 niuu-flex-1">
            <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-faint">gpu</span>
            <div className="niuu-h-1 niuu-rounded-full niuu-bg-bg-elevated">
              <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-faint">—</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick launch card
// ---------------------------------------------------------------------------

function QuickLaunchCard({ template, onClick }: { template: Template; onClick: () => void }) {
  return (
    <button
      className="niuu-relative niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-3 niuu-text-left hover:niuu-border-brand"
      onClick={onClick}
      data-testid="quick-launch-card"
    >
      <div className="niuu-flex niuu-items-center niuu-gap-2">
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-secondary">
          {template.name}
        </span>
      </div>
      <div className="niuu-text-xs niuu-text-text-muted niuu-line-clamp-2">
        {template.spec.image}:{template.spec.tag}
      </div>
      <div className="niuu-flex niuu-items-end niuu-justify-between niuu-gap-2">
        <div className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
          {template.spec.resources.cpuRequest}c · {template.spec.resources.memRequestMi}Mi
          {template.spec.resources.gpuCount > 0 && ` · gpu ${template.spec.resources.gpuCount}`}
        </div>
        {template.usageCount !== undefined && (
          <span
            className="niuu-font-mono niuu-text-[10px] niuu-text-text-faint"
            data-testid="usage-count"
          >
            {template.usageCount}×
          </span>
        )}
      </div>
    </button>
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

  // Recent sessions sorted by last activity
  const recentSessions = [...allSessions]
    .filter((s) => s.lastActivityAt)
    .sort(
      (a, b) =>
        new Date(b.lastActivityAt ?? 0).getTime() - new Date(a.lastActivityAt ?? 0).getTime(),
    )
    .slice(0, 8);

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
                    width={48}
                    height={16}
                    fill={false}
                    className="niuu-opacity-50"
                  />
                ) : undefined
              }
            />
            <KpiCard
              label="tokens today"
              value={stats.data ? tokens(stats.data.tokensToday) : '—'}
              delta="burn rate"
              deltaTrend="neutral"
              sparkline={
                sparklines?.tokensToday ? (
                  <Sparkline
                    values={sparklines.tokensToday}
                    width={48}
                    height={16}
                    fill={false}
                    className="niuu-opacity-50"
                  />
                ) : undefined
              }
            />
            <KpiCard
              label="cost today"
              value={stats.data ? `$${stats.data.costToday.toFixed(2)}` : '—'}
              delta="projected 24h"
              deltaTrend="neutral"
              sparkline={
                sparklines?.costToday ? (
                  <Sparkline
                    values={sparklines.costToday}
                    width={48}
                    height={16}
                    fill={false}
                    className="niuu-opacity-50"
                  />
                ) : undefined
              }
            />
            <KpiCard
              label="GPUs"
              value={`${totalGpuUsed}/${totalGpuCap}`}
              delta={`across ${clusters.data?.length ?? 0} clusters`}
              deltaTrend="neutral"
              sparkline={
                sparklines?.gpus ? (
                  <Sparkline
                    values={sparklines.gpus}
                    width={48}
                    height={16}
                    fill={false}
                    className="niuu-opacity-50"
                  />
                ) : undefined
              }
            />
          </KpiStrip>
        )}
      </section>

      {/* Body grid */}
      <div className="niuu-grid niuu-grid-cols-3 niuu-gap-6">
        {/* In-flight pods */}
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
          aria-label="In-flight pods"
          data-testid="inflight-panel"
        >
          <div className="niuu-flex niuu-items-center niuu-justify-between">
            <h2 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">In-flight pods</h2>
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
              {inflightSessions.length}
            </span>
          </div>
          {inflightSessions.length === 0 && (
            <p className="niuu-text-xs niuu-text-text-muted">No active pods.</p>
          )}
          {inflightSessions.map((s) => (
            <InflightRow key={s.id} session={s} onClick={() => handleOpenSession(s.id)} />
          ))}
        </section>

        {/* Forge load */}
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
          aria-label="Forge load"
          data-testid="forge-load-panel"
        >
          <div className="niuu-flex niuu-items-center niuu-justify-between">
            <h2 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">Forge load</h2>
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
              {clusters.data?.length ?? 0} clusters
            </span>
          </div>
          {clusters.isLoading && <LoadingState label="Loading clusters…" />}
          {clusters.data?.map((c) => (
            <ClusterLoadRow key={c.id} cluster={c} />
          ))}
        </section>

        {/* Quick launch */}
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
          aria-label="Quick launch"
          data-testid="quick-launch-panel"
        >
          <div className="niuu-flex niuu-items-center niuu-justify-between">
            <h2 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">Quick launch</h2>
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">
              from a template
            </span>
          </div>
          <div className="niuu-grid niuu-grid-cols-2 niuu-gap-2">
            {templates.data?.slice(0, 4).map((t) => (
              <QuickLaunchCard
                key={t.id}
                template={t}
                onClick={() => void navigate({ to: '/volundr/templates' })}
              />
            ))}
          </div>
        </section>
      </div>

      {/* Chronicle tail */}
      {recentSessions.length > 0 && (
        <section
          className="niuu-flex niuu-flex-col niuu-gap-2 niuu-rounded-lg niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-4"
          aria-label="Recent across fleet"
          data-testid="chronicle-tail"
        >
          <h2 className="niuu-text-sm niuu-font-medium niuu-text-text-primary">
            Recent across fleet
          </h2>
          <ol className="niuu-flex niuu-flex-col niuu-gap-1">
            {recentSessions.map((s) => (
              <li key={s.id} className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-xs">
                <span className="niuu-font-mono niuu-text-text-faint niuu-w-12 niuu-text-right">
                  {relTime(new Date(s.lastActivityAt ?? s.startedAt).getTime())}
                </span>
                <StateDot
                  state={
                    s.state === 'idle'
                      ? 'idle'
                      : s.state === 'running'
                        ? 'running'
                        : s.state === 'failed'
                          ? 'failed'
                          : 'unknown'
                  }
                />
                <span className="niuu-font-mono niuu-text-text-primary">{s.id}</span>
                <span className="niuu-text-text-faint">·</span>
                <span className="niuu-text-text-muted niuu-truncate">{s.personaName}</span>
                {s.preview && (
                  <>
                    <span className="niuu-text-text-faint">·</span>
                    <span
                      className="niuu-text-text-faint niuu-truncate niuu-max-w-[20rem]"
                      data-testid="chronicle-preview"
                      title={s.preview}
                    >
                      {s.preview.length > 80 ? `${s.preview.slice(0, 80)}…` : s.preview}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

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
              <button className="niuu-rounded niuu-bg-brand niuu-px-3 niuu-py-1 niuu-text-xs niuu-font-medium niuu-text-bg-primary">
                retry
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
