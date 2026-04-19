import { describe, it, expect } from 'vitest';
import {
  ENTITY_STATUSES,
  isEntityStatus,
  isRealm,
  isCluster,
  isHost,
  isRaid,
  filterByType,
} from './topology';
import type { TopologyEntity } from './topology';

const makeEntity = (overrides: Partial<TopologyEntity> = {}): TopologyEntity => ({
  id: 'e1',
  typeId: 'realm',
  name: 'asgard',
  parentId: null,
  fields: {},
  status: 'healthy',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('ENTITY_STATUSES', () => {
  it('contains healthy', () => {
    expect(ENTITY_STATUSES).toContain('healthy');
  });

  it('contains all expected statuses', () => {
    expect(ENTITY_STATUSES).toContain('failed');
    expect(ENTITY_STATUSES).toContain('idle');
    expect(ENTITY_STATUSES).toContain('processing');
    expect(ENTITY_STATUSES).toContain('unknown');
  });
});

describe('isEntityStatus', () => {
  it('accepts all valid statuses', () => {
    for (const status of ENTITY_STATUSES) {
      expect(isEntityStatus(status)).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    expect(isEntityStatus('broken')).toBe(false);
    expect(isEntityStatus('')).toBe(false);
    expect(isEntityStatus('HEALTHY')).toBe(false);
  });
});

describe('type guards', () => {
  it('isRealm returns true for realm typeId', () => {
    expect(isRealm(makeEntity({ typeId: 'realm' }))).toBe(true);
  });

  it('isRealm returns false for cluster typeId', () => {
    expect(isRealm(makeEntity({ typeId: 'cluster' }))).toBe(false);
  });

  it('isCluster returns true for cluster typeId', () => {
    expect(isCluster(makeEntity({ typeId: 'cluster' }))).toBe(true);
  });

  it('isCluster returns false for realm typeId', () => {
    expect(isCluster(makeEntity({ typeId: 'realm' }))).toBe(false);
  });

  it('isHost returns true for host typeId', () => {
    expect(isHost(makeEntity({ typeId: 'host' }))).toBe(true);
  });

  it('isHost returns false for raid typeId', () => {
    expect(isHost(makeEntity({ typeId: 'raid' }))).toBe(false);
  });

  it('isRaid returns true for raid typeId', () => {
    expect(isRaid(makeEntity({ typeId: 'raid' }))).toBe(true);
  });

  it('isRaid returns false for host typeId', () => {
    expect(isRaid(makeEntity({ typeId: 'host' }))).toBe(false);
  });
});

describe('filterByType', () => {
  const entities: TopologyEntity[] = [
    makeEntity({ id: 'r1', typeId: 'realm' }),
    makeEntity({ id: 'c1', typeId: 'cluster' }),
    makeEntity({ id: 'r2', typeId: 'realm' }),
    makeEntity({ id: 'h1', typeId: 'host' }),
  ];

  it('returns only entities matching the given typeId', () => {
    const realms = filterByType(entities, 'realm');
    expect(realms).toHaveLength(2);
    expect(realms.every((e) => e.typeId === 'realm')).toBe(true);
  });

  it('returns empty array when no matches', () => {
    expect(filterByType(entities, 'raid')).toHaveLength(0);
  });

  it('returns all entities when all match', () => {
    const clusters = filterByType(entities, 'cluster');
    expect(clusters).toHaveLength(1);
  });
});
