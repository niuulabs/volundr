/**
 * Observatory domain — pure value objects describing the live topology and
 * entity-type registry. No framework imports.
 */

/** The 5 connection styles in the topology edge taxonomy. */
export type EdgeKind = 'solid' | 'dashed-anim' | 'dashed-long' | 'soft' | 'raid';

/** SVG shape primitives used when rendering topology nodes. */
export type EntityShape =
  | 'ring'
  | 'ring-dashed'
  | 'rounded-rect'
  | 'diamond'
  | 'triangle'
  | 'hex'
  | 'chevron'
  | 'square'
  | 'square-sm'
  | 'pentagon'
  | 'halo'
  | 'mimir'
  | 'mimir-small'
  | 'dot';

/** A single configurable field on an EntityType. */
export interface EntityTypeField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'tags';
  required?: boolean;
  options?: string[];
}

/** A type definition entry in the entity registry. */
export interface EntityType {
  id: string;
  label: string;
  rune: string;
  icon: string;
  shape: EntityShape;
  color: string;
  size: number;
  border: 'solid' | 'dashed';
  canContain: string[];
  parentTypes: string[];
  category: string;
  description: string;
  fields: EntityTypeField[];
}

/** Versioned snapshot of all entity type definitions. */
export interface Registry {
  version: number;
  updatedAt: string;
  types: EntityType[];
}

/** Runtime health status of a topology node. */
export type NodeStatus =
  | 'healthy'
  | 'degraded'
  | 'failed'
  | 'idle'
  | 'observing'
  | 'unknown';

/** An instance of an EntityType in the live topology graph. */
export interface TopologyNode {
  id: string;
  typeId: string;
  label: string;
  parentId: string | null;
  status: NodeStatus;
}

/** Typed aliases for the four named domain entities. */
export type Realm = TopologyNode & { typeId: 'realm' };
export type Cluster = TopologyNode & { typeId: 'cluster' };
export type Host = TopologyNode & { typeId: 'host' };
export type Raid = TopologyNode & { typeId: 'raid' };

/** A directional connection between two topology nodes. */
export interface TopologyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
}

/** Point-in-time snapshot of the live topology graph. */
export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  timestamp: string;
}

/** Severity level of an observatory event. */
export type EventSeverity = 'debug' | 'info' | 'warn' | 'error';

/** A single entry in the observatory event log. */
export interface ObservatoryEvent {
  id: string;
  timestamp: string;
  severity: EventSeverity;
  sourceId: string;
  message: string;
}
