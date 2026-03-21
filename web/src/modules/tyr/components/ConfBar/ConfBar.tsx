import { cn } from '@/modules/shared/utils/classnames';
import styles from './ConfBar.module.css';

export interface ConfBarProps {
  value: number; // 0.0-1.0
  showLabel?: boolean;
  className?: string;
}

function confLevel(v: number): 'high' | 'med' | 'low' {
  if (v >= 0.75) return 'high';
  if (v >= 0.45) return 'med';
  return 'low';
}

export function ConfBar({ value, showLabel = true, className }: ConfBarProps) {
  const pct = Math.round(value * 100);
  return (
    <div className={cn(styles.container, className)} data-level={confLevel(value)}>
      {showLabel && <span className={styles.label}>{pct}%</span>}
      <span className={styles.track}>
        <span className={styles.fill} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
