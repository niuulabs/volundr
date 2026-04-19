import { describe, it, expect } from 'vitest';
import { CONNECTION_KINDS, CONNECTION_VISUAL, isConnectionKind } from './connections';

describe('CONNECTION_KINDS', () => {
  it('contains all five edge kinds', () => {
    expect(CONNECTION_KINDS).toHaveLength(5);
    expect(CONNECTION_KINDS).toContain('solid');
    expect(CONNECTION_KINDS).toContain('dashed-anim');
    expect(CONNECTION_KINDS).toContain('dashed-long');
    expect(CONNECTION_KINDS).toContain('soft');
    expect(CONNECTION_KINDS).toContain('raid');
  });
});

describe('isConnectionKind', () => {
  it('returns true for all valid kinds', () => {
    for (const kind of CONNECTION_KINDS) {
      expect(isConnectionKind(kind)).toBe(true);
    }
  });

  it('returns false for invalid kind', () => {
    expect(isConnectionKind('dotted')).toBe(false);
    expect(isConnectionKind('')).toBe(false);
    expect(isConnectionKind('SOLID')).toBe(false);
  });
});

describe('CONNECTION_VISUAL', () => {
  it('has an entry for every connection kind', () => {
    for (const kind of CONNECTION_KINDS) {
      expect(CONNECTION_VISUAL[kind]).toBeDefined();
    }
  });

  it('solid has no dash and width 1.4', () => {
    expect(CONNECTION_VISUAL.solid.dash).toBeNull();
    expect(CONNECTION_VISUAL.solid.width).toBe(1.4);
  });

  it('dashed-anim has a dash pattern', () => {
    expect(CONNECTION_VISUAL['dashed-anim'].dash).toBeTruthy();
  });

  it('dashed-long has a longer dash pattern and narrower width', () => {
    expect(CONNECTION_VISUAL['dashed-long'].dash).toBeTruthy();
    expect(CONNECTION_VISUAL['dashed-long'].width).toBeLessThan(CONNECTION_VISUAL.solid.width);
  });

  it('soft has the narrowest width', () => {
    const widths = CONNECTION_KINDS.map((k) => CONNECTION_VISUAL[k].width);
    expect(CONNECTION_VISUAL.soft.width).toBe(Math.min(...widths));
  });

  it('every entry has a non-empty meaning string', () => {
    for (const kind of CONNECTION_KINDS) {
      expect(CONNECTION_VISUAL[kind].meaning.length).toBeGreaterThan(0);
    }
  });
});
