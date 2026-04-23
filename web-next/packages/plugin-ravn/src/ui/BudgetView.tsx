/**
 * BudgetView — fleet budget dashboard (web2 baseline layout).
 *
 * Sections:
 *   1. Hero card — "$X spent of $Y" with segmented runway bar + projection pill
 *   2. Four attention columns — Over cap / Will exceed cap by EOD / Near cap (≥70%) / Accelerating
 *   3. Two-column: Top drivers today + Recommended changes
 *   4. Fleet burn sparkline (full-width, no axes)
 *   5. Collapsible full fleet table
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BudgetBar, Sparkline, StateDot } from '@niuulabs/ui';
import { useRavens } from './hooks/useRavens';
import { useFleetBudget, useRavnBudget } from './hooks/useBudget';
import {
  classifyBudget,
  budgetRatio,
  burnRate,
  type BudgetAttention,
} from '../application/budgetAttention';
import type { Ravn } from '../domain/ravn';
import type { BudgetState } from '@niuulabs/domain';
import './ravn-views.css';

const USD = (n: number) => `$${n.toFixed(2)}`;
const PCT = (n: number) => `${Math.round(n * 100)}%`;

const TOP_DRIVERS_COUNT = 5;

/** Assumed elapsed hours for burn-rate projection. */
const ELAPSED_HOURS = 18;

/** Full budget window in hours. */
const RUNWAY_WINDOW_HOURS = 24;

/** Attention column definitions matching web2 baseline. */
const ATTENTION_COLUMNS: Array<{
  key: BudgetAttention;
  label: string;
  icon: string;
  emptyMsg?: string;
}> = [
  { key: 'over-cap', label: 'Over cap', icon: '⊘', emptyMsg: 'No ravens over cap — good.' },
  {
    key: 'burning-fast',
    label: 'Will exceed cap by EOD',
    icon: '▲',
    emptyMsg: 'No projected overruns.',
  },
  { key: 'near-cap', label: 'Near cap (≥70%)', icon: '◐' },
  { key: 'idle', label: 'Accelerating', icon: '↗' },
];

/** Generate 24 hourly spend values seeded from a ravn ID (normalized 0–1). */
function generateHourlySpend(ravnId: string, spentUsd: number): number[] {
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
  const max = values[values.length - 1] ?? 1;
  return max > 0 ? values.map((v) => v / max) : values.map(() => 0);
}

// ---------------------------------------------------------------------------
// Hero card — web2 style: large $ + "spent of $Y" + runway bar + projection
// ---------------------------------------------------------------------------

