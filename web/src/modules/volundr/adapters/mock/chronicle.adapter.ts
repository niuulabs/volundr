import type { IChronicleService } from '@/modules/volundr/ports';
import type { ChronicleEntry, ChronicleType } from '@/modules/volundr/models';
import { mockChronicle } from './data';

/**
 * Mock implementation of IChronicleService
 * Returns canned data for development and testing
 */
export class MockChronicleService implements IChronicleService {
  private entries: ChronicleEntry[] = [...mockChronicle];
  private subscribers: Set<(entry: ChronicleEntry) => void> = new Set();

  async getEntries(limit = 50): Promise<ChronicleEntry[]> {
    return this.entries.slice(0, limit).map(e => ({ ...e }));
  }

  async getEntriesByType(type: ChronicleType, limit = 50): Promise<ChronicleEntry[]> {
    return this.entries
      .filter(e => e.type === type)
      .slice(0, limit)
      .map(e => ({ ...e }));
  }

  async getEntriesByAgent(agent: string, limit = 50): Promise<ChronicleEntry[]> {
    return this.entries
      .filter(e => e.agent === agent)
      .slice(0, limit)
      .map(e => ({ ...e }));
  }

  subscribe(callback: (entry: ChronicleEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
}
