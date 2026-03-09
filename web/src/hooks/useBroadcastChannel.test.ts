import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBroadcastChannel } from './useBroadcastChannel';

let channels: Array<{
  name: string;
  listeners: Map<string, Set<(e: MessageEvent) => void>>;
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, handler: (e: MessageEvent) => void) => void;
  removeEventListener: (type: string, handler: (e: MessageEvent) => void) => void;
}>;

beforeEach(() => {
  channels = [];
  vi.stubGlobal(
    'BroadcastChannel',
    vi.fn().mockImplementation(function (this: unknown, name: string) {
      const listeners = new Map<string, Set<(e: MessageEvent) => void>>();
      const channel = {
        name,
        listeners,
        postMessage: vi.fn(),
        close: vi.fn(),
        addEventListener: (type: string, handler: (e: MessageEvent) => void) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(handler);
        },
        removeEventListener: (type: string, handler: (e: MessageEvent) => void) => {
          listeners.get(type)?.delete(handler);
        },
      };
      channels.push(channel);
      return channel;
    })
  );
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBroadcastChannel', () => {
  it('creates a BroadcastChannel with the given name', () => {
    renderHook(() => useBroadcastChannel('test-channel'));
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('test-channel');
  });

  it('broadcast sends a message with correct structure', () => {
    const { result } = renderHook(() => useBroadcastChannel('test-channel'));

    act(() => {
      result.current.broadcast('update', { value: 42 });
    });

    expect(channels[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update',
        payload: { value: 42 },
        sourceId: 'test-uuid-1234',
      })
    );
  });

  it('subscribe receives messages from other sources', () => {
    const { result } = renderHook(() => useBroadcastChannel('test-channel'));

    const handler = vi.fn();
    act(() => {
      result.current.subscribe(handler);
    });

    // Simulate a message from a different source
    const messageData = {
      type: 'update',
      payload: 'hello',
      timestamp: Date.now(),
      sourceId: 'other-uuid',
    };

    const listeners = channels[0].listeners.get('message');
    listeners?.forEach(listener => listener({ data: messageData } as MessageEvent));

    expect(handler).toHaveBeenCalledWith(messageData);
  });

  it('ignores messages from self', () => {
    const { result } = renderHook(() => useBroadcastChannel('test-channel'));

    const handler = vi.fn();
    act(() => {
      result.current.subscribe(handler);
    });

    // Simulate a message from self (same sourceId)
    const messageData = {
      type: 'update',
      payload: 'hello',
      timestamp: Date.now(),
      sourceId: 'test-uuid-1234',
    };

    const listeners = channels[0].listeners.get('message');
    listeners?.forEach(listener => listener({ data: messageData } as MessageEvent));

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops receiving messages', () => {
    const { result } = renderHook(() => useBroadcastChannel('test-channel'));

    const handler = vi.fn();
    let unsub: () => void;
    act(() => {
      unsub = result.current.subscribe(handler);
    });

    act(() => {
      unsub();
    });

    const messageData = {
      type: 'update',
      payload: 'hello',
      timestamp: Date.now(),
      sourceId: 'other-uuid',
    };

    const listeners = channels[0].listeners.get('message');
    listeners?.forEach(listener => listener({ data: messageData } as MessageEvent));

    expect(handler).not.toHaveBeenCalled();
  });

  it('closes channel on unmount', () => {
    const { unmount } = renderHook(() => useBroadcastChannel('test-channel'));
    unmount();
    expect(channels[0].close).toHaveBeenCalled();
  });
});
