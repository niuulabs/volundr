import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useChronicle } from './useChronicle';
import { chronicleService } from '@/adapters';
import type { ChronicleEntry } from '@/models';

vi.mock('@/adapters', () => ({
  chronicleService: {
    getEntries: vi.fn(),
    getEntriesByType: vi.fn(),
    getEntriesByAgent: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

const mockEntries: ChronicleEntry[] = [
  {
    time: '10:47',
    type: 'think',
    agent: 'Odin',
    message: 'Analyzing memory pressure in Midgard',
    details: 'analytics-worker pod showing high memory usage',
  },
  {
    time: '10:46',
    type: 'observe',
    agent: 'Sigrun',
    message: 'analytics-worker memory at 85%',
    severity: 'warning',
  },
];

describe('useChronicle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chronicleService.getEntries).mockResolvedValue(mockEntries);
    vi.mocked(chronicleService.getEntriesByType).mockResolvedValue([mockEntries[0]]);
    vi.mocked(chronicleService.getEntriesByAgent).mockResolvedValue([mockEntries[0]]);
  });

  it('should fetch entries on mount', async () => {
    const { result } = renderHook(() => useChronicle());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.entries).toEqual(mockEntries);
    expect(result.current.error).toBeNull();
  });

  it('should respect limit parameter', async () => {
    const { result } = renderHook(() => useChronicle(10));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(chronicleService.getEntries).toHaveBeenCalledWith(10);
  });

  it('should handle fetch error', async () => {
    vi.mocked(chronicleService.getEntries).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useChronicle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should subscribe to updates', async () => {
    const { result } = renderHook(() => useChronicle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(chronicleService.subscribe).toHaveBeenCalled();
  });

  it('should filter by type', async () => {
    const { result } = renderHook(() => useChronicle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filter).toBe('all');

    act(() => {
      result.current.setFilter('think');
    });

    await waitFor(() => {
      expect(result.current.filter).toBe('think');
    });

    expect(chronicleService.getEntriesByType).toHaveBeenCalledWith('think', undefined);
  });

  it('should get entries by agent', async () => {
    const { result } = renderHook(() => useChronicle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const entries = await result.current.getEntriesByAgent('Odin', 5);
    expect(entries).toHaveLength(1);
    expect(chronicleService.getEntriesByAgent).toHaveBeenCalledWith('Odin', 5);
  });

  it('should refresh entries', async () => {
    const { result } = renderHook(() => useChronicle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(chronicleService.getEntries).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(chronicleService.getEntries).mockRejectedValue('string error');

    const { result } = renderHook(() => useChronicle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch chronicle');
  });

  it('should limit entries from subscriber updates', async () => {
    let subscriberCallback: (entry: ChronicleEntry) => void = () => {};
    vi.mocked(chronicleService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useChronicle(2));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newEntry: ChronicleEntry = {
      time: '10:48',
      type: 'act',
      agent: 'Tyr',
      message: 'Deploying hotfix',
    };

    act(() => {
      subscriberCallback(newEntry);
    });

    expect(result.current.entries.length).toBeLessThanOrEqual(2);
  });

  it('should not limit entries from subscriber when no limit', async () => {
    let subscriberCallback: (entry: ChronicleEntry) => void = () => {};
    vi.mocked(chronicleService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useChronicle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newEntry: ChronicleEntry = {
      time: '10:48',
      type: 'act',
      agent: 'Tyr',
      message: 'Deploying hotfix',
    };

    act(() => {
      subscriberCallback(newEntry);
    });

    expect(result.current.entries.length).toBe(mockEntries.length + 1);
  });
});
