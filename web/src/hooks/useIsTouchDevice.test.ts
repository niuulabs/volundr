import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsTouchDevice } from './useIsTouchDevice';

describe('useIsTouchDevice', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Reset to non-touch desktop by default
    Object.defineProperty(window, 'ontouchstart', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: originalInnerWidth,
      writable: true,
      configurable: true,
    });
  });

  it('returns false on desktop (no touch, wide viewport)', () => {
    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);
  });

  it('returns true on touch device with narrow viewport', () => {
    Object.defineProperty(window, 'ontouchstart', {
      value: () => {},
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 768,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
  });

  it('returns false on touch device with wide viewport', () => {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 5,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);
  });

  it('updates on window resize', () => {
    Object.defineProperty(window, 'ontouchstart', {
      value: () => {},
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);

    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        value: 800,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toBe(true);
  });

  it('respects custom maxWidth parameter', () => {
    Object.defineProperty(window, 'ontouchstart', {
      value: () => {},
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 600,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useIsTouchDevice(500));
    expect(result.current).toBe(false);
  });

  it('detects touch via maxTouchPoints when ontouchstart is absent', () => {
    // Remove ontouchstart from window
    delete (window as Record<string, unknown>).ontouchstart;
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 5,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 768,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
  });
});
