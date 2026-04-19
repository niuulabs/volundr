import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import { Rune, StateDot } from '@niuulabs/ui';
import type { IMimirService } from '../ports/IMimirService';
import styles from './MimirPage.module.css';

export function MimirPage() {
  const service = useService<IMimirService>('mimir');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['mimir', 'stats'],
    queryFn: () => service.getStats(),
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Rune glyph="ᛗ" size={32} />
        <h2 className={styles.title}>Mímir · the well of knowledge</h2>
      </div>

      <p className={styles.subtitle}>
        Persistent memory — browse mounts, read pages, run search, fix lint, inspect dreams.
      </p>

      {isLoading && (
        <div className={styles.status}>
          <StateDot state="processing" pulse />
          <span>loading…</span>
        </div>
      )}

      {isError && (
        <div className={styles.error}>
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>pages</div>
            <div className={styles.statValue}>{data.pageCount}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>categories</div>
            <div className={styles.statValue}>{data.categories.length}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>health</div>
            <div className={styles.statValue}>{data.healthy ? 'ok' : 'degraded'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
