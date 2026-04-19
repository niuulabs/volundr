import { describe, it, expect } from 'vitest';
import { EVENT_SOURCES, isEventSource } from './events';

describe('EVENT_SOURCES', () => {
  it('contains all five sources', () => {
    expect(EVENT_SOURCES).toHaveLength(5);
    expect(EVENT_SOURCES).toContain('RAVN');
    expect(EVENT_SOURCES).toContain('TYR');
    expect(EVENT_SOURCES).toContain('MIMIR');
    expect(EVENT_SOURCES).toContain('BIFROST');
    expect(EVENT_SOURCES).toContain('RAID');
  });
});

describe('isEventSource', () => {
  it('returns true for all valid sources', () => {
    for (const source of EVENT_SOURCES) {
      expect(isEventSource(source)).toBe(true);
    }
  });

  it('returns false for lowercase variant', () => {
    expect(isEventSource('ravn')).toBe(false);
    expect(isEventSource('tyr')).toBe(false);
  });

  it('returns false for unknown string', () => {
    expect(isEventSource('SKULD')).toBe(false);
    expect(isEventSource('')).toBe(false);
  });
});
