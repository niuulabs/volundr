import type { Connection } from './connections';

/**
 * All valid activity states for a topology entity.
 *
 * @canonical Observatory — entity drawer status row, canvas node coloring.
 */
export const ENTITY_STATUSES = [
  'healthy',
  'running',
  'observing',
  'merged',
  'attention',
  'review',
  'queued',
  'processing',
  'deciding',
  'failed',
  'degraded',
  'unknown',
  'idle',
  'archived',
] as const;

export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export function isEntityStatus(value: string): value is EntityStatus {
  return (ENTITY_STATUSES as readonly string[]).includes(value);
}

/**
 * A live topology entity — a runtime instance of an EntityType.
 *
 * `typeId` references `EntityType.id` in the TypeRegistry.
 */
export interface TopologyEntity {
  id: string;
  typeId: string;
  name: string;
  parentId: string | null;
  fields: Record<string, string | number | string[]>;
  status: EntityStatus;
  updatedAt: string;
}

/** A point-in-time snapshot of the full topology graph. */
export interface TopologySnapshot {
  entities: TopologyEntity[];
  connections: Connection[];
}

// Branded sub-types for the four primary structural entity kinds.
export type Realm = TopologyEntity & { typeId: 'realm' };
export type Cluster = TopologyEntity & { typeId: 'cluster' };
export type Host = TopologyEntity & { typeId: 'host' };
export type Raid = TopologyEntity & { typeId: 'raid' };

export function isRealm(entity: TopologyEntity): entity is Realm {
  return entity.typeId === 'realm';
}

export function isCluster(entity: TopologyEntity): entity is Cluster {
  return entity.typeId === 'cluster';
}

export function isHost(entity: TopologyEntity): entity is Host {
  return entity.typeId === 'host';
}

export function isRaid(entity: TopologyEntity): entity is Raid {
  return entity.typeId === 'raid';
}

/**
 * Filters a flat entity list to only those matching the given `typeId`,
 * typed as the generic parameter `T`.
 */
export function filterByType<T extends TopologyEntity>(
  entities: TopologyEntity[],
  typeId: string,
): T[] {
  return entities.filter((e): e is T => e.typeId === typeId);
}
