import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from './useSpeechRecognition';

/** Collected instances for assertions in tests that need to inspect mock internals. */
let mockInstances: MockSpeechRecognition[] = [];

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    mockInstances.push(this);
  }
}

function setWindowSpeechRecognition(
  key: 'SpeechRecognition' | 'webkitSpeechRecognition',
  value: unknown
) {
  (window as Record<string, unknown>)[key] = value;
}

function deleteWindowSpeechRecognition(key: 'SpeechRecognition' | 'webkitSpeechRecognition') {
  delete (window as Record<string, unknown>)[key];
}

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockInstances = [];
  });

  afterEach(() => {
    deleteWindowSpeechRecognition('SpeechRecognition');
    deleteWindowSpeechRecognition('webkitSpeechRecognition');
  });

  describe('isSupported', () => {
    it('should return false when SpeechRecognition is not available', () => {
      const { result } = renderHook(() => useSpeechRecognition());
      expect(result.current.isSupported).toBe(false);
    });

    it('should return true when window.SpeechRecognition is available', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);

      const { result } = renderHook(() => useSpeechRecognition());
      expect(result.current.isSupported).toBe(true);
    });

    it('should return true when window.webkitSpeechRecognition is available (fallback)', () => {
      setWindowSpeechRecognition('webkitSpeechRecognition', MockSpeechRecognition);

      const { result } = renderHook(() => useSpeechRecognition());
      expect(result.current.isSupported).toBe(true);
    });
  });

  describe('startListening', () => {
    it('should do nothing when not supported', () => {
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      expect(result.current.isListening).toBe(false);
      expect(result.current.transcript).toBe('');
      expect(mockInstances).toHaveLength(0);
    });

    it('should create a recognition instance and start it', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);
      expect(result.current.transcript).toBe('');
      expect(mockInstances).toHaveLength(1);
      expect(mockInstances[0].start).toHaveBeenCalledOnce();
      expect(mockInstances[0].continuous).toBe(true);
      expect(mockInstances[0].interimResults).toBe(true);
      expect(mockInstances[0].lang).toBe('en-US');
    });

    it('should abort existing session before starting a new one', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      expect(mockInstances).toHaveLength(1);
      const firstInstance = mockInstances[0];

      act(() => {
        result.current.startListening();
      });

      expect(mockInstances).toHaveLength(2);
      expect(firstInstance.abort).toHaveBeenCalledOnce();
      expect(mockInstances[1].start).toHaveBeenCalledOnce();
    });
  });

  describe('stopListening', () => {
    it('should do nothing when no recognition instance exists', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      // Should not throw
      act(() => {
        result.current.stopListening();
      });

      expect(result.current.isListening).toBe(false);
      expect(mockInstances).toHaveLength(0);
    });

    it('should call stop on the recognition instance', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);
      const instance = mockInstances[0];

      act(() => {
        result.current.stopListening();
      });

      expect(instance.stop).toHaveBeenCalledOnce();
      expect(result.current.isListening).toBe(false);
    });
  });

  describe('onresult handler', () => {
    it('should accumulate final transcripts', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      const instance = mockInstances[0];

      // Simulate a final result
      act(() => {
        instance.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: {
              length: 1,
              isFinal: true,
              0: { transcript: 'hello ', confidence: 0.95 },
            },
          },
        });
      });

      expect(result.current.transcript).toBe('hello ');

      // Simulate another final result (resultIndex moves forward)
      act(() => {
        instance.onresult?.({
          resultIndex: 1,
          results: {
            length: 2,
            0: {
              length: 1,
              isFinal: true,
              0: { transcript: 'hello ', confidence: 0.95 },
            },
            1: {
              length: 1,
              isFinal: true,
              0: { transcript: 'world', confidence: 0.9 },
            },
          },
        });
      });

      expect(result.current.transcript).toBe('hello world');
    });

    it('should show interim results', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      const instance = mockInstances[0];

      // Simulate an interim (non-final) result
      act(() => {
        instance.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: {
              length: 1,
              isFinal: false,
              0: { transcript: 'hel', confidence: 0.5 },
            },
          },
        });
      });

      expect(result.current.transcript).toBe('hel');
    });
  });

  describe('onerror handler', () => {
    it('should ignore aborted errors', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);
      const instance = mockInstances[0];

      act(() => {
        instance.onerror?.({ error: 'aborted', message: '' });
      });

      // isListening should remain true since aborted errors are ignored
      expect(result.current.isListening).toBe(true);
    });

    it('should set isListening to false on other errors', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);
      const instance = mockInstances[0];

      act(() => {
        instance.onerror?.({
          error: 'network',
          message: 'Network error occurred',
        });
      });

      expect(result.current.isListening).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Speech recognition error:',
        'network',
        'Network error occurred'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('onend handler', () => {
    it('should set isListening to false and clear ref', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      expect(result.current.isListening).toBe(true);
      const instance = mockInstances[0];

      act(() => {
        instance.onend?.();
      });

      expect(result.current.isListening).toBe(false);

      // Calling stopListening should do nothing since ref was cleared by onend
      act(() => {
        result.current.stopListening();
      });

      expect(instance.stop).not.toHaveBeenCalled();
    });
  });

  describe('cleanup on unmount', () => {
    it('should call abort on active recognition when unmounted', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);
      const { result, unmount } = renderHook(() => useSpeechRecognition());

      act(() => {
        result.current.startListening();
      });

      const instance = mockInstances[0];
      expect(instance.abort).not.toHaveBeenCalled();

      unmount();

      expect(instance.abort).toHaveBeenCalledOnce();
    });

    it('should not throw when unmounted with no active recognition', () => {
      setWindowSpeechRecognition('SpeechRecognition', MockSpeechRecognition);

      const { unmount } = renderHook(() => useSpeechRecognition());

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });
});
