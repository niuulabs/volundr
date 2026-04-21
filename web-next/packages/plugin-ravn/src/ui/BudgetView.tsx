/**
 * BudgetView — fleet budget dashboard.
 *
 * Sections:
 *   1. Hero card — fleet totals (spent / cap / runway) with runway bar + burn trend
 *   2. Four attention columns — Over cap / Burning fast / Near cap / Idle
 *   3. Fleet sparkline chart (1200×140) — fleet-wide spend over 24h
 *   4. Top drivers table — ravens ranked by spend share, with per-ravn sparklines
 *   5. Recommended changes — with attention badges and action buttons
 *   6. Collapsible full fleet table
 */

import { useState, useEffect, useCallback } from 'react';
import { BudgetBar, Sparkline, StateDot } from '@niuulabs/ui';
import { useRavens } from './hooks/useRavens';
import { useFleetBudget, useRavnBudget } from './hooks/useBudget';
import {
  classifyBudget,
  budgetRunway,
  budgetRatio,
  burnRate,
  projectedDepletion,
  burnTrend,
  runwayFraction,
  type BudgetAttention,
  type BurnTrend,
} from '../application/budgetAttention';
import type { Ravn } from '../domain/ravn';
import type { BudgetState } from '@niuulabs/domain';

const USD = (n: number) => `$${n.toFixed(2)}`;
const PCT = (n: number) => `${Math.round(n * 100)}%`;

const TOP_DRIVERS_COUNT = 5;

/** Assumed elapsed hours for burn-rate projection (half of daily window). */
const ELAPSED_HOURS = 12;

/** Full budget window in hours — used for runway bar scale. */
const RUNWAY_WINDOW_HOURS = 24;

const ATTENTION_COLUMNS: Array<{ key: BudgetAttention; label: string }> = [
  { key: 'over-cap', label: 'Over cap' },
  { key: 'burning-fast', label: 'Burning fast' },
  { key: 'near-cap', label: 'Near cap' },
  { key: 'idle', label: 'Idle' },
];

/** Generate 24 hourly spend values seeded from a ravn ID (normalized 0–1). */
function generateHourlySpend(ravnId: string, spentUsd: number): number[] {
  // Simple deterministic seed based on id characters
  let seed = 0;
  for (let i = 0; i < ravnId.length; i++) {
    seed = (seed * 31 + ravnId.charCodeAt(i)) >>> 0;
  }
  const values: number[] = [];
  let acc = 0;
  for (let h = 0; h < 24; h++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const step = (seed / 0xffffffff) * (spentUsd / 24) * 2;
    acc = Math.min(spentUsd, acc + step);
    values.push(acc);
  }
  // Normalise to 0–1
  const max = values[values.length - 1] ?? 1;
  return max > 0 ? values.map((v) => v / max) : values.map(() => 0);
}

// ---------------------------------------------------------------------------
// Runway bar
// ---------------------------------------------------------------------------

interface RunwayBarProps {
  budget: BudgetState;
  elapsedHours?: number;
}

