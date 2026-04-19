import { describe, it, expect } from 'vitest';
import { findType, wouldCreateCycle, reparentType } from './registry';
import type { TypeRegistry } from './registry';

const BASE_REGISTRY: TypeRegistry = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  types: [
    {
      id: 'realm',
      label: 'Realm',
      rune: 'ᛞ',
      icon: 'globe',
      shape: 'ring',
      color: 'ice-100',
      size: 18,
      border: 'solid',
      canContain: ['cluster', 'host'],
      parentTypes: [],
      category: 'topology',
      description: 'A realm.',
      fields: [],
    },
    {
      id: 'cluster',
      label: 'Cluster',
      rune: 'ᚲ',
      icon: 'layers',
      shape: 'ring-dashed',
      color: 'ice-200',
      size: 14,
      border: 'dashed',
      canContain: ['service'],
      parentTypes: ['realm'],
      category: 'topology',
      description: 'A cluster.',
      fields: [],
    },
    {
      id: 'host',
      label: 'Host',
      rune: 'ᚦ',
      icon: 'server',
      shape: 'rounded-rect',
      color: 'slate-400',
      size: 22,
      border: 'solid',
      canContain: ['service'],
      parentTypes: ['realm'],
      category: 'hardware',
      description: 'A host.',
      fields: [],
    },
    {
      id: 'service',
      label: 'Service',
      rune: 'ᛦ',
      icon: 'box',
      shape: 'dot',
      color: 'ice-300',
      size: 8,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster', 'host'],
      category: 'infrastructure',
      description: 'A service.',
      fields: [],
    },
  ],
};

describe('findType', () => {
  it('returns the matching type by id', () => {
    const found = findType(BASE_REGISTRY, 'realm');
    expect(found).toBeDefined();
    expect(found?.id).toBe('realm');
  });

  it('returns undefined for unknown id', () => {
    expect(findType(BASE_REGISTRY, 'unknown-type')).toBeUndefined();
  });
});

describe('wouldCreateCycle', () => {
  it('returns false when no cycle would be created', () => {
    // Moving 'service' under 'host' — service is not an ancestor of host
    expect(wouldCreateCycle(BASE_REGISTRY, 'service', 'host')).toBe(false);
  });

  it('returns true when direct cycle: moving parent under its own child', () => {
    // 'realm' canContain 'cluster'; moving 'realm' under 'cluster' would cycle
    expect(wouldCreateCycle(BASE_REGISTRY, 'realm', 'cluster')).toBe(true);
  });

  it('returns true for transitive cycle: realm → cluster → service, move realm under service', () => {
    expect(wouldCreateCycle(BASE_REGISTRY, 'realm', 'service')).toBe(true);
  });

  it('returns false for unrelated types', () => {
    expect(wouldCreateCycle(BASE_REGISTRY, 'host', 'cluster')).toBe(false);
  });

  it('returns false for unknown dragged type', () => {
    expect(wouldCreateCycle(BASE_REGISTRY, 'nonexistent', 'realm')).toBe(false);
  });

  it('returns false for unknown target type', () => {
    expect(wouldCreateCycle(BASE_REGISTRY, 'cluster', 'nonexistent')).toBe(false);
  });

  it('returns true when draggedId === targetId (self-loop)', () => {
    expect(wouldCreateCycle(BASE_REGISTRY, 'cluster', 'cluster')).toBe(true);
    expect(wouldCreateCycle(BASE_REGISTRY, 'realm', 'realm')).toBe(true);
  });
});

describe('reparentType', () => {
  it('moves a type to a new parent', () => {
    // Move 'host' from realm's canContain to cluster's canContain
    const updated = reparentType(BASE_REGISTRY, 'host', 'cluster');
    const cluster = findType(updated, 'cluster');
    const realm = findType(updated, 'realm');
    const host = findType(updated, 'host');

    expect(cluster?.canContain).toContain('host');
    expect(realm?.canContain).not.toContain('host');
    expect(host?.parentTypes).toEqual(['cluster']);
  });

  it('bumps the registry version', () => {
    const updated = reparentType(BASE_REGISTRY, 'host', 'cluster');
    expect(updated.version).toBe(BASE_REGISTRY.version + 1);
  });

  it('updates updatedAt', () => {
    const updated = reparentType(BASE_REGISTRY, 'host', 'cluster');
    expect(updated.updatedAt).not.toBe(BASE_REGISTRY.updatedAt);
  });

  it('returns unchanged registry when cycle would be created', () => {
    const result = reparentType(BASE_REGISTRY, 'realm', 'cluster');
    expect(result).toBe(BASE_REGISTRY);
    expect(result.version).toBe(BASE_REGISTRY.version);
  });

  it('does not duplicate child in target canContain if already present', () => {
    // 'cluster' is already in realm's canContain — move service under realm instead
    const updated = reparentType(BASE_REGISTRY, 'service', 'realm');
    const realm = findType(updated, 'realm');
    const serviceOccurrences = realm?.canContain.filter((id) => id === 'service').length ?? 0;
    expect(serviceOccurrences).toBe(1);
  });

  it('preserves all other types unchanged', () => {
    const updated = reparentType(BASE_REGISTRY, 'service', 'host');
    expect(updated.types).toHaveLength(BASE_REGISTRY.types.length);
  });

  it('returns unchanged registry when childId === newParentId (self-reparent)', () => {
    const result = reparentType(BASE_REGISTRY, 'cluster', 'cluster');
    expect(result).toBe(BASE_REGISTRY);
  });

  it('updates parentTypes even when child has itself in canContain', () => {
    // Build a registry where 'cluster' has itself in canContain (self-referential edge).
    // The old map early-returned on the canContain-removal branch and never reached parentTypes.
    const selfRefRegistry: TypeRegistry = {
      ...BASE_REGISTRY,
      types: BASE_REGISTRY.types.map((t) =>
        t.id === 'cluster' ? { ...t, canContain: ['cluster', 'service'], parentTypes: [] } : t,
      ),
    };

    // Move cluster under realm — cycle check passes (cluster.canContain doesn't reach realm).
    const updated = reparentType(selfRefRegistry, 'cluster', 'realm');
    const cluster = findType(updated, 'cluster');

    // parentTypes must be updated
    expect(cluster?.parentTypes).toEqual(['realm']);
    // self-reference must be stripped from canContain
    expect(cluster?.canContain).not.toContain('cluster');
    // 'service' stays since it wasn't the childId
    expect(cluster?.canContain).toContain('service');
  });
});
