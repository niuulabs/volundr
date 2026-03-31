import type { Memory } from '@/modules/volundr/models';

export const mockMemories: Memory[] = [
  {
    id: 'mem-001',
    type: 'preference',
    content: 'Jozef prefers concise alerts, save details for dashboard',
    confidence: 0.95,
    lastUsed: '2h ago',
    usageCount: 47,
  },
  {
    id: 'mem-002',
    type: 'pattern',
    content: 'Thursday 3pm: CI runners spike from scheduled builds',
    confidence: 0.89,
    lastUsed: '4d ago',
    usageCount: 12,
  },
  {
    id: 'mem-003',
    type: 'fact',
    content: 'Farm repo is read-only for Einherjar - too critical',
    confidence: 1.0,
    lastUsed: '1d ago',
    usageCount: 8,
  },
  {
    id: 'mem-004',
    type: 'outcome',
    content: 'PR #34 auto-merge caused test failure, rolled back successfully',
    confidence: 0.92,
    lastUsed: '5d ago',
    usageCount: 3,
  },
  {
    id: 'mem-005',
    type: 'preference',
    content: 'Morning briefings should include overnight incidents first',
    confidence: 0.88,
    lastUsed: '1d ago',
    usageCount: 31,
  },
];
