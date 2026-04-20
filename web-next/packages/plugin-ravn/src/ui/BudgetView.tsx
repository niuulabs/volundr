/**
 * BudgetView — fleet budget dashboard.
 *
 * Sections:
 *   1. Hero card — fleet totals (spent / cap / runway)
 *   2. Four attention columns — Over cap / Burning fast / Near cap / Idle
 *   3. Top drivers table — ravens ranked by spend share
 *   4. Recommended changes
 *   5. Collapsible full fleet table
 */

import { useState, useEffect, useCallback } from 'react';
import { BudgetBar, StateDot } from '@niuulabs/ui';
import { useRavens } from './hooks/useRavens';
import { useFleetBudget, useRavnBudget } from './hooks/useBudget';
import {
  classifyBudget,
  budgetRunway,
  budgetRatio,
  type BudgetAttention,
} from '../application/budgetAttention';
import type { Ravn } from '../domain/ravn';
import type { BudgetState } from '@niuulabs/domain';

const USD = (n: number) => `$${n.toFixed(2)}`;
const PCT = (n: number) => `${Math.round(n * 100)}%`;

const TOP_DRIVERS_COUNT = 5;

const ATTENTION_COLUMNS: Array<{ key: BudgetAttention; label: string }> = [
  { key: 'over-cap', label: 'Over cap' },
  { key: 'burning-fast', label: 'Burning fast' },
  { key: 'near-cap', label: 'Near cap' },
  { key: 'idle', label: 'Idle' },
];

// ---------------------------------------------------------------------------
// Hero card
// ---------------------------------------------------------------------------

function HeroCard({ budget }: { budget: BudgetState }) {
  const runway = budgetRunway(budget);
  const ratio = budgetRatio(budget);
  const tone = ratio >= 0.9 ? 'crit' : ratio >= budget.warnAt ? 'warn' : 'ok';

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
      </div>
      <div className="rv-budget-hero__bar">
        <BudgetBar spent={budget.spentUsd} cap={budget.capUsd} warnAt={budget.warnAt} showLabel />
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
        {drivers.map(({ ravn, budget, share }) => (
          <li key={ravn.id} className="rv-budget-driver-row" data-testid="driver-row">
            <span className="rv-budget-driver-row__name">{ravn.personaName}</span>
            <div className="rv-budget-driver-row__bar-track">
              <div
                className="rv-budget-driver-row__bar-fill"
                style={{ width: `${share * 100}%` }}
              />
            </div>
            <span className="rv-budget-driver-row__pct">{PCT(share)}</span>
            <span className="rv-budget-driver-row__amount">{USD(budget.spentUsd)}</span>
          </li>
        ))}
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
      });
    } else if (attention === 'burning-fast') {
      recs.push({
        ravnId: ravn.id,
        personaName: ravn.personaName,
        attention,
        message: 'Spending fast — consider reducing iteration budget',
      });
    } else if (attention === 'idle') {
      recs.push({
        ravnId: ravn.id,
        personaName: ravn.personaName,
        attention,
        message: 'Idle — consider triggering or suspending',
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
      <h3 className="rv-budget-recs__title">Recommended changes</h3>
      <ul className="rv-budget-recs__list">
        {recommendations.map((rec) => (
          <li
            key={rec.ravnId}
            className="rv-budget-rec-row"
            data-attention={rec.attention}
            data-testid="rec-row"
          >
            <span className="rv-budget-rec-row__name">{rec.personaName}</span>
            <span className="rv-budget-rec-row__msg">{rec.message}</span>
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
