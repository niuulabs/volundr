import { File, Folder, X } from 'lucide-react';
import type { FileTreeEntry } from '@/models';
import styles from './MentionPill.module.css';

interface MentionPillProps {
  entry: FileTreeEntry;
  onRemove: (path: string) => void;
}

export function MentionPill({ entry, onRemove }: MentionPillProps) {
  return (
    <span className={styles.pill} data-type={entry.type} data-testid="mention-pill">
      {entry.type === 'directory' ? (
        <Folder className={styles.icon} />
      ) : (
        <File className={styles.icon} />
      )}
      <span className={styles.path}>{entry.path}</span>
      <button
        type="button"
        className={styles.remove}
        onClick={() => onRemove(entry.path)}
        aria-label={`Remove ${entry.path}`}
      >
        <X className={styles.removeIcon} />
      </button>
    </span>
  );
}
