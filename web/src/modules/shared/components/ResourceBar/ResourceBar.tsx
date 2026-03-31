import { cn } from '@/utils';
import styles from './ResourceBar.module.css';

export interface ResourceBarProps {
  /** Label text */
  label: string;
  /** Amount used */
  used: number;
  /** Total capacity */
  total: number;
  /** Unit suffix (e.g., 'GB', 'TB') */
  unit?: string;
  /** Optional formatter for displayed values (e.g., formatBytes) */
  formatValue?: (value: number) => string;
  /** Bar color */
  color?: 'emerald' | 'amber' | 'cyan' | 'purple' | 'red';
  /** Whether to show the values */
  showValues?: boolean;
  /** Additional CSS class */
  className?: string;
}

export function ResourceBar({
  label,
  used,
  total,
  unit = '',
  formatValue,
  color = 'emerald',
  showValues = true,
  className,
}: ResourceBarProps) {
  const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
  const displayUsed = formatValue ? formatValue(used) : String(used);
  const displayTotal = formatValue ? formatValue(total) : String(total);

  return (
    <div className={cn(styles.container, className)}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        {showValues && (
          <span className={styles.values}>
            {displayUsed}/{displayTotal}
            {unit ? ` ${unit}` : ''}
          </span>
        )}
      </div>
      <div className={styles.track}>
        <div className={cn(styles.fill, styles[color])} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
