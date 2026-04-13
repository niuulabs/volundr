import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/utils';
import type { RoomParticipant } from '@/modules/shared/hooks/useSkuldChat';
import styles from './ParticipantFilter.module.css';

interface ParticipantFilterProps {
  participants: ReadonlyMap<string, RoomParticipant>;
  activeFilter: string;
  onFilterChange: (peerId: string) => void;
  showInternal: boolean;
  onToggleInternal: () => void;
}

const FILTER_ALL = 'all';

export function ParticipantFilter({
  participants,
  activeFilter,
  onFilterChange,
  showInternal,
  onToggleInternal,
}: ParticipantFilterProps) {
  return (
    <div className={styles.container}>
      <div className={styles.pills}>
        <button
          type="button"
          className={cn(styles.pill, activeFilter === FILTER_ALL && styles.active)}
          onClick={() => onFilterChange(FILTER_ALL)}
        >
          All
        </button>
        {Array.from(participants.values()).map(participant => (
          <button
            key={participant.peerId}
            type="button"
            className={cn(styles.pill, activeFilter === participant.peerId && styles.active)}
            onClick={() => onFilterChange(participant.peerId)}
            data-participant-color={participant.color}
          >
            <span className={styles.dot} data-participant-color={participant.color} />
            <span>{participant.persona}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={cn(styles.toggleBtn, showInternal && styles.toggleActive)}
        onClick={onToggleInternal}
        title={showInternal ? 'Hide internal messages' : 'Show internal messages'}
        aria-pressed={showInternal}
      >
        {showInternal ? (
          <Eye className={styles.toggleIcon} />
        ) : (
          <EyeOff className={styles.toggleIcon} />
        )}
        <span className={styles.toggleLabel}>Internal</span>
      </button>
    </div>
  );
}
