import { cn } from '@/modules/shared/utils/classnames';
import styles from './ConfBadge.module.css';

export interface ConfBadgeProps {
  value: number; // 0.0-1.0
  className?: string;
}

function confLevel(v: number): 'high' | 'med' | 'low' {
  if (v >= 0.75) return 'high';
  if (v >= 0.45) return 'med';
  return 'low';
}

export function ConfBadge({ value, className }: ConfBadgeProps) {
  const pct = Math.round(value * 100);
  return (
    <span className={cn(styles.badge, className)} data-level={confLevel(value)}>
      <span className={styles.value}>{pct}%</span>
      <span className={styles.track}>
        <span className={styles.fill} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