function RunwayBar({ budget, elapsedHours = ELAPSED_HOURS }: RunwayBarProps) {
  const rate = burnRate(budget, elapsedHours);
  const hoursLeft = projectedDepletion(budget, rate);
  const fraction = runwayFraction(budget, elapsedHours);

  const tone = fraction > 0.5 ? 'ok' : fraction > 0.2 ? 'warn' : 'crit';

  const projectionLabel = (() => {
    if (hoursLeft === 0) return 'Cap already exceeded';
    if (hoursLeft === Infinity) return 'No spend detected — runway unknown';
    if (hoursLeft < RUNWAY_WINDOW_HOURS) {
      const h = Math.floor(hoursLeft);
      const m = Math.round((hoursLeft - h) * 60);
      return `~${h}h ${m}m remaining at current rate`;
    }
    return `>${RUNWAY_WINDOW_HOURS}h remaining`;
  })();

  return (
    <div className="rv-budget-runway" data-testid="runway-bar">
      <div className="rv-budget-runway__header">
        <span className="rv-budget-runway__projection">{projectionLabel}</span>
      </div>
      <div className="rv-budget-runway__track">
        <div
          className={`rv-budget-runway__fill rv-budget-runway__fill--${tone}`}
          style={{ width: `${fraction * 100}%` }}
          role="meter"
          aria-label="budget runway"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Burn trend indicator
// ---------------------------------------------------------------------------

function BurnTrendBadge({ trend }: { trend: BurnTrend }) {
  const arrow = trend === 'accelerating' ? '↑' : trend === 'decelerating' ? '↓' : '→';
  return (
    <span
      className={`rv-budget-burn-trend rv-budget-burn-trend--${trend}`}
      data-testid="burn-trend"
      title={`Burn rate is ${trend}`}
    >
      {arrow} {trend}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero card
// ---------------------------------------------------------------------------

function HeroCard({ budget }: { budget: BudgetState }) {
  const runway = budgetRunway(budget);
  const ratio = budgetRatio(budget);
  const tone = ratio >= 0.9 ? 'crit' : ratio >= budget.warnAt ? 'warn' : 'ok';

  const rate = burnRate(budget, ELAPSED_HOURS);
  // Approximate previous rate as 90% of current (no historical data in mock)
  const prevRate = rate * 0.9;
  const trend = burnTrend(rate, prevRate);

  return (
    <section className="rv-budget-hero" aria-label="fleet budget">
      <div className="rv-budget-hero__kpis">
        <div className="rv-budget-hero__kpi">
          <span className="rv-budget-hero__kpi-label">spent</span>
          <strong className={`rv-budget-hero__kpi-value rv-budget-hero__kpi-value--${tone}`}>
            {USD(budget.spentUsd)}
          </strong>
        </div>
        <div className="rv-budget-hero__kpi">
          <span className="rv-budget-hero__kpi-label">cap</span>
          <strong className="rv-budget-hero__kpi-value">{USD(budget.capUsd)}</strong>
        </div>
        <div className="rv-budget-hero__kpi">
          <span className="rv-budget-hero__kpi-label">runway</span>
          <strong className="rv-budget-hero__kpi-value">{USD(runway)}</strong>
        </div>
        <div className="rv-budget-hero__kpi">
          <span className="rv-budget-hero__kpi-label">burn rate</span>
          <strong className="rv-budget-hero__kpi-value rv-budget-hero__kpi-value--mono">
            {USD(rate)}/h
          </strong>
        </div>
      </div>
      <div className="rv-budget-hero__bar">
        <BudgetBar spent={budget.spentUsd} cap={budget.capUsd} warnAt={budget.warnAt} showLabel />
      </div>
      <RunwayBar budget={budget} elapsedHours={ELAPSED_HOURS} />
      <div className="rv-budget-hero__trend">
        <span className="rv-budget-hero__trend-label">Burn trend</span>
        <BurnTrendBadge trend={trend} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Attention column item
// ---------------------------------------------------------------------------

function AttentionItem({ ravn, budget }: { ravn: Ravn; budget: BudgetState }) {
  return (
    <div className="rv-budget-attention-item">
      <div className="rv-budget-attention-item__head">
        <span className="rv-budget-attention-item__name">{ravn.personaName}</span>
        <span className="rv-budget-attention-item__spent">{USD(budget.spentUsd)}</span>
      </div>
      <BudgetBar spent={budget.spentUsd} cap={budget.capUsd} warnAt={budget.warnAt} size="sm" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-ravn row (needs individual budget query)
// ---------------------------------------------------------------------------

function RavnAttentionEntry({
  ravn,
  targetAttention,
  onClassified,
}: {
  ravn: Ravn;
  targetAttention: BudgetAttention;
  onClassified: (ravnId: string, attention: BudgetAttention, budget: BudgetState) => void;
}) {
  const { data: budget } = useRavnBudget(ravn.id);

  useEffect(() => {
    if (!budget) return;
    onClassified(ravn.id, classifyBudget(budget), budget);
  }, [budget, ravn.id, onClassified]);

  if (!budget) return null;

  const attention = classifyBudget(budget);
  if (attention !== targetAttention) return null;

  return <AttentionItem ravn={ravn} budget={budget} />;
}

// ---------------------------------------------------------------------------
// Fleet sparkline chart
// ---------------------------------------------------------------------------

interface FleetSparklineProps {
  fleetSpentUsd: number;
}

const FLEET_SPARKLINE_HOURS = ['24h ago', '18h', '12h', '6h', 'now'];

function FleetSparklineChart({ fleetSpentUsd }: FleetSparklineProps) {
  const values = generateHourlySpend('fleet-aggregate', fleetSpentUsd);

  return (
    <section
      className="rv-budget-fleet-sparkline"
      aria-label="fleet spend 24h"
      data-testid="fleet-sparkline"
    >
      <h3 className="rv-budget-fleet-sparkline__title">Fleet spend (24h)</h3>
      <div className="rv-budget-fleet-sparkline__chart">
        <div className="rv-budget-fleet-sparkline__y-axis">
          <span>{USD(fleetSpentUsd)}</span>
          <span>{USD(fleetSpentUsd * 0.5)}</span>
          <span>$0</span>
        </div>
        <div className="rv-budget-fleet-sparkline__canvas">
          <Sparkline values={values} id="fleet-spend-24h" width={1200} height={140} fill />
        </div>
      </div>
      <div className="rv-budget-fleet-sparkline__x-axis">
        {FLEET_SPARKLINE_HOURS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fleet table row
// ---------------------------------------------------------------------------

function FleetRow({ ravn, budget }: { ravn: Ravn; budget: BudgetState | undefined }) {
  const attention = budget ? classifyBudget(budget) : 'normal';
  return (
    <tr className="rv-budget-fleet-row" data-attention={attention}>
      <td className="rv-budget-fleet-row__name">
        <StateDot
          state={
            ravn.status === 'active'
              ? 'healthy'
              : ravn.status === 'failed'
                ? 'failed'
                : ravn.status === 'suspended'
                  ? 'observing'
                  : 'idle'
          }
        />
        {ravn.personaName}
      </td>
      <td className="rv-budget-fleet-row__spent">{budget ? USD(budget.spentUsd) : '—'}</td>
      <td className="rv-budget-fleet-row__cap">{budget ? USD(budget.capUsd) : '—'}</td>
      <td className="rv-budget-fleet-row__bar">
        {budget && (
          <BudgetBar spent={budget.spentUsd} cap={budget.capUsd} warnAt={budget.warnAt} size="sm" />
        )}
      </td>
      <td className="rv-budget-fleet-row__attention">{attention}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Top drivers table
// ---------------------------------------------------------------------------

function TopDriversTable({
  ravens,
  budgetCache,
  fleetTotal,
}: {
  ravens: Ravn[];
  budgetCache: Record<string, BudgetState>;
  fleetTotal: number;
}) {
  const drivers = ravens
    .filter((r) => budgetCache[r.id] != null)
    .map((r) => ({
      ravn: r,
      budget: budgetCache[r.id]!,
      share: fleetTotal > 0 ? (budgetCache[r.id]?.spentUsd ?? 0) / fleetTotal : 0,
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, TOP_DRIVERS_COUNT);

  if (drivers.length === 0) return null;

  return (
    <section className="rv-budget-drivers" aria-label="top drivers" data-testid="top-drivers">
      <h3 className="rv-budget-drivers__title">Top drivers</h3>
      <ul className="rv-budget-drivers__list">
        {drivers.map(({ ravn, budget, share }) => {
          const hourlyValues = generateHourlySpend(ravn.id, budget.spentUsd);
          return (
            <li key={ravn.id} className="rv-budget-driver-row" data-testid="driver-row">
              <span className="rv-budget-driver-row__name">{ravn.personaName}</span>
              <div className="rv-budget-driver-row__sparkline">
                <Sparkline
                  values={hourlyValues}
                  id={`driver-${ravn.id}`}
                  width={80}
                  height={20}
                  fill
                />
              </div>
              <div className="rv-budget-driver-row__bar-track">
                <div
                  className="rv-budget-driver-row__bar-fill"
                  style={{ width: `${share * 100}%` }}
                />
              </div>
              <span className="rv-budget-driver-row__pct">{PCT(share)}</span>
              <span className="rv-budget-driver-row__amount">{USD(budget.spentUsd)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recommended changes
// ---------------------------------------------------------------------------

interface Recommendation {
  ravnId: string;
  personaName: string;
  attention: BudgetAttention;
  message: string;
  actionLabel: string;
}

function buildRecommendations(
  ravens: Ravn[],
  budgetCache: Record<string, BudgetState>,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const ravn of ravens) {
    const budget = budgetCache[ravn.id];
    if (!budget) continue;
    const attention = classifyBudget(budget);
    if (attention === 'over-cap') {
      recs.push({
        ravnId: ravn.id,
        personaName: ravn.personaName,
        attention,
        message: 'Exceeded cap — increase budget or suspend',
        actionLabel: 'Apply cap',
      });
    } else if (attention === 'burning-fast') {
      recs.push({
        ravnId: ravn.id,
        personaName: ravn.personaName,
        attention,
        message: 'Spending fast — consider reducing iteration budget',
        actionLabel: 'Reduce budget',
      });
    } else if (attention === 'idle') {
      recs.push({
        ravnId: ravn.id,
        personaName: ravn.personaName,
        attention,
        message: 'Idle — consider triggering or suspending',
        actionLabel: 'Suspend',
      });
    }
  }
  return recs.slice(0, 5);
}

const ATTENTION_BADGE_LABEL: Record<BudgetAttention, string> = {
  'over-cap': 'over cap',
  'burning-fast': 'burning fast',
  'near-cap': 'near cap',
  idle: 'idle',
  normal: 'normal',
};

function RecommendedChanges({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;

  return (
    <section
      className="rv-budget-recs"
      aria-label="recommended changes"
      data-testid="recommended-changes"
    >
      <h3 className="rv-budget-recs__title">Recommended changes</h3>
      <ul className="rv-budget-recs__list">
        {recommendations.map((rec) => (
          <li
            key={rec.ravnId}
            className="rv-budget-rec-row"
            data-attention={rec.attention}
            data-testid="rec-row"
          >
            <span
              className={`rv-budget-rec-row__badge rv-budget-rec-row__badge--${rec.attention}`}
              aria-label={`attention: ${rec.attention}`}
            >
              {ATTENTION_BADGE_LABEL[rec.attention]}
            </span>
            <span className="rv-budget-rec-row__name">{rec.personaName}</span>
            <span className="rv-budget-rec-row__msg">{rec.message}</span>
            <button
              type="button"
              className={`rv-budget-rec-action rv-budget-rec-action--${rec.attention}`}
              data-testid="rec-action"
              onClick={() => {
                /* stub — wire to port */
              }}
            >
              {rec.actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function BudgetView() {
  const { data: ravens, isLoading: ravensLoading } = useRavens();
  const { data: fleetBudget, isLoading: fleetLoading } = useFleetBudget();
  const [tableOpen, setTableOpen] = useState(false);

  const [budgetCache, setBudgetCache] = useState<Record<string, BudgetState>>({});

  const handleClassified = useCallback(
    (ravnId: string, _attention: BudgetAttention, budget: BudgetState) => {
      setBudgetCache((prev) => {
        if (prev[ravnId] === budget) return prev;
        return { ...prev, [ravnId]: budget };
      });
    },
    [],
  );

  if (ravensLoading || fleetLoading) {
    return (
      <div className="rv-budget-view">
        <div className="rv-budget-view__loading">
          <StateDot state="processing" pulse />
          <span>loading budget…</span>
        </div>
      </div>
    );
  }

  const fleetTotal = fleetBudget?.spentUsd ?? 0;
  const recommendations = buildRecommendations(ravens ?? [], budgetCache);

  return (
    <div className="rv-budget-view">
      {/* ── Hero card ─────────────────────────────────────────────────── */}
      {fleetBudget && <HeroCard budget={fleetBudget} />}

      {/* ── Four attention columns ────────────────────────────────────── */}
      <div
        className="rv-budget-attention-columns rv-budget-attention-columns--4"
        role="group"
        aria-label="budget attention"
      >
        {ATTENTION_COLUMNS.map(({ key, label }) => (
          <section key={key} className="rv-budget-attention-col" aria-label={label}>
            <h3 className="rv-budget-attention-col__title">{label}</h3>
            {(ravens ?? []).map((ravn) => (
              <RavnAttentionEntry
                key={ravn.id}
                ravn={ravn}
                targetAttention={key}
                onClassified={handleClassified}
              />
            ))}
          </section>
        ))}
      </div>

      {/* ── Fleet sparkline chart ──────────────────────────────────────── */}
      <FleetSparklineChart fleetSpentUsd={fleetTotal} />

      {/* ── Top drivers ───────────────────────────────────────────────── */}
      <TopDriversTable ravens={ravens ?? []} budgetCache={budgetCache} fleetTotal={fleetTotal} />

      {/* ── Recommended changes ───────────────────────────────────────── */}
      <RecommendedChanges recommendations={recommendations} />

      {/* ── Collapsible fleet table ─────────────────────────────────── */}
      <div className="rv-budget-fleet">
        <button
          type="button"
          className="rv-budget-fleet__toggle"
          aria-expanded={tableOpen}
          onClick={() => setTableOpen((v) => !v)}
        >
          {tableOpen ? '▼' : '▶'} full fleet table ({ravens?.length ?? 0} ravens)
        </button>
        {tableOpen && (
          <table className="rv-budget-fleet-table" aria-label="fleet budget table">
            <thead>
              <tr>
                <th>ravn</th>
                <th>spent</th>
                <th>cap</th>
                <th>usage</th>
                <th>attention</th>
              </tr>
            </thead>
            <tbody>
              {(ravens ?? []).map((ravn) => (
                <FleetRow key={ravn.id} ravn={ravn} budget={budgetCache[ravn.id]} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
