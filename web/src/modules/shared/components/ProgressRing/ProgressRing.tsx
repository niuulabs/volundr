import { cn } from '@/utils';
import styles from './ProgressRing.module.css';

export interface ProgressRingProps {
  /** Progress value from 0-100 */
  value: number;
  /** Size of the ring in pixels */
  size?: number;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Color of the progress stroke (CSS color value) */
  color?: string;
  /** Whether to show the value text */
  showValue?: boolean;
  /** Additional CSS class */
  className?: string;
}

export function ProgressRing({
  value,
  size = 44,
  strokeWidth = 4,
  color = 'var(--color-accent-emerald)',
  showValue = true,
  className,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className={cn(styles.container, className)} style={{ width: size, height: size }}>
      <svg className={styles.svg} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          className={styles.background}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          className={styles.progress}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {showValue && <span className={styles.value}>{value}%</span>}
    </div>
  );
}
