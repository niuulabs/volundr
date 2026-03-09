import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMemories } from './useMemories';
import { memoryService } from '@/adapters';
import type { Memory, MemoryStats } from '@/models';

vi.mock('@/adapters', () => ({
  memoryService: {
    getMemories: vi.fn(),
    getMemoriesByType: vi.fn(),
    searchMemories: vi.fn(),
    getStats: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    reinforceMemory: vi.fn(),
    deleteMemory: vi.fn(),
  },
}));

const mockMemories: Memory[] = [
  {
    id: 'mem-001',
    type: 'preference',
    content: 'Jozef prefers concise alerts',
    confidence: 0.95,
    lastUsed: '2h ago',
    usageCount: 47,
  },
  {
    id: 'mem-002',
    type: 'pattern',
    content: 'Thursday 3pm CI spike',
    confidence: 0.89,
    lastUsed: '4d ago',
    usageCount: 12,
  },
];

const mockStats: MemoryStats = {
  totalMemories: 156,
  preferences: 23,
  patterns: 45,
  facts: 67,
  outcomes: 21,
  averageConfidence: 0.87,
  memoriesAddedThisMonth: 12,
};

describe('useMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(memoryService.getMemories).mockResolvedValue(mockMemories);
    vi.mocked(memoryService.getMemoriesByType).mockResolvedValue([mockMemories[0]]);
    vi.mocked(memoryService.searchMemories).mockResolvedValue([mockMemories[0]]);
    vi.mocked(memoryService.getStats).mockResolvedValue(mockStats);
  });

  it('should fetch memories and stats on mount', async () => {
    const { result } = renderHook(() => useMemories());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.memories).toEqual(mockMemories);
    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(memoryService.getMemories).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should subscribe to updates', async () => {
    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(memoryService.subscribe).toHaveBeenCalled();
  });

  it('should filter by type', async () => {
    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.filter).toBe('all');

    act(() => {
      result.current.setFilter('preference');
    });

    await waitFor(() => {
      expect(result.current.filter).toBe('preference');
    });

    expect(memoryService.getMemoriesByType).toHaveBeenCalledWith('preference');
  });

  it('should search memories', async () => {
    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const results = await result.current.searchMemories('concise');
    expect(results).toHaveLength(1);
    expect(memoryService.searchMemories).toHaveBeenCalledWith('concise');
  });

  it('should reinforce memory', async () => {
    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.reinforceMemory('mem-001');
    });

    expect(memoryService.reinforceMemory).toHaveBeenCalledWith('mem-001');
    expect(result.current.memories[0].confidence).toBe(1);
  });

  it('should delete memory', async () => {
    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteMemory('mem-001');
    });

    expect(memoryService.deleteMemory).toHaveBeenCalledWith('mem-001');
    expect(result.current.memories).toHaveLength(1);
    expect(result.current.memories[0].id).toBe('mem-002');
  });

  it('should refresh memories', async () => {
    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(memoryService.getMemories).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(memoryService.getMemories).mockRejectedValue('string error');

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch memories');
  });

  it('should update memories from subscriber', async () => {
    let subscriberCallback: (memories: Memory[]) => void = () => {};
    vi.mocked(memoryService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newMemories = [{ ...mockMemories[0], content: 'Updated content' }];

    act(() => {
      subscriberCallback(newMemories);
    });

    expect(result.current.memories[0].content).toBe('Updated content');
  });
});
