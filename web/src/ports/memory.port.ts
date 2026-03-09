import type { Memory, MemoryStats, MemoryType } from '@/models';

/**
 * Port interface for Memory service (Muninn)
 * Manages long-term memory and learning
 */
export interface IMemoryService {
  /**
   * Get all memories
   */
  getMemories(): Promise<Memory[]>;

  /**
   * Get memories by type
   */
  getMemoriesByType(type: MemoryType): Promise<Memory[]>;

  /**
   * Search memories by content
   */
  searchMemories(query: string): Promise<Memory[]>;

  /**
   * Get memory statistics
   */
  getStats(): Promise<MemoryStats>;

  /**
   * Subscribe to memory updates
   * @returns Unsubscribe function
   */
  subscribe(callback: (memories: Memory[]) => void): () => void;

  /**
   * Mark a memory as useful (reinforcement)
   */
  reinforceMemory(memoryId: string): Promise<void>;

  /**
   * Delete a memory
   */
  deleteMemory(memoryId: string): Promise<void>;
}
