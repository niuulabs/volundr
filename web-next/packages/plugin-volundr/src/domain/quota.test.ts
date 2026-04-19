import { describe, it, expect } from 'vitest';
import { isWithinQuota, remainingQuota, isOverQuota, type Quota, type QuotaUsage } from './quota';

const QUOTA: Quota = { maxCpu: 100, maxMemMi: 8192, maxGpu: 4, maxSessions: 10 };

describe('isWithinQuota', () => {
  it('returns true when all dimensions are under the limit', () => {
    const usage: QuotaUsage = { cpu: 50, memMi: 4096, gpu: 2, sessions: 5 };
    expect(isWithinQuota(QUOTA, usage)).toBe(true);
  });

  it('returns true when usage exactly equals the limit', () => {
    const usage: QuotaUsage = { cpu: 100, memMi: 8192, gpu: 4, sessions: 10 };
    expect(isWithinQuota(QUOTA, usage)).toBe(true);
  });

  it('returns false when cpu exceeds the limit', () => {
    const usage: QuotaUsage = { cpu: 101, memMi: 4096, gpu: 2, sessions: 5 };
    expect(isWithinQuota(QUOTA, usage)).toBe(false);
  });

  it('returns false when memMi exceeds the limit', () => {
    const usage: QuotaUsage = { cpu: 50, memMi: 8193, gpu: 2, sessions: 5 };
    expect(isWithinQuota(QUOTA, usage)).toBe(false);
  });

  it('returns false when gpu exceeds the limit', () => {
    const usage: QuotaUsage = { cpu: 50, memMi: 4096, gpu: 5, sessions: 5 };
    expect(isWithinQuota(QUOTA, usage)).toBe(false);
  });

  it('returns false when sessions exceed the limit', () => {
    const usage: QuotaUsage = { cpu: 50, memMi: 4096, gpu: 2, sessions: 11 };
    expect(isWithinQuota(QUOTA, usage)).toBe(false);
  });

  it('returns true for all-zero usage', () => {
    const usage: QuotaUsage = { cpu: 0, memMi: 0, gpu: 0, sessions: 0 };
    expect(isWithinQuota(QUOTA, usage)).toBe(true);
  });
});

describe('remainingQuota', () => {
  it('returns the remaining capacity for each dimension', () => {
    const usage: QuotaUsage = { cpu: 40, memMi: 2048, gpu: 1, sessions: 3 };
    const remaining = remainingQuota(QUOTA, usage);
    expect(remaining.cpu).toBe(60);
    expect(remaining.memMi).toBe(6144);
    expect(remaining.gpu).toBe(3);
    expect(remaining.sessions).toBe(7);
  });

  it('returns zero when usage equals quota', () => {
    const usage: QuotaUsage = { cpu: 100, memMi: 8192, gpu: 4, sessions: 10 };
    const remaining = remainingQuota(QUOTA, usage);
    expect(remaining.cpu).toBe(0);
    expect(remaining.memMi).toBe(0);
    expect(remaining.gpu).toBe(0);
    expect(remaining.sessions).toBe(0);
  });

  it('returns negative values when over-quota', () => {
    const usage: QuotaUsage = { cpu: 120, memMi: 10000, gpu: 6, sessions: 15 };
    const remaining = remainingQuota(QUOTA, usage);
    expect(remaining.cpu).toBe(-20);
    expect(remaining.memMi).toBe(-1808);
    expect(remaining.gpu).toBe(-2);
    expect(remaining.sessions).toBe(-5);
  });
});

describe('isOverQuota', () => {
  it('returns false when within quota', () => {
    const usage: QuotaUsage = { cpu: 10, memMi: 100, gpu: 0, sessions: 1 };
    expect(isOverQuota(QUOTA, usage)).toBe(false);
  });

  it('returns true when any dimension is over', () => {
    const usage: QuotaUsage = { cpu: 10, memMi: 100, gpu: 0, sessions: 11 };
    expect(isOverQuota(QUOTA, usage)).toBe(true);
  });

  it('is the inverse of isWithinQuota', () => {
    const usage: QuotaUsage = { cpu: 50, memMi: 4096, gpu: 2, sessions: 5 };
    expect(isOverQuota(QUOTA, usage)).toBe(!isWithinQuota(QUOTA, usage));
  });
});
