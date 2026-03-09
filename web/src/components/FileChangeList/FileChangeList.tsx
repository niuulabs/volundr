import { FilePlus, FileEdit, FileX } from 'lucide-react';
import type { SessionFile } from '@/models';
import { cn } from '@/utils';
import styles from './FileChangeList.module.css';

export interface FileChangeListProps {
  files: SessionFile[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  className?: string;
}

const STATUS_ICONS = {
  new: FilePlus,
  mod: FileEdit,
  del: FileX,
} as const;

const STATUS_LABELS = {
  new: 'Added',
  mod: 'Modified',
  del: 'Deleted',
} as const;

export function FileChangeList({
  files,
  selectedFile,
  onSelectFile,
  className,
}: FileChangeListProps) {
  if (files.length === 0) {
    return (
      <div className={cn(styles.container, className)}>
        <p className={styles.empty}>No files changed</p>
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)}>
      {files.map(file => {
        const Icon = STATUS_ICONS[file.status];
        const isSelected = selectedFile === file.path;
        return (
          <button
            key={file.path}
            type="button"
            className={cn(styles.fileRow, isSelected && styles.fileRowSelected)}
            onClick={() => onSelectFile(file.path)}
            data-status={file.status}
          >
            <span className={styles.iconWrap} data-status={file.status}>
              <Icon className={styles.icon} />
            </span>
            <span className={styles.filePath} title={file.path}>
              {file.path}
            </span>
            <span className={styles.badge} data-status={file.status}>
              {STATUS_LABELS[file.status]}
            </span>
            <span className={styles.diffStats}>
              {file.ins > 0 && <span className={styles.ins}>+{file.ins}</span>}
              {file.del > 0 && <span className={styles.del}>-{file.del}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
