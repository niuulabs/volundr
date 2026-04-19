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
    <div
      data-testid="overview-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        padding: 'var(--space-6)',
      }}
    >
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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-6)',
          alignItems: 'start',
        }}
      >
        {/* Left: Active ravens list */}
        <section aria-labelledby="active-ravens-heading">
          <h3
            id="active-ravens-heading"
            style={{
              margin: '0 0 var(--space-3)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Active ravens
          </h3>
          {ravnList.filter((r) => r.status === 'active').length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              No active ravens
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
              data-testid="active-ravens-list"
            >
              {ravnList
                .filter((r) => r.status === 'active')
                .map((r) => (
                  <li
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-3)',
                      background: 'var(--color-bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                    }}
                    data-testid="active-ravn-row"
                  >
                    <StateDot state="running" pulse size={8} />
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, flex: 1 }}>
                      {r.personaName}
                    </span>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {r.model}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>

        {/* Right: Budget spenders + sparkline */}
        <section aria-labelledby="burning-now-heading">
          <h3
            id="burning-now-heading"
            style={{
              margin: '0 0 var(--space-3)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Burning now
          </h3>

          {/* Fleet hourly sparkline */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
            }}
            data-testid="fleet-sparkline"
          >
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Fleet hourly cost
            </span>
            <Sparkline values={hourlyValues} width={120} height={28} />
          </div>

          {/* Top spenders */}
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
            data-testid="top-spenders-list"
          >
            {spenders.map((r) => {
              const b = budgets[r.id];
              return (
                <li
                  key={r.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-1)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                  data-testid="spender-row"
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                      {r.personaName}
                    </span>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
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
        <h3
          id="log-tail-heading"
          style={{
            margin: '0 0 var(--space-3)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Recent activity
        </h3>
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}
          data-testid="log-tail"
        >
          {logTail.length === 0 ? (
            <p
              style={{
                padding: 'var(--space-4)',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-sm)',
              }}
            >
              No recent activity
            </p>
          ) : (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      textAlign: 'left',
                      color: 'var(--color-text-muted)',
                      fontWeight: 500,
                    }}
                  >
                    Time
                  </th>
                  <th
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      textAlign: 'left',
                      color: 'var(--color-text-muted)',
                      fontWeight: 500,
                    }}
                  >
                    Persona
                  </th>
                  <th
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      textAlign: 'left',
                      color: 'var(--color-text-muted)',
                      fontWeight: 500,
                    }}
                  >
                    Event
                  </th>
                </tr>
              </thead>
              <tbody>
                {logTail.map((entry) => (
                  <tr
                    key={entry.key}
                    style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
                    data-testid="log-row"
                  >
                    <td
                      style={{
                        padding: 'var(--space-2) var(--space-3)',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {new Date(entry.ts).toLocaleTimeString()}
                    </td>
                    <td
                      style={{
                        padding: 'var(--space-2) var(--space-3)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {entry.persona}
                    </td>
                    <td
                      style={{
                        padding: 'var(--space-2) var(--space-3)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {entry.text}
                    </td>
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
