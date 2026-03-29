import { cn } from '@/modules/shared/utils/classnames';
import styles from './StatsStrip.module.css';

interface StatsStripProps {
  summary: Record<string, number>;
  activeFilter: string | null;
  onStatusClick: (status: string) => void;
  showCompleted: boolean;
  onToggleCompleted: () => void;
}

const STATUSES = [
  { key: 'running', label: 'Running' },
  { key: 'review', label: 'Review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'queued', label: 'Queued' },
  { key: 'pending', label: 'Pending' },
  { key: 'merged', label: 'Merged' },
  { key: 'failed', label: 'Failed' },
] as const;

export function StatsStrip({
  summary,
  activeFilter,
  onStatusClick,
  showCompleted,
  onToggleCompleted,
}: StatsStripProps) {
  return (
    <div className={styles.strip}>
      {STATUSES.map(s => {
        const count = summary[s.key] ?? 0;
        return (
          <button
            key={s.key}
            type="button"
            className={cn(styles.stat, activeFilter === s.key && styles.active)}
            data-status={s.key}
            data-has-count={count > 0 || undefined}
            onClick={() => onStatusClick(s.key)}
          >
            <div className={styles.number}>{count}</div>
            <div className={styles.label}>{s.label}</div>
          </button>
        );
      })}
      <button
        type="button"
        className={cn(styles.toggle, showCompleted && styles.toggleOn)}
        onClick={onToggleCompleted}
        title={showCompleted ? 'Hide completed raids' : 'Show completed raids'}
      >
        {showCompleted ? 'Hide done' : 'Show all'}
      </button>
    </div>
  );
}
