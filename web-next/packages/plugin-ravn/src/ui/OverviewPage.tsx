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

const LOG_TAIL_LIMIT = 20;
const TOP_SPENDERS_COUNT = 5;
const FLEET_SPARKLINE_SAMPLES = 24;

function generateHourlySpend(seed: number): number[] {
  // Deterministic pseudo-hourly cost based on fleet budget seed
  const values: number[] = [];
  let v = 0.2 + (seed % 100) / 500;
  for (let i = 0; i < FLEET_SPARKLINE_SAMPLES; i++) {
    v = Math.max(0, Math.min(1, v + (((seed * (i + 1)) % 37) / 37 - 0.42) * 0.18));
    values.push(v);
  }
  return values;
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
  const suspendedCount = ravnList.filter((r) => r.status === 'suspended').length;
  const triggerCount = triggers.data?.length ?? 0;
  const sessionCount = sessions.data?.length ?? 0;

  const fleetBudgetData = fleetBudget.data;
  const sparklineSeed = Math.round((fleetBudgetData?.spentUsd ?? 0) * 100);
  const hourlyValues = generateHourlySpend(sparklineSeed);

  const spenders = topBudgetSpenders(ravnList, budgets, TOP_SPENDERS_COUNT);

  const allMessages =
    sessions.data?.flatMap((s) => [
      {
        key: s.id,
        ts: s.createdAt,
        text: `session ${s.id.slice(0, 8)} — ${s.status}`,
        persona: s.personaName,
      },
    ]) ?? [];
  const logTail = [...allMessages]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, LOG_TAIL_LIMIT);

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
      {/* KPI strip */}
      <KpiStrip>
        <div data-testid="kpi-total">
          <KpiCard label="Total ravens" value={ravnList.length} />
        </div>
        <div data-testid="kpi-active">
          <KpiCard label="Active" value={activeCount} deltaTrend="neutral" />
        </div>
        <div data-testid="kpi-suspended">
          <KpiCard label="Suspended" value={suspendedCount} deltaTrend="neutral" />
        </div>
        <div data-testid="kpi-triggers">
          <KpiCard label="Triggers" value={triggerCount} />
        </div>
        <div data-testid="kpi-spend">
          <KpiCard
            label="Fleet spend"
            value={fleetBudgetData ? `$${fleetBudgetData.spentUsd.toFixed(2)}` : '—'}
            sparkline={<Sparkline values={hourlyValues} width={48} height={20} />}
          />
        </div>
        <div data-testid="kpi-sessions">
          <KpiCard label="Sessions" value={sessionCount} />
        </div>
      </KpiStrip>

      {/* 2-column body */}
      <div className="rv-overview__grid">
        {/* Left: Active ravens list */}
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

        {/* Right: Budget spenders + sparkline */}
        <section aria-labelledby="burning-now-heading">
          <h3 id="burning-now-heading" className="rv-section-heading">
            Burning now
          </h3>

          {/* Fleet hourly sparkline */}
          <div className="rv-fleet-sparkline" data-testid="fleet-sparkline">
            <span className="rv-fleet-sparkline__label">Fleet hourly cost</span>
            <Sparkline values={hourlyValues} width={120} height={28} />
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

      {/* Log tail */}
      <section aria-labelledby="log-tail-heading">
        <h3 id="log-tail-heading" className="rv-section-heading">
          Recent activity
        </h3>
        <div className="rv-log-panel" data-testid="log-tail">
          {logTail.length === 0 ? (
            <p className="rv-log-empty">No recent activity</p>
          ) : (
            <table className="rv-log-table">
              <thead>
                <tr className="rv-log-thead-row">
                  <th className="rv-log-th">Time</th>
                  <th className="rv-log-th">Persona</th>
                  <th className="rv-log-th">Event</th>
                </tr>
              </thead>
              <tbody>
                {logTail.map((entry) => (
                  <tr key={entry.key} className="rv-log-row" data-testid="log-row">
                    <td className="rv-log-td--time">{new Date(entry.ts).toLocaleTimeString()}</td>
                    <td className="rv-log-td--persona">{entry.persona}</td>
                    <td className="rv-log-td--event">{entry.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
