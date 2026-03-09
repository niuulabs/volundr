import type { StatusType } from '@/models';
import { cn } from '@/utils';
import styles from './StatusBadge.module.css';

export interface StatusBadgeProps {
  /** The status to display */
  status: StatusType;
  /** Additional CSS class */
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn(styles.badge, className)} data-status={status}>
      {status}
    </span>
  );
}
