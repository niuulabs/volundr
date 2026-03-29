import { FileCode } from 'lucide-react';
import type { DiffData } from '@/modules/volundr/models';
import { cn } from '@/utils';
import styles from './DiffViewer.module.css';

export interface DiffViewerProps {
  diff: DiffData | null;
  loading: boolean;
  error: Error | null;
  className?: string;
}

export function DiffViewer({ diff, loading, error, className }: DiffViewerProps) {
  if (loading) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.placeholder}>Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.error}>Failed to load diff: {error.message}</div>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.placeholder}>
          <FileCode className={styles.placeholderIcon} />
          <span>Select a file to view changes</span>
        </div>
      </div>
    );
  }

  if (diff.hunks.length === 0) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.header}>
          <span className={styles.filePath}>{diff.filePath}</span>
        </div>
        <div className={styles.placeholder}>No changes in this file</div>
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)}>
      <div className={styles.header}>
        <span className={styles.filePath}>{diff.filePath}</span>
      </div>
      <div className={styles.hunks}>
        {diff.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className={styles.hunk}>
            <div className={styles.hunkHeader}>
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </div>
            {hunk.lines.map((line, lineIndex) => (
              <div
                key={lineIndex}
                className={cn(
                  styles.line,
                  line.type === 'add' && styles.lineAdd,
                  line.type === 'remove' && styles.lineRemove,
                  line.type === 'context' && styles.lineContext
                )}
              >
                <span className={styles.lineNumber} data-type={line.type}>
                  {line.oldLine ?? ''}
                </span>
                <span className={styles.lineNumber} data-type={line.type}>
                  {line.newLine ?? ''}
                </span>
                <span className={styles.linePrefix} data-type={line.type}>
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                <span className={styles.lineContent}>{line.content || '\u00A0'}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
