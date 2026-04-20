import {
  KpiStrip,
  KpiCard,
  BudgetBar,
  Sparkline,
  StateDot,
  LoadingState,
  ErrorState,
} from '@niuulabs/ui';
import { useRavens } from './hooks/useRavens';
import { useTriggers } from './hooks/useTriggers';
import { useSessions } from './hooks/useSessions';
import { useFleetBudget, useRavnBudgets } from './hooks/useBudget';
import { topBudgetSpenders } from './grouping';
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

export function OverviewPage() {
  const ravens = useRavens();
  const triggers = useTriggers();
  const sessions = useSessions();
  const fleetBudget = useFleetBudget();

  const ravnList = ravens.data ?? [];
  const ravnIds = ravnList.map((r) => r.id);
  const budgets = useRavnBudgets(ravnIds);

  const activeCount = ravnList.filter((r) => r.status === 'active').length;
  const idleCount = ravnList.filter((r) => r.status === 'idle').length;
  const failedCount = ravnList.filter((r) => r.status === 'failed').length;
  const suspendedCount = ravnList.filter((r) => r.status === 'suspended').length;

  const activeTriggerCount = triggers.data?.filter((t) => t.enabled).length ?? 0;
  const pausedTriggerCount = triggers.data?.filter((t) => !t.enabled).length ?? 0;

  const openSessionCount = sessions.data?.filter((s) => s.status === 'running').length ?? 0;
  const totalMsgs = sessions.data?.reduce((sum, s) => sum + (s.messageCount ?? 0), 0) ?? 0;
  const totalCost = sessions.data?.reduce((sum, s) => sum + (s.costUsd ?? 0), 0) ?? 0;

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

  return (
    <div data-testid="overview-page" className="rv-overview">
      {/* 4-card KPI strip */}
      <KpiStrip>
        <div data-testid="kpi-ravens" className="rv-kpi-item">
          <KpiCard label="Ravens" value={ravnList.length} />
          <p className="rv-kpi-sub">
            {activeCount} active · {idleCount} idle · {failedCount} failed · {suspendedCount} suspended
          </p>
        </div>
        <div data-testid="kpi-sessions" className="rv-kpi-item">
          <KpiCard label="Open sessions" value={openSessionCount} />
          <p className="rv-kpi-sub">
            {totalMsgs} msgs · ${totalCost.toFixed(2)}
          </p>
        </div>
        <div data-testid="kpi-spend" className="rv-kpi-item">
          <KpiCard label="Spend today" value={fleetBudgetData ? `$${fleetBudgetData.spentUsd.toFixed(2)}` : '—'} />
          {fleetBudgetData && (
            <p className="rv-kpi-sub">
              of ${fleetBudgetData.capUsd.toFixed(2)} · {Math.round((fleetBudgetData.spentUsd / fleetBudgetData.capUsd) * 100)}%
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
            <h3 id="active-ravens-heading" className="rv-section-heading">
              Active ravens
            </h3>
            {ravnList.filter((r) => r.status === 'active').length === 0 ? (
              <p className="rv-empty-text">No active ravens</p>
            ) : (
              <ul className="rv-active-list" data-testid="active-ravens-list">
                {ravnList
                  .filter((r) => r.status === 'active')
                  .map((r) => (
                    <li key={r.id} className="rv-active-row" data-testid="active-ravn-row">
                      <StateDot state="running" pulse size={8} />
                      <span className="rv-active-row__name">{r.personaName}</span>
                      <span className="rv-active-row__model">{r.model}</span>
                    </li>
                  ))}
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

        {/* Right: Fleet sparkline + budget spenders */}
        <section aria-labelledby="burning-now-heading">
          <h3 id="burning-now-heading" className="rv-section-heading">
            Burning now
          </h3>

          {/* Large fleet hourly sparkline */}
          <div className="rv-fleet-sparkline" data-testid="fleet-sparkline">
            <div className="rv-fleet-sparkline__header">
              <span className="rv-fleet-sparkline__label">Fleet hourly cost</span>
              {fleetBudgetData && (
                <span className="rv-fleet-sparkline__value">
                  ${fleetBudgetData.spentUsd.toFixed(2)}
                </span>
              )}
            </div>
            <Sparkline values={hourlyValues} width={FLEET_SPARKLINE_WIDTH} height={FLEET_SPARKLINE_HEIGHT} />
            <div className="rv-fleet-sparkline__axis">
              <span>24h ago</span>
              <span>now</span>
            </div>
          </div>

          {/* Top spenders */}
          <ul className="rv-spenders-list" data-testid="top-spenders-list">
            {spenders.map((r) => {
              const b = budgets[r.id];
              return (
                <li key={r.id} className="rv-spender-row" data-testid="spender-row">
                  <div className="rv-spender-row__header">
                    <span className="rv-spender-row__name">{r.personaName}</span>
                    <span className="rv-spender-row__amount">
                      {b ? `$${b.spentUsd.toFixed(2)} / $${b.capUsd.toFixed(2)}` : '—'}
                    </span>
                  </div>
                  {b && (
                    <BudgetBar
                      spent={b.spentUsd}
                      cap={b.capUsd}
                      warnAt={Math.round(b.warnAt * 100)}
                      size="sm"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
