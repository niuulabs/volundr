import { Rune, StateDot, Chip } from '@niuulabs/ui';
import { useRegistry } from './useRegistry';
import styles from './ObservatoryPage.module.css';

export function ObservatoryPage() {
  const { data, isLoading, isError, error } = useRegistry();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Rune glyph="ᚠ" size={32} title="Flokk Observatory" />
        <h2 className={styles.title}>Flokk · Observatory</h2>
      </div>
      <p className={styles.subtitle}>
        Live topology view and entity type registry. The map of your agentic infrastructure.
      </p>

      {isLoading && (
        <div className={styles.statusRow}>
          <StateDot state="processing" pulse />
          <span>loading registry…</span>
        </div>
      )}

      {isError && (
        <div className={styles.statusRow}>
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>entity types</span>
            <Chip tone="brand">{data.types.length}</Chip>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>registry version</span>
            <Chip tone="default">v{data.version}</Chip>
          </div>
        </div>
      )}

      <p className={styles.placeholder}>
        Canvas and registry editor arrive in subsequent tickets (NIU-664, NIU-665).
      </p>
    </div>
  );
}
