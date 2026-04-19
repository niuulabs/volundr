/**
 * Observatory domain — pure value objects describing the live topology and
 * entity-type registry. No framework imports.
 *
 * Shared cross-plugin types (`EntityShape`, `EntityCategory`, `TypeRegistry`)
 * are re-exported verbatim from `@niuulabs/domain`. Observatory-specific
 * rendering + editor fields are layered on top of the canonical `EntityType`
 * via extension — no local copies.
 */

// ── Base types re-exported from @niuulabs/domain ──────────────────────────────
// Import the domain bases we extend locally.
import type { EntityType as BaseEntityType, TypeRegistry } from '@niuulabs/domain';

// Re-export shared primitives so consumers can import from a single package.
export type { EntityShape, EntityCategory, TypeRegistry } from '@niuulabs/domain';

// ── Observatory-specific field definition ─────────────────────────────────────

/** A configurable field descriptor on an EntityType used by the registry editor. */
export interface EntityTypeField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'tags';
  required?: boolean;
  options?: string[];
}

/**
 * Observatory-extended entity type.
 * Inherits `id`, `label`, `category` (typed enum), `rune`, `shape`, `color`,
 * `description`, `parentTypes`, `canContain` from `@niuulabs/domain`
 * `EntityType` and adds observatory rendering + registry-editor fields.
 */
export interface EntityType extends BaseEntityType {
  icon: string;
  size: number;
  border: 'solid' | 'dashed';
  fields: EntityTypeField[];
}

/**
 * Versioned registry of observatory-extended entity types.
 * Structurally compatible with `TypeRegistry` from `@niuulabs/domain` but
 * narrows `types` to the richer `EntityType` extension.
 */
export interface Registry extends Omit<TypeRegistry, 'types'> {
  types: EntityType[];
}

// ── Topology graph ────────────────────────────────────────────────────────────

/** The 5 connection styles in the topology edge taxonomy. */
export type EdgeKind = 'solid' | 'dashed-anim' | 'dashed-long' | 'soft' | 'raid';

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

// ── Event log ─────────────────────────────────────────────────────────────────

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
