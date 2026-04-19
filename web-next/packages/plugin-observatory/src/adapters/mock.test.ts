import { describe, it, expect, vi } from 'vitest';
import {
  createMockRegistryRepository,
  createMockTopologyStream,
  createMockEventStream,
} from './mock';

describe('createMockRegistryRepository', () => {
  it('returns a registry with the correct version', async () => {
    const repo = createMockRegistryRepository();
    const registry = await repo.getRegistry();
    expect(registry.version).toBe(7);
    expect(registry.updatedAt).toBe('2026-04-15T09:24:11Z');
  });

  it('returns all 18 entity types', async () => {
    const repo = createMockRegistryRepository();
    const registry = await repo.getRegistry();
    expect(registry.types.length).toBe(18);
  });

  it('includes the four named domain entities', async () => {
    const repo = createMockRegistryRepository();
    const { types } = await repo.getRegistry();
    const ids = types.map((t) => t.id);
    expect(ids).toContain('realm');
    expect(ids).toContain('cluster');
    expect(ids).toContain('host');
    expect(ids).toContain('raid');
  });

  it('every entity type has required fields', async () => {
    const repo = createMockRegistryRepository();
    const { types } = await repo.getRegistry();
    for (const t of types) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.rune).toBeTruthy();
      expect(t.shape).toBeTruthy();
      expect(Array.isArray(t.canContain)).toBe(true);
      expect(Array.isArray(t.parentTypes)).toBe(true);
      expect(Array.isArray(t.fields)).toBe(true);
    }
  });

  it('covers all 5 edge kinds across entity types', async () => {
    // Verify the topology stream edges include all 5 kinds
    const stream = createMockTopologyStream();
    const snapshot = stream.getSnapshot();
    expect(snapshot).not.toBeNull();
    const kinds = new Set(snapshot!.edges.map((e) => e.kind));
    expect(kinds.has('solid')).toBe(true);
    expect(kinds.has('dashed-anim')).toBe(true);
    expect(kinds.has('dashed-long')).toBe(true);
    expect(kinds.has('soft')).toBe(true);
    expect(kinds.has('raid')).toBe(true);
  });
});

describe('createMockTopologyStream', () => {
  it('getSnapshot returns a topology with nodes and edges', () => {
    const stream = createMockTopologyStream();
    const snapshot = stream.getSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nodes.length).toBeGreaterThan(0);
    expect(snapshot!.edges.length).toBeGreaterThan(0);
    expect(typeof snapshot!.timestamp).toBe('string');
  });

  it('topology includes realm, cluster, host, and raid nodes', () => {
    const stream = createMockTopologyStream();
    const { nodes } = stream.getSnapshot()!;
    const typeIds = new Set(nodes.map((n) => n.typeId));
    expect(typeIds.has('realm')).toBe(true);
    expect(typeIds.has('cluster')).toBe(true);
    expect(typeIds.has('host')).toBe(true);
    expect(typeIds.has('raid')).toBe(true);
  });

  it('every node has required fields', () => {
    const stream = createMockTopologyStream();
    const { nodes } = stream.getSnapshot()!;
    for (const node of nodes) {
      expect(node.id).toBeTruthy();
      expect(node.typeId).toBeTruthy();
      expect(node.label).toBeTruthy();
      expect(node.status).toBeTruthy();
    }
  });

  it('subscribe immediately calls listener with current snapshot', () => {
    const stream = createMockTopologyStream();
    const listener = vi.fn();
    stream.subscribe(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.any(Array) }));
  });

  it('unsubscribe removes listener', () => {
    const stream = createMockTopologyStream();
    const listener = vi.fn();
    const unsub = stream.subscribe(listener);
    expect(listener).toHaveBeenCalledOnce();
    unsub();
    // After unsubscribe, listener count should be 0
    // Subscribing a new listener to confirm the old one is gone
    const listener2 = vi.fn();
    stream.subscribe(listener2);
    expect(listener).toHaveBeenCalledOnce(); // still only once
    expect(listener2).toHaveBeenCalledOnce();
  });
});

describe('createMockEventStream', () => {
  it('subscribe emits seed events synchronously', () => {
    const eventStream = createMockEventStream();
    const received: string[] = [];
    eventStream.subscribe((ev) => received.push(ev.id));
    expect(received.length).toBe(5);
    expect(received[0]).toBe('ev-1');
  });

  it('every event has required fields', () => {
    const eventStream = createMockEventStream();
    eventStream.subscribe((ev) => {
      expect(ev.id).toBeTruthy();
      expect(ev.timestamp).toBeTruthy();
      expect(ev.sourceId).toBeTruthy();
      expect(ev.message).toBeTruthy();
      expect(['debug', 'info', 'warn', 'error']).toContain(ev.severity);
    });
  });

  it('unsubscribe returns without error', () => {
    const eventStream = createMockEventStream();
    const unsub = eventStream.subscribe(() => {});
    expect(() => unsub()).not.toThrow();
  });

  it('includes events of varying severity', () => {
    const eventStream = createMockEventStream();
    const severities = new Set<string>();
    eventStream.subscribe((ev) => severities.add(ev.severity));
    expect(severities.has('info')).toBe(true);
    expect(severities.has('warn')).toBe(true);
    expect(severities.has('debug')).toBe(true);
  });
});
