import { useState, useMemo } from 'react';
import type { EntityType } from '@niuulabs/domain';
import { ShapeSvg } from '@niuulabs/ui';
import type { TypeRegistry } from '../domain/registry';
import styles from './TypesTab.module.css';

export interface TypesTabProps {
  registry: TypeRegistry;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function TypesTab({ registry, selectedId, onSelect }: TypesTabProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return registry.types;
    const q = search.toLowerCase();
    return registry.types.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.id.includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [registry.types, search]);

  const byCategory = useMemo(() => {
    const m = new Map<string, EntityType[]>();
    for (const t of filtered) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return m;
  }, [filtered]);

  return (
    <div className={styles.container}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="filter types…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter entity types"
        />
      </div>

      {filtered.length === 0 && (
        <p className={styles.empty} role="status">
          No types match &quot;{search}&quot;
        </p>
      )}

      {[...byCategory.entries()].map(([cat, types]) => (
        <div key={cat} className={styles.categoryGroup}>
          <div className={styles.categoryHead}>
            {cat}
            <span className={styles.categoryCount}>· {types.length}</span>
          </div>
          <div className={styles.typeGrid}>
            {types.map((t) => (
              <button
                key={t.id}
                className={`${styles.typeCard} ${selectedId === t.id ? styles.typeCardSelected : ''}`}
                onClick={() => onSelect(t.id)}
                aria-pressed={selectedId === t.id}
                aria-label={`${t.label} (${t.id})`}
              >
                <div className={styles.typeSwatch}>
                  <ShapeSvg shape={t.shape} color={t.color} size={22} />
                </div>
                <div className={styles.typeName}>
                  {t.label}
                  <span className={styles.typeRune}>{t.rune}</span>
                </div>
                <div className={styles.typeDesc}>{t.description.split('.')[0]}.</div>
                <div className={styles.typeMeta}>
                  <span className={styles.typeId}>{t.id}</span>
                  <span>
                    shape · <strong>{t.shape}</strong>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
