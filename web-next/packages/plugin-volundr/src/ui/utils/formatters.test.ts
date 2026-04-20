import { describe, it, expect, vi } from 'vitest';
import { money, tokens, relTime } from './formatters';

describe('money', () => {
  it('formats cents to dollars', () => {
    expect(money(0)).toBe('$0.00');
    expect(money(328)).toBe('$3.28');
    expect(money(100)).toBe('$1.00');
  });

  it('formats large amounts with k suffix', () => {
    expect(money(100_000)).toBe('$1.0k');
    expect(money(150_000)).toBe('$1.5k');
  });
});

describe('tokens', () => {
  it('formats small counts as-is', () => {
    expect(tokens(42)).toBe('42');
    expect(tokens(999)).toBe('999');
  });

  it('formats thousands with k suffix', () => {
    expect(tokens(1_000)).toBe('1.0k');
    expect(tokens(82_400)).toBe('82.4k');
  });

  it('formats millions with M suffix', () => {
    expect(tokens(1_000_000)).toBe('1.00M');
    expect(tokens(2_500_000)).toBe('2.50M');
  });
});

describe('relTime', () => {
  it('returns — for falsy input', () => {
    expect(relTime(0)).toBe('—');
  });

  it('formats seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    expect(relTime(5_000)).toBe('5s ago');
    vi.useRealTimers();
  });

  it('formats minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(300_000);
    expect(relTime(0 + 1)).toBe('4m ago');
    vi.useRealTimers();
  });

  it('formats hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(7_200_000);
    expect(relTime(1)).toBe('1h ago');
    vi.useRealTimers();
  });

  it('formats days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(172_800_000);
    expect(relTime(1)).toBe('1d ago');
    vi.useRealTimers();
  });
});
