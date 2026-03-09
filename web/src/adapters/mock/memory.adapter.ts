import type { IMemoryService } from '@/ports';
import type { Memory, MemoryStats, MemoryType } from '@/models';
import { mockMemories } from './data';

/**
 * Mock implementation of IMemoryService
 * Returns canned data for development and testing
 */
export class MockMemoryService implements IMemoryService {
  private memories: Memory[] = mockMemories.map(m => ({ ...m }));
  private subscribers: Set<(memories: Memory[]) => void> = new Set();

  async getMemories(): Promise<Memory[]> {
    return this.memories.map(m => ({ ...m }));
  }

  async getMemoriesByType(type: MemoryType): Promise<Memory[]> {
    return this.memories.filter(m => m.type === type).map(m => ({ ...m }));
  }

  async searchMemories(query: string): Promise<Memory[]> {
    const lowerQuery = query.toLowerCase();
    return this.memories
      .filter(m => m.content.toLowerCase().includes(lowerQuery))
      .map(m => ({ ...m }));
  }

  async getStats(): Promise<MemoryStats> {
    return {
      totalMemories: this.memories.length,
      preferences: this.memories.filter(m => m.type === 'preference').length,
      patterns: this.memories.filter(m => m.type === 'pattern').length,
      facts: this.memories.filter(m => m.type === 'fact').length,
      outcomes: this.memories.filter(m => m.type === 'outcome').length,
    };
  }

  subscribe(callback: (memories: Memory[]) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async reinforceMemory(memoryId: string): Promise<void> {
    const memory = this.memories.find(m => m.id === memoryId);
    if (memory) {
      memory.usageCount += 1;
      memory.lastUsed = 'just now';
      this.notifySubscribers();
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    this.memories = this.memories.filter(m => m.id !== memoryId);
    this.notifySubscribers();
  }

  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      callback(this.memories.map(m => ({ ...m })));
    }
  }
}
