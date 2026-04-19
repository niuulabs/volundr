/**
 * Budget attention classification.
 *
 * Classifies a ravn's spend state into one of three attention buckets used
 * by the Budget view's attention columns.
 */

import type { BudgetState } from '@niuulabs/domain';

/** Ratio at which a ravn is classified as "burning fast" (critical). */
const BURNING_THRESHOLD = 0.9;

/** Ratio below which a ravn is classified as "idle". */
const IDLE_THRESHOLD = 0.1;

export type BudgetAttention = 'burning-fast' | 'near-cap' | 'idle' | 'normal';

/**
 * Classify a single ravn's budget into an attention bucket.
 *
 * - `burning-fast` — spending ratio ≥ 90 % (critical)
 * - `near-cap`     — spending ratio ≥ warnAt (warn threshold) but < 90 %
 * - `idle`         — spending ratio < 10 %
 * - `normal`       — everything else
 */
export function classifyBudget(budget: BudgetState): BudgetAttention {
  if (budget.capUsd === 0) return 'idle';
  const ratio = budget.spentUsd / budget.capUsd;
  if (ratio >= BURNING_THRESHOLD) return 'burning-fast';
  if (ratio >= budget.warnAt) return 'near-cap';
  if (ratio < IDLE_THRESHOLD) return 'idle';
  return 'normal';
}

/**
 * Returns the runway: how many USD remain before hitting the cap.
 */
export function budgetRunway(budget: BudgetState): number {
  return Math.max(0, budget.capUsd - budget.spentUsd);
}

/**
 * Returns spending ratio (0–1 clamped), or 0 when cap is unlimited.
 */
export function budgetRatio(budget: BudgetState): number {
  if (budget.capUsd === 0) return 0;
  return Math.min(1, budget.spentUsd / budget.capUsd);
}
