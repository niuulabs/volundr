import {
  KpiStrip,
  KpiCard,
  BudgetBar,
  Sparkline,
  StateDot,
  PersonaAvatar,
  LoadingState,
  ErrorState,
} from '@niuulabs/ui';
import { useRavens } from './hooks/useRavens';
import { useTriggers } from './hooks/useTriggers';
import { useSessions } from './hooks/useSessions';
import { useFleetBudget, useRavnBudgets } from './hooks/useBudget';
import { useActivityLog } from './hooks/useActivityLog';
import { topBudgetSpenders } from './grouping';
import { formatTime } from './formatTime';
import type { ActivityLogEntry } from '../domain/activityLog';
import './OverviewPage.css';

const TOP_SPENDERS_COUNT = 5;
const FLEET_SPARKLINE_SAMPLES = 24;
const FLEET_SPARKLINE_WIDTH = 520;
const FLEET_SPARKLINE_HEIGHT = 100;

function generateHourlySpend(seed: number): number[] {
  const values: number[] = [];
  let v = 0.2 + (seed % 100) / 500;
  for (let i = 0; i < FLEET_SPARKLINE_SAMPLES; i++) {
    v = Math.max(0, Math.min(1, v + (((seed * (i + 1)) % 37) / 37 - 0.42) * 0.18));
    values.push(v);
  }
  return values;
}

