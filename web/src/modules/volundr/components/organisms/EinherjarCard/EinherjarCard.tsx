import { Hammer } from 'lucide-react';
import type { Einherjar } from '@/modules/volundr/models';
import { StatusBadge } from '@/modules/shared';
import { cn } from '@/utils';
import styles from './EinherjarCard.module.css';

export interface EinherjarCardProps {
  /** Einherjar worker data */
  einherjar: Einherjar;
  /** Campaign name to display (optional) */
  campaignName?: string;
  /** Click handler */
  onClick?: () => void;
  /** Additional CSS class */
  className?: string;
}

export function EinherjarCard({ einherjar, campaignName, onClick, className }: EinherjarCardProps) {
  const isWorking = einherjar.status === 'working';
  const hasHighCycles = einherjar.cyclesSinceCheckpoint > 10;

  return (
    <div
      className={cn(styles.card, isWorking && styles.working, className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={styles.header}>
        <div className={styles.identity}>
          <div className={cn(styles.iconContainer, isWorking && styles.iconWorking)}>
            <Hammer className={cn(styles.icon, isWorking && styles.iconActive)} />
          </div>
          <div className={styles.nameGroup}>
            <h3 className={styles.name}>{einherjar.name}</h3>
            <p className={styles.realm}>{einherjar.realm}</p>
          </div>
        </div>
        <StatusBadge status={einherjar.status} />
      </div>

      <p className={styles.task}>{einherjar.task}</p>

      {einherjar.progress !== null && (
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span className={styles.progressLabel}>Progress</span>
            <span className={styles.progressValue}>{einherjar.progress}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${einherjar.progress}%` }} />
          </div>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.stats}>
          <span className={styles.context}>
            Context: {einherjar.contextUsed}/{einherjar.contextMax}k
          </span>
          {einherjar.cyclesSinceCheckpoint > 0 && (
            <span className={cn(styles.cycles, hasHighCycles && styles.cyclesWarning)}>
              {einherjar.cyclesSinceCheckpoint} cycles since checkpoint
            </span>
          )}
        </div>
        {campaignName && <span className={styles.campaign}>{campaignName}</span>}
      </div>
    </div>
  );
}
