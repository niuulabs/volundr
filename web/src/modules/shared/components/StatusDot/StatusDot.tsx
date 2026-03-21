import { cn } from '@/modules/shared/utils/classnames';
import styles from './StatusDot.module.css';

export interface StatusDotProps {
  /** The status to display */
  status: string;
  /** Whether to show pulse animation */
  pulse?: boolean;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional CSS class */
  className?: string;
}

export function StatusDot({ status, pulse = false, size = 'md', className }: StatusDotProps) {
  return (
    <span
      className={cn(styles.dot, styles[size], pulse && styles.pulse, className)}
      data-status={status}
      aria-label={status}
    />
  );
}
