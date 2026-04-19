import type { EntityType } from '@niuulabs/domain';

/**
 * The versioned type registry — authoritative schema for all entity kinds
 * in the Niuu topology.
 *
 * @canonical Observatory — `DEFAULT_REGISTRY` in `data.jsx`, SDD §4.1.
 */
export interface TypeRegistry {
  version: number;
  updatedAt: string;
  types: EntityType[];
}

export function findType(registry: TypeRegistry, typeId: string): EntityType | undefined {
  return registry.types.find((t) => t.id === typeId);
}

/**
 * Returns true if making `draggedId` a child of `targetId` would introduce
 * a cycle in the containment DAG.
 *
 * A cycle exists when `targetId` is already reachable as a descendant of
 * `draggedId` through the `canContain` edges.
 */
export function wouldCreateCycle(
  registry: TypeRegistry,
  draggedId: string,
  targetId: string,
): boolean {
  const visited = new Set<string>();

  function isDescendant(currentId: string): boolean {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const type = findType(registry, currentId);
    if (!type) return false;
    if (type.canContain.includes(targetId)) return true;
    return type.canContain.some((childId) => isDescendant(childId));
  }

  return isDescendant(draggedId);
}

/**
 * Reparents `childId` under `newParentId` in the containment tree.
 *
 * - Removes `childId` from any previous parent's `canContain`.
 * - Adds `childId` to `newParentId`'s `canContain`.
 * - Rewrites `childId`'s `parentTypes` to `[newParentId]` (single-parent model).
 * - Bumps `version` and `updatedAt`.
 *
 * Returns the registry unchanged if the operation would create a cycle.
 */
export function reparentType(
  registry: TypeRegistry,
  childId: string,
  newParentId: string,
): TypeRegistry {
  if (wouldCreateCycle(registry, childId, newParentId)) {
    return registry;
  }

  const updatedTypes = registry.types.map((type) => {
    if (type.canContain.includes(childId) && type.id !== newParentId) {
      return { ...type, canContain: type.canContain.filter((id) => id !== childId) };
    }
    if (type.id === newParentId && !type.canContain.includes(childId)) {
      return { ...type, canContain: [...type.canContain, childId] };
    }
    if (type.id === childId) {
      return { ...type, parentTypes: [newParentId] };
    }
    return type;
  });

  return {
    ...registry,
    version: registry.version + 1,
    updatedAt: new Date().toISOString(),
    types: updatedTypes,
  };
}