function HeroCard({ budget }: { budget: BudgetState }) {
  const rate = burnRate(budget, ELAPSED_HOURS);
  const eodProjection = rate * RUNWAY_WINDOW_HOURS;
  const headroom = budget.capUsd - eodProjection;
  const spentPct = (budget.spentUsd / budget.capUsd) * 100;
  const eodPct = Math.min((eodProjection / budget.capUsd) * 100, 100);

  return (
    <section className="rv-budget-hero" aria-label="fleet budget">
      <div className="rv-budget-hero__header">
        <span className="rv-budget-hero__elapsed">
          TODAY · {ELAPSED_HOURS}H OF {RUNWAY_WINDOW_HOURS}H ELAPSED
        </span>
      </div>
      <div className="rv-budget-hero__main">
        <span className="rv-budget-hero__big-value">{USD(budget.spentUsd)}</span>
        <span className="rv-budget-hero__spent-label">
          spent of <strong>{USD(budget.capUsd)}</strong>
        </span>
      </div>

      {/* Segmented runway bar */}
      <div className="rv-budget-runway" data-testid="runway-bar">
        <div className="rv-budget-runway__bar-wrap">
          <div className="rv-budget-runway__track">
            {/* Spent segment */}
            <div
              className="rv-budget-runway__fill rv-budget-runway__fill--spent"
              style={{ width: `${spentPct}%` }}
            />
            {/* Projected segment (hatched) */}
            <div
              className="rv-budget-runway__fill rv-budget-runway__fill--projected"
              style={{ left: `${spentPct}%`, width: `${Math.max(0, eodPct - spentPct)}%` }}
            />
          </div>
          {/* NOW marker */}
          <div className="rv-budget-runway__now" style={{ left: `${spentPct}%` }}>
            <span className="rv-budget-runway__now-label">NOW</span>
            <div className="rv-budget-runway__now-line" />
          </div>
        </div>
        {/* Annotations */}
        <div className="rv-budget-runway__annotations">
          <span>0</span>
          <span style={{ position: 'absolute', left: `${spentPct}%`, transform: 'translateX(-50%)' }}>
            now · {USD(budget.spentUsd)}
          </span>
          <span style={{ position: 'absolute', left: `${eodPct}%`, transform: 'translateX(-50%)' }}>
            eod · {USD(eodProjection)}
          </span>
          <span style={{ position: 'absolute', right: 0 }}>cap · {USD(budget.capUsd)}</span>
        </div>
      </div>

      {/* Projection pill */}
      <div className="rv-budget-hero__projection">
        <span className="rv-budget-hero__projection-pill" role="meter" aria-label="budget runway" aria-valuenow={Math.round((1 - budget.spentUsd / budget.capUsd) * 100)} aria-valuemin={0} aria-valuemax={100}>
          projecting <strong>{USD(eodProjection)}</strong> by EOD ·{' '}
          <strong>{USD(Math.max(0, headroom))}</strong> headroom
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Attention column item — web2 style with icon + spent/cap + percentage
// ---------------------------------------------------------------------------

function AttentionItem({ ravn, budget }: { ravn: Ravn; budget: BudgetState }) {
  const ratio = budgetRatio(budget);
  const rate = burnRate(budget, ELAPSED_HOURS);
  const attention = classifyBudget(budget);
  const isAccelerating = attention === 'idle'; // mapped to "Accelerating" column

  return (
    <div className="rv-budget-attention-item">
      <div className="rv-budget-attention-item__head">
        <span className="rv-budget-attention-item__icon">{ravn.letter ?? '●'}</span>
        <span className="rv-budget-attention-item__name">
          {ravn.personaName}{' '}
          <span className="rv-budget-attention-item__ratio">
            {USD(budget.spentUsd)}/{USD(budget.capUsd)}
          </span>
        </span>
        <span className="rv-budget-attention-item__spent">
          {isAccelerating ? `+${USD(rate)}/h` : PCT(ratio)}
        </span>
      </div>
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
// Fleet burn chart — web2 style: full-width, no axes, with stats header
// ---------------------------------------------------------------------------

function FleetBurnChart({ fleetBudget }: { fleetBudget: BudgetState }) {
  const values = generateHourlySpend('fleet-aggregate', fleetBudget.spentUsd);
  const rate = burnRate(fleetBudget, ELAPSED_HOURS);

  return (
    <section
      className="rv-budget-fleet-burn"
      aria-label="fleet spend 24h"
      data-testid="fleet-sparkline"
    >
      <div className="rv-budget-fleet-burn__header">
        <h3 className="rv-budget-fleet-burn__title">Fleet burn · last 24h</h3>
        <span className="rv-budget-fleet-burn__stats">
          peak {USD(rate * 1.1)}/h · avg {USD(rate)}/h · now {USD(rate)}/h
        </span>
      </div>
      <div className="rv-budget-fleet-burn__chart">
        <Sparkline values={values} id="fleet-burn-24h" width={1200} height={120} fill />
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
// Top drivers table — web2 style with rank, icon, role, bar, sparkline
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
      <div className="rv-budget-drivers__header">
        <h3 className="rv-budget-drivers__title">Top drivers today</h3>
        <span className="rv-budget-drivers__subtitle">ravens ranked by absolute $ spent</span>
      </div>
      <ul className="rv-budget-drivers__list">
        {drivers.map(({ ravn, budget, share }, idx) => {
          const hourlyValues = generateHourlySpend(ravn.id, budget.spentUsd);
          return (
            <li key={ravn.id} className="rv-budget-driver-row" data-testid="driver-row">
              <span className="rv-budget-driver-row__rank">{idx + 1}</span>
              <span className="rv-budget-driver-row__icon">{ravn.letter ?? '●'}</span>
              <span className="rv-budget-driver-row__name">
                {ravn.personaName}{' '}
                <span className="rv-budget-driver-row__role">{ravn.role ?? ''}</span>{' '}
                <span className="rv-budget-driver-row__share">{PCT(share)} of fleet</span>
              </span>
              <div className="rv-budget-driver-row__bar-track">
                <div
                  className="rv-budget-driver-row__bar-fill"
                  style={{ width: `${share * 100}%` }}
                />
              </div>
              <div className="rv-budget-driver-row__sparkline">
                <Sparkline
                  values={hourlyValues}
                  id={`driver-${ravn.id}`}
                  width={80}
                  height={20}
                  fill
                />
              </div>
              <span className="rv-budget-driver-row__amount">{USD(budget.spentUsd)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recommended changes — web2 style: underused badge + usage + cap suggestion
// ---------------------------------------------------------------------------

interface Recommendation {
  ravnId: string;
  personaName: string;
  attention: BudgetAttention;
  badge: string;
  usageText: string;
  suggestion: string;
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
        badge: 'over cap',
        usageText: `used ${USD(budget.spentUsd)} of ${USD(budget.capUsd)} cap`,
        suggestion: `→ increase cap to ${USD(budget.spentUsd * 1.3)}`,
        actionLabel: 'apply',
      });
    } else if (attention === 'idle') {
      const suggestedCap = Math.max(0.05, budget.spentUsd * 3 || budget.capUsd * 0.3);
      recs.push({
        ravnId: ravn.id,
        personaName: ravn.personaName,
        attention,
        badge: 'underused',
        usageText: `used ${USD(budget.spentUsd)} of ${USD(budget.capUsd)} cap`,
        suggestion: `→ lower cap to ${USD(suggestedCap)}`,
        actionLabel: 'apply',
      });
    }
  }
  return recs.slice(0, 5);
}

function RecommendedChanges({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;

  return (
    <section
      className="rv-budget-recs"
      aria-label="recommended changes"
      data-testid="recommended-changes"
    >
      <div className="rv-budget-recs__header">
        <h3 className="rv-budget-recs__title">Recommended changes</h3>
        <span className="rv-budget-recs__subtitle">suggested cap adjustments</span>
      </div>
      <ul className="rv-budget-recs__list">
        {recommendations.map((rec) => (
          <li
            key={rec.ravnId}
            className="rv-budget-rec-card"
            data-attention={rec.attention}
            data-testid="rec-row"
          >
            <div className="rv-budget-rec-card__head">
              <span className="rv-budget-rec-card__name">{rec.personaName}</span>
              <span
                className={`rv-budget-rec-row__badge rv-budget-rec-row__badge--${rec.attention}`}
                aria-label={`attention: ${rec.attention}`}
              >
                {rec.badge}
              </span>
            </div>
            <span className="rv-budget-rec-card__usage">{rec.usageText}</span>
            <div className="rv-budget-rec-card__action-row">
              <span className="rv-budget-rec-card__suggestion">{rec.suggestion}</span>
              <button
                type="button"
                className="rv-budget-rec-action"
                data-testid="rec-action"
                onClick={() => {
                  /* stub */
                }}
              >
                {rec.actionLabel}
              </button>
            </div>
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

  const attentionCounts = useMemo(() => {
    const counts: Record<BudgetAttention, number> = {
      'over-cap': 0,
      'burning-fast': 0,
      'near-cap': 0,
      idle: 0,
      normal: 0,
    };
    for (const b of Object.values(budgetCache)) {
      const a = classifyBudget(b);
      counts[a]++;
    }
    return counts;
  }, [budgetCache]);

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
        {ATTENTION_COLUMNS.map(({ key, label, icon, emptyMsg }) => (
          <section key={key} className="rv-budget-attention-col" aria-label={label}>
            <div className="rv-budget-attention-col__head">
              <span className="rv-budget-attention-col__icon">{icon}</span>
              <h3 className="rv-budget-attention-col__title">{label}</h3>
              <span className="rv-budget-attention-col__count">{attentionCounts[key]}</span>
            </div>
            {attentionCounts[key] === 0 && emptyMsg && (
              <span className="rv-budget-attention-col__empty">{emptyMsg}</span>
            )}
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

      {/* ── Two-column: Top drivers + Recommended changes ────────────── */}
      <div className="rv-budget-two-col">
        <TopDriversTable
          ravens={ravens ?? []}
          budgetCache={budgetCache}
          fleetTotal={fleetTotal}
        />
        <RecommendedChanges recommendations={recommendations} />
      </div>

      {/* ── Fleet burn chart ──────────────────────────────────────────── */}
      {fleetBudget && <FleetBurnChart fleetBudget={fleetBudget} />}

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
