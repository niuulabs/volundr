import { useState, useMemo, useCallback } from 'react';
import { Chip } from '@niuulabs/ui';
import type { TypeRegistry } from '../domain/registry';
import { reparentType } from '../domain/registry';
import { TypesTab } from './TypesTab';
import { ContainmentTab } from './ContainmentTab';
import { JsonTab } from './JsonTab';
import { TypePreviewDrawer } from './TypePreviewDrawer';
import styles from './RegistryEditor.module.css';

export type RegistryEditorTab = 'types' | 'containment' | 'json';

export interface RegistryEditorProps {
  registry: TypeRegistry;
  /**
   * Called whenever the registry is mutated (e.g. after a reparent drag-drop).
   * The caller is responsible for persisting the updated registry.
   */
  onSave?: (registry: TypeRegistry) => void;
}

const TABS: RegistryEditorTab[] = ['types', 'containment', 'json'];

export function RegistryEditor({ registry: initialRegistry, onSave }: RegistryEditorProps) {
  const [tab, setTab] = useState<RegistryEditorTab>('types');
  const [localRegistry, setLocalRegistry] = useState<TypeRegistry>(initialRegistry);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialRegistry.types[0]?.id,
  );

  const selected = useMemo(
    () => localRegistry.types.find((t) => t.id === selectedId),
    [localRegistry.types, selectedId],
  );

  const handleReparent = useCallback(
    (childId: string, newParentId: string) => {
      const updated = reparentType(localRegistry, childId, newParentId);
      if (updated === localRegistry) return;
      setLocalRegistry(updated);
      onSave?.(updated);
    },
    [localRegistry, onSave],
  );

  return (
    <div className={styles.editor}>
      <div className={styles.main}>
        <div className={styles.head}>
          <h3 className={styles.title}>Entity type registry</h3>
          <div className={styles.headMeta}>
            <Chip tone="muted">rev {localRegistry.version}</Chip>
            <Chip tone="default">{localRegistry.types.length} types</Chip>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Registry editor tabs">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className={styles.content}>
          {tab === 'types' && (
            <TypesTab
              registry={localRegistry}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
          {tab === 'containment' && (
            <ContainmentTab
              registry={localRegistry}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onReparent={handleReparent}
            />
          )}
          {tab === 'json' && <JsonTab registry={localRegistry} />}
        </div>
      </div>

      <div className={styles.inspector}>
        <TypePreviewDrawer type={selected} />
      </div>
    </div>
  );
}
