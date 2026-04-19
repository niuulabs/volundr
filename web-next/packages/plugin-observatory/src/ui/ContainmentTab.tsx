import { useState } from 'react';
import type { EntityType } from '@niuulabs/domain';
import { ShapeSvg } from '@niuulabs/ui';
import type { TypeRegistry } from '../domain/registry';
import { wouldCreateCycle } from '../domain/registry';
import styles from './ContainmentTab.module.css';

export type NodeDragState = 'dragging' | 'drop-target' | 'drop-invalid' | 'drop-ok';

export interface ContainmentTabProps {
  registry: TypeRegistry;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onReparent: (childId: string, newParentId: string) => void;
}

export function ContainmentTab({
  registry,
  selectedId,
  onSelect,
  onReparent,
}: ContainmentTabProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overInvalid, setOverInvalid] = useState(false);

  const byId = new Map(registry.types.map((t) => [t.id, t]));
  const roots = registry.types.filter((t) => t.parentTypes.length === 0);

  const getDragState = (typeId: string): NodeDragState | undefined => {
    if (dragId === typeId) return 'dragging';
    if (overId === typeId) return overInvalid ? 'drop-invalid' : 'drop-target';
    if (dragId && !wouldCreateCycle(registry, dragId, typeId) && dragId !== typeId) {
      return 'drop-ok';
    }
    return undefined;
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    setOverInvalid(false);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      // ignore — jsdom doesn't fully implement DataTransfer
    }
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    if (!dragId) return;
    const bad = wouldCreateCycle(registry, dragId, targetId) || dragId === targetId;
    e.dataTransfer.dropEffect = bad ? 'none' : 'move';
    e.preventDefault();
    if (overId !== targetId || overInvalid !== bad) {
      setOverId(targetId);
      setOverInvalid(bad);
    }
  };

  const handleDragLeave = (_e: React.DragEvent, targetId: string) => {
    if (overId === targetId) {
      setOverId(null);
      setOverInvalid(false);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId) return;
    const bad = wouldCreateCycle(registry, dragId, targetId) || dragId === targetId;
    if (!bad) onReparent(dragId, targetId);
    setDragId(null);
    setOverId(null);
    setOverInvalid(false);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setOverId(null);
    setOverInvalid(false);
  };

  const renderNode = (t: EntityType, depth = 0): React.ReactNode => {
    const children = t.canContain
      .map((id) => byId.get(id))
      .filter((c): c is EntityType => c !== undefined);
    const state = getDragState(t.id);
    const isSelected = selectedId === t.id;

    return (
      <div key={t.id} style={{ marginLeft: depth * 20 }}>
        <div
          className={styles.treeNode}
          data-drag-state={state}
          data-selected={isSelected ? 'true' : undefined}
          draggable
          onDragStart={(e) => handleDragStart(e, t.id)}
          onDragOver={(e) => handleDragOver(e, t.id)}
          onDragLeave={(e) => handleDragLeave(e, t.id)}
          onDrop={(e) => handleDrop(e, t.id)}
          onDragEnd={handleDragEnd}
          onClick={() => onSelect(t.id)}
          role="treeitem"
          aria-selected={isSelected}
          aria-label={t.label}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(t.id);
            }
          }}
        >
          <span className={styles.grip} aria-hidden>
            ⋮⋮
          </span>
          <span className={styles.shapeIcon} aria-hidden>
            <ShapeSvg shape={t.shape} color={t.color} size={14} />
          </span>
          <span className={styles.rune} aria-hidden>
            {t.rune}
          </span>
          <span className={styles.name}>{t.label}</span>
          <span className={styles.meta}>{t.id}</span>
        </div>
        {children.length > 0 && (
          <div className={styles.children}>{children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  // Orphan detection: types not reachable from any root via canContain
  const reachable = new Set<string>();
  const markReachable = (t: EntityType) => {
    if (reachable.has(t.id)) return;
    reachable.add(t.id);
    t.canContain.forEach((id) => {
      const child = byId.get(id);
      if (child) markReachable(child);
    });
  };
  roots.forEach(markReachable);
  const orphans = registry.types.filter(
    (t) => !reachable.has(t.id) && t.parentTypes.length > 0,
  );

  return (
    <div className={styles.container}>
      <p className={styles.hint}>
        <strong>Drag</strong> a type onto another to reparent it. The{' '}
        <code>canContain</code> edge moves from the old parent to the new.{' '}
        <strong>Cycles are blocked.</strong>
      </p>
      <div className={styles.tree} role="tree" aria-label="Containment tree">
        {roots.map((r) => renderNode(r))}
        {orphans.length > 0 && (
          <div className={styles.orphans}>
            <div className={styles.orphanLabel}>orphans — parent missing</div>
            {orphans.map((o) => renderNode(o))}
          </div>
        )}
      </div>
    </div>
  );
}
