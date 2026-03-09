import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardOffset } from './useKeyboardOffset';

describe('useKeyboardOffset', () => {
  let listeners: Map<string, Set<() => void>>;
  let mockViewport: {
    height: number;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    listeners = new Map();

    mockViewport = {
      height: window.innerHeight,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (!listeners.has(event)) {
          listeners.set(event, new Set());
        }
        listeners.get(event)!.add(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        listeners.get(event)?.delete(handler);
      }),
    };

    Object.defineProperty(window, 'visualViewport', {
      value: mockViewport,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it('returns 0 when no keyboard is visible', () => {
    const { result } = renderHook(() => useKeyboardOffset());
    expect(result.current).toBe(0);
  });

  it('returns the keyboard height when viewport shrinks', () => {
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    mockViewport.height = 800;

    const { result } = renderHook(() => useKeyboardOffset());
    expect(result.current).toBe(0);

    // Simulate keyboard appearing (viewport shrinks by 300px)
    act(() => {
      mockViewport.height = 500;
      listeners.get('resize')?.forEach(fn => fn());
    });

    expect(result.current).toBe(300);
  });

  it('returns 0 when visualViewport is not available', () => {
    Object.defineProperty(window, 'visualViewport', {
      value: null,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardOffset());
    expect(result.current).toBe(0);
  });

  it('cleans up event listeners on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardOffset());
    unmount();

    expect(mockViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(mockViewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
