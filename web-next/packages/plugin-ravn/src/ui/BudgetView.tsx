/**
 * BudgetView — fleet budget dashboard.
 *
 * Sections:
 *   1. Hero card — fleet totals (spent / cap / runway)
 *   2. Three attention columns — Burning fast / Near cap / Idle
 *   3. Collapsible full fleet table
 */

import { useState, useEffect, useCallback } from 'react';
import { BudgetBar, StateDot } from '@niuulabs/ui';
import { useRavens } from './useRavens';
import { useFleetBudget, useRavnBudget } from './useBudget';
import {
  classifyBudget,
  budgetRunway,
  budgetRatio,
  type BudgetAttention,
} from '../application/budgetAttention';
import type { Ravn } from '../domain/ravn';
import type { BudgetState } from '@niuulabs/domain';

const USD = (n: number) => `$${n.toFixed(2)}`;

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

  // Notify parent via effect (not during render) to avoid setState-in-render
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
// Main view
// ---------------------------------------------------------------------------

export function BudgetView() {
  const { data: ravens, isLoading: ravensLoading } = useRavens();
  const { data: fleetBudget, isLoading: fleetLoading } = useFleetBudget();
  const [tableOpen, setTableOpen] = useState(false);

  // Cache per-ravn budget data collected by attention entries
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

  const ATTENTION_COLUMNS: Array<{ key: BudgetAttention; label: string }> = [
    { key: 'burning-fast', label: 'Burning fast' },
    { key: 'near-cap', label: 'Near cap' },
    { key: 'idle', label: 'Idle' },
  ];

  return (
    <div className="rv-budget-view">
      {/* ── Hero card ─────────────────────────────────────────────────── */}
      {fleetBudget && <HeroCard budget={fleetBudget} />}

      {/* ── Three attention columns ─────────────────────────────────── */}
      <div className="rv-budget-attention-columns" role="group" aria-label="budget attention">
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
