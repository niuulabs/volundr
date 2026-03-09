import type { OdinState } from '@/models';

export const mockOdinState: OdinState = {
  status: 'thinking',
  loopCycle: 847291,
  loopPhase: 'THINK',
  loopProgress: 65,
  currentThought:
    'The migration proceeds well. I notice the analytics pod still strains against its memory bounds. Someone changed a date parameter last week—I suspect unintentionally.',
  attention: {
    primary: 'Storage migration to Valhalla',
    secondary: ['Memory pressure in Midgard', 'Idle GPUs available'],
  },
  disposition: {
    alertness: 0.7,
    concern: 0.3,
    creativity: 0.5,
  },
  circadianMode: 'active',
  resources: {
    idleGPUs: 4,
    totalGPUs: 8,
    availableCapacity: 35,
  },
  stats: {
    realmsHealthy: 4,
    realmsTotal: 5,
    activeCampaigns: 2,
    einherjarWorking: 5,
    einherjarTotal: 7,
    observationsToday: 1247,
    decisionsToday: 89,
    actionsToday: 34,
  },
  pendingDecisions: [
    {
      id: 'dec-1',
      type: 'merge',
      description: 'Merge PR #47 to odin-valkyries main',
      confidence: 0.82,
      threshold: 0.85,
      zone: 'yellow',
    },
    {
      id: 'dec-2',
      type: 'config',
      description: 'Update analytics cron: date_range "all" → "30d"',
      zone: 'yellow',
    },
  ],
};
