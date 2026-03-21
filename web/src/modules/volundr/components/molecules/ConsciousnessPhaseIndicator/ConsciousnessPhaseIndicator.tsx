import type { ConsciousnessPhase } from '@/modules/volundr/models';
import { cn } from '@/utils';
import styles from './ConsciousnessPhaseIndicator.module.css';

export interface ConsciousnessPhaseIndicatorProps {
  /** Current consciousness phase */
  phase: ConsciousnessPhase;
  /** Whether to show labels */
  showLabel?: boolean;
  /** Additional CSS class */
  className?: string;
}

const phases: ConsciousnessPhase[] = ['SENSE', 'THINK', 'DECIDE', 'ACT'];

export function ConsciousnessPhaseIndicator({
  phase,
  showLabel = true,
  className,
}: ConsciousnessPhaseIndicatorProps) {
  return (
    <div className={cn(styles.container, className)}>
      {phases.map((p, i) => (
        <div key={p} className={styles.phaseGroup}>
          <div
            className={cn(styles.dot, phase === p && styles.active, styles[p.toLowerCase()])}
            data-phase={p}
          />
          {i < phases.length - 1 && <div className={styles.connector} />}
        </div>
      ))}
      {showLabel && <span className={styles.label}>{phase}</span>}
    </div>
  );
}
