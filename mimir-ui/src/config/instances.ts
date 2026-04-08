import type { MimirInstance } from '@/domain';

const DEFAULT_INSTANCES: MimirInstance[] = [
  {
    name: 'local',
    url: 'http://localhost:7477/mimir',
    role: 'local',
    writeEnabled: true,
  },
];

/**
 * Load Mímir instance configuration from the VITE_MIMIR_INSTANCES environment
 * variable (JSON array) or fall back to the default local instance.
 */
export function loadInstances(): MimirInstance[] {
  const raw = import.meta.env['VITE_MIMIR_INSTANCES'] as string | undefined;
  if (!raw) {
    return DEFAULT_INSTANCES;
  }
  try {
    return JSON.parse(raw) as MimirInstance[];
  } catch {
    console.warn('Failed to parse VITE_MIMIR_INSTANCES — using defaults');
    return DEFAULT_INSTANCES;
  }
}
