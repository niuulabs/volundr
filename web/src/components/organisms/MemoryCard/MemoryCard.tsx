import type { Memory } from '@/models';
import { cn } from '@/utils';
import styles from './MemoryCard.module.css';

export interface MemoryCardProps {
  /** Memory data */
  memory: Memory;
  /** Click handler */
  onClick?: () => void;
  /** Additional CSS class */
  className?: string;
}

export function MemoryCard({ memory, onClick, className }: MemoryCardProps) {
  const confidencePercent = Math.round(memory.confidence * 100);

  return (
    <div
      className={cn(styles.card, className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={styles.header}>
        <span className={cn(styles.type, styles[memory.type])}>{memory.type}</span>
        <span className={styles.usage}>
          Used {memory.usageCount}x · Last: {memory.lastUsed}
        </span>
      </div>

      <p className={styles.content}>{memory.content}</p>

      <div className={styles.confidence}>
        <span className={styles.confidenceLabel}>Confidence:</span>
        <div className={styles.confidenceTrack}>
          <div className={styles.confidenceBar} style={{ width: `${confidencePercent}%` }} />
        </div>
        <span className={styles.confidenceValue}>{confidencePercent}%</span>
      </div>
    </div>
  );
}
