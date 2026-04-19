import { describe, it, expect } from 'vitest';
import { budgetStateSchema } from './budget.js';

const VALID_BUDGET = {
  spentUsd: 12.5,
  capUsd: 50.0,
  warnAt: 40.0,
};

describe('budgetStateSchema', () => {
  it('round-trips a valid budget state', () => {
    const parsed = budgetStateSchema.parse(VALID_BUDGET);
    expect(parsed).toEqual(VALID_BUDGET);
  });

  it('round-trips zero spend', () => {
    const input = { spentUsd: 0, capUsd: 100, warnAt: 80 };
    expect(budgetStateSchema.parse(input)).toEqual(input);
  });

  it('round-trips zero warnAt', () => {
    const input = { spentUsd: 5, capUsd: 100, warnAt: 0 };
    expect(budgetStateSchema.parse(input)).toEqual(input);
  });

  it('preserves data through JSON round-trip', () => {
    const json = JSON.stringify(VALID_BUDGET);
    const parsed = budgetStateSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects negative spentUsd', () => {
    expect(() => budgetStateSchema.parse({ ...VALID_BUDGET, spentUsd: -1 })).toThrow();
  });

  it('rejects zero capUsd', () => {
    expect(() => budgetStateSchema.parse({ ...VALID_BUDGET, capUsd: 0 })).toThrow();
  });

  it('rejects negative capUsd', () => {
    expect(() => budgetStateSchema.parse({ ...VALID_BUDGET, capUsd: -10 })).toThrow();
  });

  it('rejects negative warnAt', () => {
    expect(() => budgetStateSchema.parse({ ...VALID_BUDGET, warnAt: -1 })).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() => budgetStateSchema.parse({ spentUsd: 10 })).toThrow();
  });
});
