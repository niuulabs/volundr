import { useState, useEffect, useCallback } from 'react';
import type { Memory, MemoryStats, MemoryType } from '@/models';
import { memoryService } from '@/adapters';

interface UseMemoriesResult {
  memories: Memory[];
  stats: MemoryStats | null;
  loading: boolean;
  error: Error | null;
  filter: MemoryType | 'all';
  setFilter: (filter: MemoryType | 'all') => void;
  searchMemories: (query: string) => Promise<Memory[]>;
  reinforceMemory: (memoryId: string) => Promise<void>;
  deleteMemory: (memoryId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMemories(): UseMemoriesResult {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [memoriesData, statsData] = await Promise.all([
        filter === 'all' ? memoryService.getMemories() : memoryService.getMemoriesByType(filter),
        memoryService.getStats(),
      ]);
      setMemories(memoriesData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch memories'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();

    const unsubscribe = memoryService.subscribe(newMemories => {
      setMemories(newMemories);
    });

    return unsubscribe;
  }, [fetchData]);

  const handleSetFilter = useCallback((newFilter: MemoryType | 'all') => {
    setFilter(newFilter);
  }, []);

  const searchMemories = useCallback(async (query: string) => {
    return memoryService.searchMemories(query);
  }, []);

  const reinforceMemory = useCallback(async (memoryId: string) => {
    await memoryService.reinforceMemory(memoryId);
    setMemories(prev =>
      prev.map(m =>
        m.id === memoryId ? { ...m, confidence: Math.min(1, m.confidence + 0.05) } : m
      )
    );
  }, []);

  const deleteMemory = useCallback(async (memoryId: string) => {
    await memoryService.deleteMemory(memoryId);
    setMemories(prev => prev.filter(m => m.id !== memoryId));
  }, []);

  return {
    memories,
    stats,
    loading,
    error,
    filter,
    setFilter: handleSetFilter,
    searchMemories,
    reinforceMemory,
    deleteMemory,
    refresh: fetchData,
  };
}
