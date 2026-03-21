import { useState } from 'react';
import { cn } from '@/modules/shared/utils/classnames';
import { StatusBadge } from '@/modules/shared';
import type { Phase } from '../../models';
import { ConfBar } from '../ConfBar';
import { RaidRow } from '../RaidRow';
import styles from './PhaseBlock.module.css';

export interface PhaseBlockProps {
  phase: Phase;
  className?: string;
}

export function PhaseBlock({ phase, className }: PhaseBlockProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={cn(styles.container, className)}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
      >
        <span className={styles.phaseNumber}>{phase.number}</span>
        <span className={styles.phaseName}>{phase.name}</span>
        <StatusBadge status={phase.status} />
        <span className={styles.confBarWrapper}>
          <ConfBar value={phase.confidence} />
        </span>
        <span className={styles.chevron} data-expanded={expanded}>
          {'\u25B6'}
        </span>
      </button>
      {expanded && (
        <div className={styles.content}>
          {phase.raids.map(raid => (
            <RaidRow key={raid.id} raid={raid} />
          ))}
          {phase.raids.length === 0 && <div className={styles.empty}>No raids in this phase</div>}
        </div>
      )}
    </div>
  );
}
