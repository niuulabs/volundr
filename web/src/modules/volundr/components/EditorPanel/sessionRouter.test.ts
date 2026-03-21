import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getActiveRoute,
  setActiveRoute,
  trackWebSocket,
  closeAllWebSockets,
  resetSessionRouter,
} from './sessionRouter';

function createMockWebSocket(): WebSocket {
  const listeners: Record<string, Set<EventListener>> = {};
  return {
    close: vi.fn(() => {
      listeners['close']?.forEach(l => l(new Event('close')));
    }),
    addEventListener: vi.fn((event: string, listener: EventListener) => {
      if (!listeners[event]) listeners[event] = new Set();
      listeners[event].add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: EventListener) => {
      listeners[event]?.delete(listener);
    }),
  } as unknown as WebSocket;
}

describe('sessionRouter', () => {
  beforeEach(() => {
    resetSessionRouter();
  });

  it('should start with no active route', () => {
    expect(getActiveRoute()).toBeNull();
  });

  it('should set and get active route', () => {
    setActiveRoute({ sessionId: 'abc', hostname: 'pod-1.example.com' });

    expect(getActiveRoute()).toEqual({
      sessionId: 'abc',
      hostname: 'pod-1.example.com',
    });
  });

  it('should update active route on subsequent calls', () => {
    setActiveRoute({ sessionId: 'abc', hostname: 'pod-1.example.com' });
    setActiveRoute({ sessionId: 'def', hostname: 'pod-2.example.com', basePath: '/s/def/' });

    expect(getActiveRoute()).toEqual({
      sessionId: 'def',
      hostname: 'pod-2.example.com',
      basePath: '/s/def/',
    });
  });

  it('should track and close WebSocket connections', () => {
    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();

    trackWebSocket(ws1);
    trackWebSocket(ws2);

    closeAllWebSockets();

    expect(ws1.close).toHaveBeenCalledTimes(1);
    expect(ws2.close).toHaveBeenCalledTimes(1);
  });

  it('should remove WebSocket from tracking when it closes', () => {
    const ws = createMockWebSocket();
    trackWebSocket(ws);

    // Simulate the close event — the close listener registered by trackWebSocket
    // should remove the ws from the tracked set.
    ws.close();

    // Calling closeAll again should NOT call close on the already-closed ws.
    closeAllWebSockets();

    // close() was called once from the explicit call, not again from closeAll.
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it('should reset all state', () => {
    setActiveRoute({ sessionId: 'abc', hostname: 'pod.example.com' });
    const ws = createMockWebSocket();
    trackWebSocket(ws);

    resetSessionRouter();

    expect(getActiveRoute()).toBeNull();

    // closeAll after reset should not close the previously tracked ws.
    closeAllWebSockets();
    expect(ws.close).not.toHaveBeenCalled();
  });
});
