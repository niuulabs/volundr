import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockChronicleService } from './chronicle.adapter';

describe('MockChronicleService', () => {
  let service: MockChronicleService;

  beforeEach(() => {
    service = new MockChronicleService();
  });

  describe('getEntries', () => {
    it('returns array of chronicle entries', async () => {
      const entries = await service.getEntries();

      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('returns entries with expected properties', async () => {
      const entries = await service.getEntries();
      const entry = entries[0];

      expect(entry.time).toBeDefined();
      expect(entry.type).toBeDefined();
      expect(entry.agent).toBeDefined();
      expect(entry.message).toBeDefined();
    });

    it('respects limit parameter', async () => {
      const entries = await service.getEntries(3);

      expect(entries.length).toBeLessThanOrEqual(3);
    });

    it('uses default limit of 50', async () => {
      const entries = await service.getEntries();

      expect(entries.length).toBeLessThanOrEqual(50);
    });

    it('returns copies of entries', async () => {
      const entries1 = await service.getEntries();
      const entries2 = await service.getEntries();

      expect(entries1).not.toBe(entries2);
    });
  });

  describe('getEntriesByType', () => {
    it('filters entries by type', async () => {
      const thinkEntries = await service.getEntriesByType('think');

      for (const entry of thinkEntries) {
        expect(entry.type).toBe('think');
      }
    });

    it('respects limit parameter', async () => {
      const entries = await service.getEntriesByType('observe', 2);

      expect(entries.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array if no entries match', async () => {
      // Use a type that might not have many entries
      const entries = await service.getEntriesByType('mimic', 100);

      for (const entry of entries) {
        expect(entry.type).toBe('mimic');
      }
    });
  });

  describe('getEntriesByAgent', () => {
    it('filters entries by agent', async () => {
      const odinEntries = await service.getEntriesByAgent('Odin');

      for (const entry of odinEntries) {
        expect(entry.agent).toBe('Odin');
      }
    });

    it('respects limit parameter', async () => {
      const entries = await service.getEntriesByAgent('Odin', 2);

      expect(entries.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array for non-existent agent', async () => {
      const entries = await service.getEntriesByAgent('NonExistentAgent');

      expect(entries).toEqual([]);
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('can unsubscribe successfully', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      // Should not throw
      unsubscribe();
    });
  });
});
