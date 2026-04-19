import type { EntityType } from '@niuulabs/domain';
import { ShapeSvg, Chip } from '@niuulabs/ui';
import styles from './TypePreviewDrawer.module.css';

export interface TypePreviewDrawerProps {
  type: EntityType | undefined;
}

export function TypePreviewDrawer({ type }: TypePreviewDrawerProps) {
  if (!type) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>Select a type to preview.</p>
      </div>
    );
  }

  return (
    <div className={styles.drawer}>
      <div className={styles.header}>
        <div className={styles.shapeBox} aria-hidden>
          <ShapeSvg shape={type.shape} color={type.color} size={30} />
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.category}>Type · {type.category}</div>
          <div className={styles.label}>
            {type.label}
            <span className={styles.rune} aria-label={`rune: ${type.rune}`}>
              {type.rune}
            </span>
          </div>
          <div className={styles.id}>{type.id}</div>
        </div>
      </div>

      <p className={styles.description}>{type.description}</p>

      {type.canContain.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>Can contain</div>
          <div className={styles.chipGroup}>
            {type.canContain.map((id) => (
              <Chip key={id} tone="default">
                {id}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {type.parentTypes.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>Lives inside</div>
          <div className={styles.chipGroup}>
            {type.parentTypes.map((id) => (
              <Chip key={id} tone="muted">
                {id}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {type.fields.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>Fields</div>
          <div className={styles.fieldList}>
            {type.fields.map((f) => (
              <div key={f.key} className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{f.label}</span>
                <Chip tone="muted">{f.type}</Chip>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
