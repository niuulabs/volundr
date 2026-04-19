import { useState } from 'react';
import type { Registry } from '../domain';
import { isDescendant, reparent } from '../domain/containment';

export interface RegistryEditorState {
  registry: Registry;
  selectedId: string | null;
  select: (id: string | null) => void;
  /**
   * Attempts to reparent `childId` under `newParentId`.
   * Returns `false` (and makes no change) if the drop would create a cycle or
   * if childId === newParentId.
   */
  tryReparent: (childId: string, newParentId: string) => boolean;
}

export function useRegistryEditor(initial: Registry): RegistryEditorState {
  const [registry, setRegistry] = useState<Registry>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.types[0]?.id ?? null);

  const tryReparent = (childId: string, newParentId: string): boolean => {
    if (childId === newParentId) return false;
    if (isDescendant(registry, childId, newParentId)) return false;
    setRegistry((r) => reparent(r, childId, newParentId));
    return true;
  };

  return {
    registry,
    selectedId,
    select: setSelectedId,
    tryReparent,
  };
}
