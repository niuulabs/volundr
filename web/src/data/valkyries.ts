import type { ValkyrieInfo } from '@/models';

/**
 * Static Valkyrie-to-Realm mapping.
 *
 * Valkyries are not yet served by an API. This registry provides stubbed
 * data so the UI can display them. When the Valkyrie services come online
 * this will be replaced by a real adapter call.
 */
export const VALKYRIE_REGISTRY: Record<string, ValkyrieInfo> = {
  vanaheim: {
    name: 'Brynhildr',
    status: 'observing',
    uptime: '--',
    observationsToday: 0,
    specialty: 'Production workloads',
  },
  valhalla: {
    name: 'Sigrdrifa',
    status: 'observing',
    uptime: '--',
    observationsToday: 0,
    specialty: 'AI/ML workloads',
  },
  glitnir: {
    name: 'Mist',
    status: 'observing',
    uptime: '--',
    observationsToday: 0,
    specialty: 'Observability & metrics',
  },
  jarnvidr: {
    name: 'Svipul',
    status: 'observing',
    uptime: '--',
    observationsToday: 0,
    specialty: 'Media processing',
  },
  eitri: {
    name: 'Hildr',
    status: 'observing',
    uptime: '--',
    observationsToday: 0,
    specialty: 'Workshop & forge',
  },
  ymir: {
    name: 'G\u00f6ndul',
    status: 'observing',
    uptime: '--',
    observationsToday: 0,
    specialty: 'Bootstrap',
  },
};

/**
 * Look up the Valkyrie assigned to a realm.
 * Returns null for unknown realm IDs.
 */
export function getValkyrieForRealm(realmId: string): ValkyrieInfo | null {
  return VALKYRIE_REGISTRY[realmId] ?? null;
}
