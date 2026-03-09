import type { MemoryType } from './status.model';

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;
  lastUsed: string;
  usageCount: number;
}

export interface MemoryStats {
  totalMemories: number;
  preferences: number;
  patterns: number;
  facts: number;
  outcomes: number;
}
