import type { MimirStats } from '../../api/types';
import styles from './StatsBar.module.css';

interface StatsBarProps {
  stats: MimirStats | null;
  instanceName: string;
}

export function StatsBar({ stats, instanceName }: StatsBarProps) {
  if (!stats) {
    return (
      <div className={styles.statsBar}>
        <span className={styles.instanceLabel}>{instanceName}</span>
        <span className={styles.loading}>Loading stats\u2026</span>
      </div>
    );
  }

  return (
    <div className={styles.statsBar}>
      <span className={styles.instanceLabel}>{instanceName}</span>
      <div className={styles.statsList}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.pageCount}</span>
          <span className={styles.statLabel}>pages</span>
        </div>
        <div className={styles.divider} aria-hidden="true" />
        <div className={styles.stat}>
          <span className={styles.statValue}>{stats.categories.length}</span>
          <span className={styles.statLabel}>categories</span>
        </div>
        <div className={styles.divider} aria-hidden="true" />
        <div className={styles.healthBadge} data-healthy={stats.healthy}>
          <span className={styles.healthDot} aria-hidden="true" />
          <span>{stats.healthy ? 'healthy' : 'degraded'}</span>
        </div>
      </div>
    </div>
  );
}
