import { cn } from '@/modules/shared/utils/classnames';
import styles from './StatusBadge.module.css';

export interface StatusBadgeProps {
  /** The status to display */
  status: string;
  /** Optional display label (defaults to status value) */
  label?: string;
  /** Additional CSS class */
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span className={cn(styles.badge, className)} data-status={status}>
      {label ?? status}
    </span>
  );
}
