import type { ChronicleEntry as ChronicleEntryModel } from '@/models';
import type { StatusType } from '@/models/status.model';
import { StatusDot } from '@/components/atoms/StatusDot';
import { cn } from '@/utils';
import styles from './ChronicleEntry.module.css';

export interface ChronicleEntryProps {
  /** The chronicle entry data */
  entry: ChronicleEntryModel;
  /** Additional CSS class */
  className?: string;
}

/**
 * Maps chronicle entry type to StatusDot status
 */
function getEntryStatus(entry: ChronicleEntryModel): StatusType {
  if (entry.type === 'observe') {
    return entry.severity === 'warning' ? 'warning' : 'observing';
  }

  const typeToStatus: Record<string, StatusType> = {
    think: 'thinking',
    act: 'acting',
    decide: 'deciding',
    sense: 'sensing',
    complete: 'working',
    merge: 'working',
    checkpoint: 'working',
    mimic: 'processing',
  };

  return typeToStatus[entry.type] || 'working';
}

export function ChronicleEntry({ entry, className }: ChronicleEntryProps) {
  const status = getEntryStatus(entry);

  return (
    <div className={cn(styles.entry, className)}>
      <span className={styles.time}>{entry.time}</span>
      <div className={styles.dotContainer}>
        <StatusDot status={status} />
      </div>
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.agent}>{entry.agent}</span>
          <span className={cn(styles.type, styles[entry.type])}>{entry.type}</span>
          {entry.zone && <span className={cn(styles.zone, styles[entry.zone])}>{entry.zone}</span>}
        </div>
        <p className={styles.message}>{entry.message}</p>
        {entry.details && <p className={styles.details}>{entry.details}</p>}
      </div>
    </div>
  );
}
