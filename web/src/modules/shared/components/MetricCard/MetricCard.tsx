import type { ComponentType } from 'react';
import { cn } from '@/utils';
import styles from './MetricCard.module.css';

export interface MetricCardProps {
  /** Label text above the value */
  label: string;
  /** Main value to display */
  value: string | number;
  /** Subtext below the value */
  subtext?: string;
  /** Icon component */
  icon: ComponentType<{ className?: string }>;
  /** Icon color accent */
  iconColor?: 'cyan' | 'emerald' | 'amber' | 'purple' | 'red' | 'indigo' | 'orange';
  /** Additional CSS class */
  className?: string;
}

export function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  iconColor = 'cyan',
  className,
}: MetricCardProps) {
  return (
    <div className={cn(styles.card, className)}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <Icon className={cn(styles.icon, styles[iconColor])} />
      </div>
      <div className={styles.value}>{value}</div>
      {subtext && <div className={styles.subtext}>{subtext}</div>}
    </div>
  );
}
