import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createMockRegistryRepository,
  createMockLiveTopologyStream,
  createMockEventStream,
} from './mock';

afterEach(() => {
  vi.useRealTimers();
});

// ── Registry repository ────────────────────────────────────────────────────
// Note: loadRegistry / saveRegistry use real async delays; no fake timers needed.

describe('createMockRegistryRepository', () => {
  it('loads the seed registry with entity types', async () => {
    const repo = createMockRegistryRepository();
    const registry = await repo.loadRegistry();
    expect(registry.types.length).toBeGreaterThan(0);
    expect(registry.version).toBeGreaterThan(0);
    expect(registry.updatedAt).toBeTruthy();
  });

  it('returns all expected categories', async () => {
    const repo = createMockRegistryRepository();
    const registry = await repo.loadRegistry();
    const categories = new Set(registry.types.map((t) => t.category));
    expect(categories).toContain('topology');
    expect(categories).toContain('hardware');
    expect(categories).toContain('agent');
    expect(categories).toContain('coordinator');
    expect(categories).toContain('knowledge');
    expect(categories).toContain('infrastructure');
    expect(categories).toContain('device');
    expect(categories).toContain('composite');
  });

  it('contains realm, cluster, host, raid types', async () => {
    const repo = createMockRegistryRepository();
    const registry = await repo.loadRegistry();
    const ids = registry.types.map((t) => t.id);
    expect(ids).toContain('realm');
    expect(ids).toContain('cluster');
    expect(ids).toContain('host');
    expect(ids).toContain('raid');
  });

  it('saves and reloads a modified registry', async () => {
    const repo = createMockRegistryRepository();
    const original = await repo.loadRegistry();

    const modified = { ...original, version: 999 };
    await repo.saveRegistry(modified);

    const reloaded = await repo.loadRegistry();
    expect(reloaded.version).toBe(999);
  });

  it('two instances share independent state', async () => {
    const repo1 = createMockRegistryRepository();
    const repo2 = createMockRegistryRepository();

    const r1 = await repo1.loadRegistry();
    await repo1.saveRegistry({ ...r1, version: 42 });

    const r2 = await repo2.loadRegistry();
    expect(r2.version).not.toBe(42);
  });
});

// ── Live topology stream ───────────────────────────────────────────────────

describe('createMockLiveTopologyStream', () => {
  it('calls subscriber immediately with seed snapshot', () => {
    vi.useFakeTimers();
    const stream = createMockLiveTopologyStream();
    const onUpdate = vi.fn();
    stream.subscribe(onUpdate);
    expect(onUpdate).toHaveBeenCalledOnce();
    const [snapshot] = onUpdate.mock.calls[0] as [Parameters<typeof onUpdate>[0]];
    expect(snapshot.entities.length).toBeGreaterThan(0);
    expect(snapshot.connections.length).toBeGreaterThan(0);
  });

  it('calls subscriber again after refresh interval', () => {
    vi.useFakeTimers();
    const stream = createMockLiveTopologyStream();
    const onUpdate = vi.fn();
    stream.subscribe(onUpdate);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3001);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops further calls', () => {
    vi.useFakeTimers();
    const stream = createMockLiveTopologyStream();
    const onUpdate = vi.fn();
    const unsubscribe = stream.subscribe(onUpdate);
    unsubscribe();
    vi.advanceTimersByTime(10000);
    expect(onUpdate).toHaveBeenCalledTimes(1); // only the immediate call
  });

  it('snapshot entities include realm and cluster', () => {
    vi.useFakeTimers();
    const stream = createMockLiveTopologyStream();
    const onUpdate = vi.fn();
    stream.subscribe(onUpdate);
    const [snapshot] = onUpdate.mock.calls[0] as [Parameters<typeof onUpdate>[0]];
    const typeIds = snapshot.entities.map((e) => e.typeId);
    expect(typeIds).toContain('realm');
    expect(typeIds).toContain('cluster');
  });
});

// ── Event stream ──────────────────────────────────────────────────────────

describe('createMockEventStream', () => {
  it('does not call subscriber before interval fires', () => {
    vi.useFakeTimers();
    const stream = createMockEventStream();
    const onEvent = vi.fn();
    stream.subscribe(onEvent);
    expect(onEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1999);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('emits an event after the interval', () => {
    vi.useFakeTimers();
    const stream = createMockEventStream();
    const onEvent = vi.fn();
    stream.subscribe(onEvent);
    vi.advanceTimersByTime(2001);
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('emitted event has required shape', () => {
    vi.useFakeTimers();
    const stream = createMockEventStream();
    const onEvent = vi.fn();
    stream.subscribe(onEvent);
    vi.advanceTimersByTime(2001);
    const [event] = onEvent.mock.calls[0] as [Parameters<typeof onEvent>[0]];
    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('time');
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('subject');
    expect(event).toHaveProperty('body');
  });

  it('cycles through all five event sources', () => {
    vi.useFakeTimers();
    const stream = createMockEventStream();
    const onEvent = vi.fn();
    stream.subscribe(onEvent);
    vi.advanceTimersByTime(2001 * 5);
    const types = new Set(
      (onEvent.mock.calls as [Parameters<typeof onEvent>[0]][]).map(([e]) => e.type),
    );
    expect(types.size).toBe(5);
  });

  it('unsubscribe stops event emission', () => {
    vi.useFakeTimers();
    const stream = createMockEventStream();
    const onEvent = vi.fn();
    const unsubscribe = stream.subscribe(onEvent);
    unsubscribe();
    vi.advanceTimersByTime(10000);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
