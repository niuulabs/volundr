import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSessionProbe } from './useSessionStartingPoll';

const mockGetAccessToken = vi.fn<() => string | null>(() => null);
vi.mock('@/adapters/api/client', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

interface MockWsInstance {
  url: string;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
}

let mockInstances: MockWsInstance[];

class MockWebSocket {
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    mockInstances.push(this);
  }
}

describe('useSessionProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInstances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does nothing when url is null', () => {
    renderHook(() =>
      useSessionProbe({
        url: null,
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(0);
  });

  it('does nothing when not enabled', () => {
    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: false,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(0);
  });

  it('creates WebSocket when enabled and url provided', () => {
    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(1);
  });

  it('calls onReady when WebSocket opens successfully', () => {
    const onReady = vi.fn();

    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady,
      })
    );

    expect(mockInstances).toHaveLength(1);

    act(() => {
      mockInstances[0].onopen?.(new Event('open'));
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(mockInstances[0].close).toHaveBeenCalled();
  });

  it('retries after error', () => {
    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(1);

    act(() => {
      mockInstances[0].onerror?.(new Event('error'));
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockInstances).toHaveLength(2);
  });

  it('retries after close', () => {
    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(1);

    act(() => {
      mockInstances[0].onclose?.(new CloseEvent('close'));
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockInstances).toHaveLength(2);
  });

  it('retries after timeout', () => {
    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(1);

    // Advance past PROBE_TIMEOUT_MS (3000) without triggering open
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockInstances[0].close).toHaveBeenCalled();

    // Advance by PROBE_INTERVAL_MS to trigger the retry
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockInstances).toHaveLength(2);
  });

  it('stops probing when unmounted', () => {
    const { unmount } = renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(1);

    act(() => {
      mockInstances[0].onerror?.(new Event('error'));
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // No new WebSocket should have been created after unmount
    expect(mockInstances).toHaveLength(1);
  });

  it('retries on WebSocket constructor exception', () => {
    let callCount = 0;

    // Replace the stub with a throwing constructor for the first call
    vi.stubGlobal(
      'WebSocket',
      class ThrowOnceWebSocket extends MockWebSocket {
        constructor() {
          callCount++;
          if (callCount === 1) {
            throw new Error('Invalid URL');
          }
          super();
        }
      }
    );

    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    // First call threw, no instance created
    expect(mockInstances).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Second call should succeed
    expect(mockInstances).toHaveLength(1);
  });

  it('appends access_token query param when token is available', () => {
    mockGetAccessToken.mockReturnValue('my-jwt-token');

    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].url).toBe('wss://host/session?access_token=my-jwt-token');
  });

  it('does not append token when getAccessToken returns null', () => {
    mockGetAccessToken.mockReturnValue(null);

    renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady: vi.fn(),
      })
    );

    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].url).toBe('wss://host/session');
  });

  it('does not call onReady after unmount', () => {
    const onReady = vi.fn();

    const { unmount } = renderHook(() =>
      useSessionProbe({
        url: 'wss://host/session',
        enabled: true,
        onReady,
      })
    );

    expect(mockInstances).toHaveLength(1);
    const ws = mockInstances[0];

    unmount();

    // The hook's cleanup sets cancelled = true and nulls out the ws handlers
    // onopen should have been set to null by cleanup()
    // But even if it wasn't, the cancelled flag prevents onReady from firing
    if (ws.onopen) {
      act(() => {
        ws.onopen?.(new Event('open'));
      });
    }

    expect(onReady).not.toHaveBeenCalled();
  });
});
