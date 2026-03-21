import { Sunrise, Sun, Sunset, Moon } from 'lucide-react';
import type { CircadianMode } from '@/modules/volundr/models';
import { cn } from '@/utils';
import styles from './CircadianIcon.module.css';

export interface CircadianIconProps {
  /** The circadian mode */
  mode: CircadianMode;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS class */
  className?: string;
}

const iconMap = {
  morning: Sunrise,
  active: Sun,
  evening: Sunset,
  night: Moon,
} as const;

export function CircadianIcon({ mode, size = 'md', className }: CircadianIconProps) {
  const Icon = iconMap[mode];

  return (
    <Icon
      className={cn(styles.icon, styles[size], styles[mode], className)}
      aria-label={`${mode} mode`}
    />
  );
}
