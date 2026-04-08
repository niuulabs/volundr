import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketEventAdapter } from '@/adapters/events/WebSocketEventAdapter';
import type { MimirEvent } from '@/ports';

// Controllable WebSocket mock
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  readyState = 0;
  closeCalled = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closeCalled = true;
    if (this.onclose) {
      this.onclose();
    }
  }

  simulateOpen() {
    this.readyState = 1;
    if (this.onopen) {
      this.onopen();
    }
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror();
    }
  }

  simulateClose() {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose();
    }
  }
}

describe('WebSocketEventAdapter', () => {
  let adapter: WebSocketEventAdapter;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    adapter = new WebSocketEventAdapter('ws://localhost:7477/ws');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('subscribe()', () => {
    it('returns an unsubscribe function', () => {
      const unsub = adapter.subscribe(vi.fn());
      expect(typeof unsub).toBe('function');
    });

    it('creates a WebSocket connection on subscribe', () => {
      adapter.subscribe(vi.fn());
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('ws://localhost:7477/ws');
    });

    it('does not create a second WebSocket on second subscribe', () => {
      adapter.subscribe(vi.fn());
      adapter.subscribe(vi.fn());
      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

  describe('dispatching events', () => {
    it('dispatches parsed events to handlers', () => {
      const handler = vi.fn();
      adapter.subscribe(handler);

      const event: MimirEvent = {
        type: 'page_updated',
        message: 'Updated page',
        timestamp: '2026-04-08T12:00:00Z',
      };

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage(JSON.stringify(event));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('dispatches to all subscribed handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      adapter.subscribe(handler1);
      adapter.subscribe(handler2);

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage(
        JSON.stringify({ type: 'page_updated', timestamp: '2026-04-08T12:00:00Z' }),
      );

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('ignores malformed JSON messages', () => {
      const handler = vi.fn();
      adapter.subscribe(handler);

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage('this is not json {{{');

      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores empty string messages', () => {
      const handler = vi.fn();
      adapter.subscribe(handler);

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage('');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('removes handler after unsubscribe', () => {
      const handler = vi.fn();
      const unsub = adapter.subscribe(handler);

      unsub();

      const ws = MockWebSocket.instances[0];
      ws.simulateMessage(
        JSON.stringify({ type: 'page_updated', timestamp: '2026-04-08T12:00:00Z' }),
      );

      expect(handler).not.toHaveBeenCalled();
    });

    it('closes WebSocket when last handler unsubscribes', () => {
      const handler = vi.fn();
      const unsub = adapter.subscribe(handler);

      const ws = MockWebSocket.instances[0];
      unsub();

      expect(ws.closeCalled).toBe(true);
    });

    it('does not close WebSocket when other handlers remain', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const unsub1 = adapter.subscribe(handler1);
      adapter.subscribe(handler2);

      const ws = MockWebSocket.instances[0];
      unsub1();

      expect(ws.closeCalled).toBe(false);
    });
  });

  describe('isConnected()', () => {
    it('returns false initially before WS open event', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns false before subscribing', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after WS open event', () => {
      adapter.subscribe(vi.fn());
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      expect(adapter.isConnected()).toBe(true);
    });

    it('returns false after WS close event', () => {
      adapter.subscribe(vi.fn());
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateClose();
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns false after WS error event', () => {
      adapter.subscribe(vi.fn());
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateError();
      expect(adapter.isConnected()).toBe(false);
    });
  });
});
