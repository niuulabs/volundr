import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollingEventAdapter } from '@/adapters/events/PollingEventAdapter';

function makeFetchWithEntries(entries: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ entries }),
  });
}

describe('PollingEventAdapter', () => {
  let adapter: PollingEventAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new PollingEventAdapter('http://localhost:7477/mimir/log', 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('subscribe()', () => {
    it('returns an unsubscribe function', () => {
      vi.stubGlobal('fetch', makeFetchWithEntries([]));
      const unsub = adapter.subscribe(vi.fn());
      expect(typeof unsub).toBe('function');
    });

    it('starts polling after subscribe', () => {
      const fetchMock = makeFetchWithEntries([]);
      vi.stubGlobal('fetch', fetchMock);

      adapter.subscribe(vi.fn());

      vi.advanceTimersByTime(1000);

      expect(fetchMock).toHaveBeenCalled();
    });

    it('polls repeatedly at the configured interval', async () => {
      const fetchMock = makeFetchWithEntries([]);
      vi.stubGlobal('fetch', fetchMock);

      adapter.subscribe(vi.fn());

      vi.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('dispatching events on new log entries', () => {
    it('dispatches events for new log entries on poll', async () => {
      const fetchMock = makeFetchWithEntries(['## 2026-04-08 Ingestion complete']);
      vi.stubGlobal('fetch', fetchMock);

      const handler = vi.fn();
      adapter.subscribe(handler);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).toHaveBeenCalledOnce();
      // "Ingestion complete" classifies as ingest_complete per keyword rules
      expect(handler.mock.calls[0][0].type).toBe('ingest_complete');
      expect(handler.mock.calls[0][0].message).toBe('## 2026-04-08 Ingestion complete');
    });

    it('dispatches one event per new entry', async () => {
      const fetchMock = makeFetchWithEntries([
        '## Entry 1',
        '## Entry 2',
        '## Entry 3',
      ]);
      vi.stubGlobal('fetch', fetchMock);

      const handler = vi.fn();
      adapter.subscribe(handler);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('does not dispatch for unchanged entry count', async () => {
      const entries = ['## 2026-04-08 Ingestion complete'];
      const fetchMock = makeFetchWithEntries(entries);
      vi.stubGlobal('fetch', fetchMock);

      const handler = vi.fn();
      adapter.subscribe(handler);

      // First poll — 1 new entry dispatched
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      handler.mockClear();

      // Second poll — same entries, nothing new
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
    });

    it('only dispatches newly added entries on subsequent polls', async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++;
        const entries =
          callCount === 1 ? ['## Entry 1'] : ['## Entry 1', '## Entry 2'];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ entries }),
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const handler = vi.fn();
      adapter.subscribe(handler);

      // First poll
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      // Second poll
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      // Only Entry 2 should be dispatched in the second poll
      const messages = handler.mock.calls.map((c) => c[0].message);
      expect(messages.filter((m) => m === '## Entry 2')).toHaveLength(1);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('includes timestamp in dispatched events', async () => {
      vi.stubGlobal('fetch', makeFetchWithEntries(['## Entry']));

      const handler = vi.fn();
      adapter.subscribe(handler);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler.mock.calls[0][0].timestamp).toBeDefined();
    });
  });

  describe('unsubscribe', () => {
    it('stops polling after unsubscribe', async () => {
      const fetchMock = makeFetchWithEntries([]);
      vi.stubGlobal('fetch', fetchMock);

      const unsub = adapter.subscribe(vi.fn());

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      const callsBeforeUnsub = fetchMock.mock.calls.length;

      unsub();

      vi.advanceTimersByTime(3000);
      await Promise.resolve();

      expect(fetchMock.mock.calls.length).toBe(callsBeforeUnsub);
    });

    it('does not stop polling when other handlers remain', async () => {
      const fetchMock = makeFetchWithEntries([]);
      vi.stubGlobal('fetch', fetchMock);

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const unsub1 = adapter.subscribe(handler1);
      adapter.subscribe(handler2);

      unsub1();

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('isConnected()', () => {
    it('returns false before subscribe', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after subscribe', () => {
      vi.stubGlobal('fetch', makeFetchWithEntries([]));
      adapter.subscribe(vi.fn());
      expect(adapter.isConnected()).toBe(true);
    });

    it('returns false after all handlers unsubscribe', () => {
      vi.stubGlobal('fetch', makeFetchWithEntries([]));
      const unsub = adapter.subscribe(vi.fn());
      unsub();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('does not throw when fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network error')),
      );

      adapter.subscribe(vi.fn());

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      // Should not throw — no assertion needed beyond not throwing
      expect(adapter.isConnected()).toBe(true);
    });

    it('does not throw when fetch returns non-ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        }),
      );

      const handler = vi.fn();
      adapter.subscribe(handler);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