// Group ravens by location and compute counts
function byLocation(ravens: { location?: string }[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of ravens) {
    const loc = r.location ?? 'unknown';
    counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function ActivityLogSection({ entries }: { entries: ActivityLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rv-log-panel" data-testid="activity-log">
        <p className="rv-log-empty">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="rv-log-panel" data-testid="activity-log">
      <table className="rv-log-table" aria-label="Recent activity">
        <thead>
          <tr className="rv-log-thead-row">
            <th className="rv-log-th">Time</th>
            <th className="rv-log-th">Kind</th>
            <th className="rv-log-th">Ravn</th>
            <th className="rv-log-th">Event</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="rv-log-row" data-testid="activity-log-row">
              <td className="rv-log-td--time">{formatTime(e.ts)}</td>
              <td className="rv-log-td--kind">
                <span className={`rv-log-kind rv-log-kind--${e.kind}`}>{e.kind}</span>
              </td>
              <td className="rv-log-td--persona">{e.ravnId}</td>
              <td className="rv-log-td--event">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverviewPage() {
  const ravens = useRavens();
  const triggers = useTriggers();
  const sessions = useSessions();
  const fleetBudget = useFleetBudget();
  const activityLog = useActivityLog();

  const ravnList = ravens.data ?? [];
  const ravnIds = ravnList.map((r) => r.id);
  const budgets = useRavnBudgets(ravnIds);

  const activeRavens = ravnList.filter((r) => r.status === 'active');
  const activeCount = activeRavens.length;
  const idleCount = ravnList.filter((r) => r.status === 'idle').length;
  const suspendedCount = ravnList.filter((r) => r.status === 'suspended').length;

  const activeTriggerCount = triggers.data?.filter((t) => t.enabled).length ?? 0;
  const pausedTriggerCount = triggers.data?.filter((t) => !t.enabled).length ?? 0;

  const openSessionCount = sessions.data?.filter((s) => s.status === 'running').length ?? 0;
  const totalMsgs = sessions.data?.reduce((sum, s) => sum + (s.messageCount ?? 0), 0) ?? 0;
  const fleetBudgetData = fleetBudget.data;
  const sparklineSeed = Math.round((fleetBudgetData?.spentUsd ?? 0) * 100);
  const hourlyValues = generateHourlySpend(sparklineSeed);

  const spenders = topBudgetSpenders(ravnList, budgets, TOP_SPENDERS_COUNT);
  const locationGroups = byLocation(ravnList);
  const maxLocCount = locationGroups[0]?.count ?? 1;

  if (ravens.isLoading || sessions.isLoading || triggers.isLoading) {
    return (
      <div data-testid="overview-loading">
        <LoadingState label="Loading fleet overview…" />
      </div>
    );
  }

  if (ravens.isError) {
    return (
      <div data-testid="overview-error">
        <ErrorState
          message={ravens.error instanceof Error ? ravens.error.message : 'Failed to load ravens'}
        />
      </div>
    );
  }

  // Compute per-ravn open session counts
  const sessionsByRavn = new Map<string, number>();
  for (const s of sessions.data ?? []) {
    if (s.status === 'running') {
      const prev = sessionsByRavn.get(s.ravnId) ?? 0;
      sessionsByRavn.set(s.ravnId, prev + 1);
    }
  }
  const totalTokens = sessions.data?.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0) ?? 0;
  const tokLabel =
    totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k tok` : `${totalTokens} tok`;

  return (
    <div data-testid="overview-page" className="rv-overview">
      {/* 4-card KPI strip */}
      <KpiStrip>
        <div data-testid="kpi-ravens" className="rv-kpi-item">
          <KpiCard label="Ravens" value={ravnList.length} />
          <p className="rv-kpi-sub">
            {activeCount} active · {idleCount} idle
            {suspendedCount > 0 && (
              <>
                {' '}
                · <span className="rv-kpi-sub--warn">{suspendedCount} suspended</span>
              </>
            )}
          </p>
        </div>
        <div data-testid="kpi-sessions" className="rv-kpi-item">
          <KpiCard label="Open sessions" value={openSessionCount} />
          <p className="rv-kpi-sub">
            {totalMsgs} msgs · {tokLabel}
          </p>
        </div>
        <div data-testid="kpi-spend" className="rv-kpi-item">
          <KpiCard
            label="Spend today"
            value={fleetBudgetData ? `$${fleetBudgetData.spentUsd.toFixed(2)}` : '—'}
          />
          {fleetBudgetData && (
            <p className="rv-kpi-sub">
              of ${fleetBudgetData.capUsd.toFixed(2)} ·{' '}
              {fleetBudgetData.capUsd > 0
                ? Math.round((fleetBudgetData.spentUsd / fleetBudgetData.capUsd) * 100)
                : 0}
              %
            </p>
          )}
        </div>
        <div data-testid="kpi-triggers" className="rv-kpi-item">
          <KpiCard label="Active triggers" value={activeTriggerCount} />
          {pausedTriggerCount > 0 && <p className="rv-kpi-sub">{pausedTriggerCount} paused</p>}
        </div>
      </KpiStrip>

      {/* 2-column body */}
      <div className="rv-overview__grid">
        {/* Left: Active ravens list + By location */}
        <div>
          <section aria-labelledby="active-ravens-heading">
            <div className="rv-section-heading-row">
              <h3 id="active-ravens-heading" className="rv-section-heading">
                Active ravens
              </h3>
              <span className="rv-section-link">open directory →</span>
            </div>
            {activeRavens.length === 0 ? (
              <p className="rv-empty-text">No active ravens</p>
            ) : (
              <ul className="rv-active-list" data-testid="active-ravens-list">
                {activeRavens.map((r) => {
                  const ravnSessions = sessionsByRavn.get(r.id) ?? 0;
                  const b = budgets[r.id];
                  return (
                    <li key={r.id} className="rv-active-row" data-testid="active-ravn-row">
                      <StateDot state="running" pulse size={8} />
                      {r.role && r.letter && (
                        <PersonaAvatar role={r.role} letter={r.letter} size={16} />
                      )}
                      <div className="rv-active-row__identity">
                        <span className="rv-active-row__name">{r.personaName}</span>
                        <span className="rv-active-row__model">{r.model}</span>
                      </div>
                      <span className="rv-active-row__role">{r.role ?? ''}</span>
                      <span className="rv-active-row__loc">@ {r.location ?? '—'}</span>
                      <span className="rv-active-row__sessions">{ravnSessions} open</span>
                      {b && (
                        <div className="rv-active-row__bar">
                          <BudgetBar
                            spent={b.spentUsd}
                            cap={b.capUsd}
                            warnAt={Math.round(b.warnAt * 100)}
                            size="sm"
                          />
                        </div>
                      )}
                      <span className="rv-active-row__time">just now</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* By location section */}
          {locationGroups.length > 0 && (
            <section aria-labelledby="location-heading" className="rv-overview__by-location">
              <h3 id="location-heading" className="rv-section-heading">
                By location
              </h3>
              <div className="rv-loc-bars" data-testid="location-bars">
                {locationGroups.map(({ name, count }) => (
                  <div key={name} className="rv-loc-row" data-testid="location-row">
                    <span className="rv-loc-name">{name}</span>
                    <div className="rv-loc-bar-track">
                      <div
                        className="rv-loc-bar-fill"
                        style={{ width: `${(count / maxLocCount) * 100}%` }}
                      />
                    </div>
                    <span className="rv-loc-count">{count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right: Fleet sparkline + top burners + activity log */}
        <section aria-labelledby="fleet-spend-heading">
          {/* Fleet sparkline */}
          <div className="rv-fleet-sparkline" data-testid="fleet-sparkline">
            <div className="rv-fleet-sparkline__header">
              <span className="rv-fleet-sparkline__label">Fleet spend · 24h</span>
              {fleetBudgetData && (
                <span className="rv-fleet-sparkline__value">
                  ${fleetBudgetData.spentUsd.toFixed(2)} total
                </span>
              )}
            </div>
            <Sparkline
              values={hourlyValues}
              width={FLEET_SPARKLINE_WIDTH}
              height={FLEET_SPARKLINE_HEIGHT}
              fill
            />
            <div className="rv-fleet-sparkline__axis">
              <span>-24h</span>
              <span>-12h</span>
              <span>now</span>
            </div>
          </div>

          {/* Top burners */}
          <div className="rv-section-heading-row">
            <h3 id="fleet-spend-heading" className="rv-section-heading">
              Top burners
            </h3>
            <span className="rv-section-link">budget page →</span>
          </div>
          <ul className="rv-spenders-list" data-testid="top-spenders-list">
            {spenders.map((r) => {
              const b = budgets[r.id];
              const pct = b && b.capUsd > 0 ? Math.round((b.spentUsd / b.capUsd) * 100) : 0;
              return (
                <li key={r.id} className="rv-spender-row" data-testid="spender-row">
                  {r.role && r.letter && (
                    <PersonaAvatar role={r.role} letter={r.letter} size={16} />
                  )}
                  <span className="rv-spender-row__name">{r.personaName}</span>
                  {b && (
                    <div className="rv-spender-row__bar">
                      <BudgetBar
                        spent={b.spentUsd}
                        cap={b.capUsd}
                        warnAt={Math.round(b.warnAt * 100)}
                        size="sm"
                      />
                    </div>
                  )}
                  <span className="rv-spender-row__pct">{pct}%</span>
                  <span className="rv-spender-row__amount">
                    {b ? `$${b.spentUsd.toFixed(2)}` : '—'}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Recent activity log tail */}
          <section aria-labelledby="activity-log-heading" className="rv-overview__activity">
            <h3 id="activity-log-heading" className="rv-section-heading">
              Recent activity
            </h3>
            <ActivityLogSection entries={activityLog.data ?? []} />
          </section>
        </section>
      </div>
    </div>
  );
}
