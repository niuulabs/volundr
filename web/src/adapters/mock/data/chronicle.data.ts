import type { ChronicleEntry } from '@/models';

export const mockChronicle: ChronicleEntry[] = [
  {
    time: '10:47',
    type: 'think',
    agent: 'Odin',
    message: 'Cycle #847291: Analyzing memory pressure in Midgard',
    details: 'analytics-worker pod showing sustained high memory usage',
  },
  {
    time: '10:46',
    type: 'observe',
    agent: 'Sigrun',
    message: 'analytics-worker memory at 85%, approaching threshold',
    severity: 'warning',
  },
  {
    time: '10:45',
    type: 'decide',
    agent: 'Odin',
    message: 'Queuing config change for analytics cron (requires approval)',
    zone: 'yellow',
  },
  {
    time: '10:42',
    type: 'observe',
    agent: 'Brynhildr',
    message: 'GPU #1 entered idle state',
    severity: 'info',
  },
  {
    time: '10:40',
    type: 'act',
    agent: 'Tyr',
    message: 'Assigned ein-valhalla-003 to campaign-001/phase-2',
  },
  {
    time: '10:38',
    type: 'complete',
    agent: 'ein-valhalla-001',
    message: 'Completed: Storage observer interface definition',
  },
  {
    time: '10:35',
    type: 'merge',
    agent: 'Odin',
    message: 'Auto-merged PR #46 to odin-core (confidence: 0.91)',
    zone: 'green',
  },
  {
    time: '10:32',
    type: 'observe',
    agent: 'Gunnr',
    message: 'Bifrost latency nominal: 2.3ms cross-realm',
    severity: 'info',
  },
  {
    time: '10:30',
    type: 'sense',
    agent: 'Huginn',
    message: 'Correlated 47 events, 2 anomalies flagged',
  },
  {
    time: '10:28',
    type: 'checkpoint',
    agent: 'ein-valhalla-004',
    message: 'Context checkpoint saved (89/128k tokens used)',
  },
  {
    time: '10:25',
    type: 'think',
    agent: 'Odin',
    message: 'Cycle #847290: All realms stable, continuing campaign work',
  },
  {
    time: '10:20',
    type: 'mimic',
    agent: 'Odin',
    message: "Consulted Mímir's Well for Kubernetes HPA tuning guidance",
  },
];
