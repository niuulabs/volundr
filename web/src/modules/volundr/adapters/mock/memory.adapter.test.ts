import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockMemoryService } from './memory.adapter';

describe('MockMemoryService', () => {
  let service: MockMemoryService;

  beforeEach(() => {
    service = new MockMemoryService();
  });

  describe('getMemories', () => {
    it('returns array of memories', async () => {
      const memories = await service.getMemories();

      expect(Array.isArray(memories)).toBe(true);
      expect(memories.length).toBeGreaterThan(0);
    });

    it('returns memories with expected properties', async () => {
      const memories = await service.getMemories();
      const memory = memories[0];

      expect(memory.id).toBeDefined();
      expect(memory.type).toBeDefined();
      expect(memory.content).toBeDefined();
      expect(memory.confidence).toBeDefined();
      expect(memory.lastUsed).toBeDefined();
      expect(memory.usageCount).toBeDefined();
    });

    it('returns copies of memories', async () => {
      const memories1 = await service.getMemories();
      const memories2 = await service.getMemories();

      expect(memories1).not.toBe(memories2);
    });
  });

  describe('getMemoriesByType', () => {
    it('filters memories by type', async () => {
      const preferences = await service.getMemoriesByType('preference');

      for (const memory of preferences) {
        expect(memory.type).toBe('preference');
      }
    });

    it('returns copies of filtered memories', async () => {
      const memories1 = await service.getMemoriesByType('preference');
      const memories2 = await service.getMemoriesByType('preference');

      expect(memories1).not.toBe(memories2);
    });
  });

  describe('searchMemories', () => {
    it('searches memories by content', async () => {
      const memories = await service.getMemories();
      const searchTerm = memories[0].content.split(' ')[0];

      const results = await service.searchMemories(searchTerm);

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.content.toLowerCase()).toContain(searchTerm.toLowerCase());
      }
    });

    it('is case-insensitive', async () => {
      const memories = await service.getMemories();
      const searchTerm = memories[0].content.split(' ')[0];

      const resultsLower = await service.searchMemories(searchTerm.toLowerCase());
      const resultsUpper = await service.searchMemories(searchTerm.toUpperCase());

      expect(resultsLower.length).toBe(resultsUpper.length);
    });

    it('returns empty array when no matches', async () => {
      const results = await service.searchMemories('xyznonexistentxyz');

      expect(results).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('returns memory statistics', async () => {
      const stats = await service.getStats();

      expect(stats.totalMemories).toBeDefined();
      expect(stats.preferences).toBeDefined();
      expect(stats.patterns).toBeDefined();
      expect(stats.facts).toBeDefined();
      expect(stats.outcomes).toBeDefined();
    });

    it('stats total equals sum of types', async () => {
      const stats = await service.getStats();

      expect(stats.totalMemories).toBe(
        stats.preferences + stats.patterns + stats.facts + stats.outcomes
      );
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('notifies subscribers when memory is reinforced', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      const memories = await service.getMemories();
      await service.reinforceMemory(memories[0].id);

      expect(callback).toHaveBeenCalled();
    });

    it('notifies subscribers when memory is deleted', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      const memories = await service.getMemories();
      await service.deleteMemory(memories[0].id);

      expect(callback).toHaveBeenCalled();
    });

    it('stops notifying after unsubscribe', async () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);
      unsubscribe();

      const memories = await service.getMemories();
      await service.reinforceMemory(memories[0].id);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('reinforceMemory', () => {
    it('increments usageCount', async () => {
      const memories = await service.getMemories();
      const memoryId = memories[0].id;
      const originalCount = memories[0].usageCount;

      await service.reinforceMemory(memoryId);

      const memoriesAfter = await service.getMemories();
      const updated = memoriesAfter.find(m => m.id === memoryId);
      expect(updated?.usageCount).toBe(originalCount + 1);
    });

    it('updates lastUsed to "just now"', async () => {
      const memories = await service.getMemories();
      const memoryId = memories[0].id;

      await service.reinforceMemory(memoryId);

      const memoriesAfter = await service.getMemories();
      const updated = memoriesAfter.find(m => m.id === memoryId);
      expect(updated?.lastUsed).toBe('just now');
    });

    it('does nothing for non-existent memory', async () => {
      // Should not throw
      await service.reinforceMemory('non-existent-id');
    });
  });

  describe('deleteMemory', () => {
    it('removes memory from the list', async () => {
      const memories = await service.getMemories();
      const memoryId = memories[0].id;
      const originalCount = memories.length;

      await service.deleteMemory(memoryId);

      const memoriesAfter = await service.getMemories();
      expect(memoriesAfter.length).toBe(originalCount - 1);
      expect(memoriesAfter.find(m => m.id === memoryId)).toBeUndefined();
    });

    it('does nothing for non-existent memory', async () => {
      const memories = await service.getMemories();
      const originalCount = memories.length;

      await service.deleteMemory('non-existent-id');

      const memoriesAfter = await service.getMemories();
      expect(memoriesAfter.length).toBe(originalCount);
    });
  });
});
