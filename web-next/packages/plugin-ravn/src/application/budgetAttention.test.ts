import { describe, it, expect } from 'vitest';
import { classifyBudget, budgetRunway, budgetRatio } from './budgetAttention';
import type { BudgetState } from '@niuulabs/domain';

const budget = (spentUsd: number, capUsd: number, warnAt = 0.8): BudgetState => ({
  spentUsd,
  capUsd,
  warnAt,
});

describe('classifyBudget', () => {
  it('returns idle when capUsd is 0 (unlimited)', () => {
    expect(classifyBudget(budget(0, 0))).toBe('idle');
  });

  it('returns idle when ratio is below idle threshold (10%)', () => {
    expect(classifyBudget(budget(0.04, 5.0))).toBe('idle');
    expect(classifyBudget(budget(0, 5.0))).toBe('idle');
  });

  it('returns normal for mid-range spending', () => {
    expect(classifyBudget(budget(1.5, 5.0))).toBe('normal');
    expect(classifyBudget(budget(2.5, 5.0))).toBe('normal');
  });

  it('returns near-cap when ratio >= warnAt and < 0.9', () => {
    expect(classifyBudget(budget(4.0, 5.0))).toBe('near-cap'); // 80%
    expect(classifyBudget(budget(4.3, 5.0))).toBe('near-cap'); // 86%
  });

  it('returns burning-fast when ratio >= 90%', () => {
    expect(classifyBudget(budget(4.5, 5.0))).toBe('burning-fast'); // 90%
    expect(classifyBudget(budget(5.0, 5.0))).toBe('burning-fast'); // 100%
  });

  it('respects custom warnAt threshold', () => {
    // warnAt = 0.5 → near-cap starts at 50%
    expect(classifyBudget(budget(2.6, 5.0, 0.5))).toBe('near-cap');
    // normal below 50%
    expect(classifyBudget(budget(2.0, 5.0, 0.5))).toBe('normal');
  });
});

describe('budgetRunway', () => {
  it('returns remaining budget', () => {
    expect(budgetRunway(budget(1.24, 5.0))).toBeCloseTo(3.76);
  });

  it('returns 0 when over cap', () => {
    expect(budgetRunway(budget(6.0, 5.0))).toBe(0);
  });

  it('returns full cap when nothing spent', () => {
    expect(budgetRunway(budget(0, 5.0))).toBe(5.0);
  });
});

describe('budgetRatio', () => {
  it('returns 0 when cap is 0', () => {
    expect(budgetRatio(budget(0, 0))).toBe(0);
  });

  it('returns ratio clamped to 1', () => {
    expect(budgetRatio(budget(5.0, 5.0))).toBe(1);
    expect(budgetRatio(budget(6.0, 5.0))).toBe(1);
  });

  it('calculates ratio correctly', () => {
    expect(budgetRatio(budget(2.5, 5.0))).toBeCloseTo(0.5);
  });
});
