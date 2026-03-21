import { useEffect } from 'react';
import { FileCode } from 'lucide-react';
import type { SessionChronicle, SessionFile, DiffData, DiffBase } from '@/modules/volundr/models';
import { FileChangeList } from '@/modules/volundr/components/FileChangeList';
import { DiffViewer } from '@/modules/volundr/components/DiffViewer';
import { DiffBaseToggle } from '@/modules/volundr/components/DiffBaseToggle';
import { cn } from '@/utils';
import styles from './SessionDiffs.module.css';

export interface SessionDiffsProps {
  sessionId: string;
  chronicle: SessionChronicle | null;
  chronicleLoading: boolean;
  onFetchChronicle: (sessionId: string) => Promise<void>;
  /** Live file list from git (via Skuld) */
  liveFiles: SessionFile[];
  liveFilesLoading: boolean;
  onFetchFiles: () => Promise<void>;
  diff: DiffData | null;
  diffLoading: boolean;
  diffError: Error | null;
  selectedFile: string | null;
  diffBase: DiffBase;
  onSelectFile: (sessionId: string, filePath: string) => Promise<void>;
  onDiffBaseChange: (base: DiffBase) => void;
  pendingDiffFile?: string | null;
  onPendingDiffConsumed?: () => void;
  className?: string;
}

export function SessionDiffs({
  sessionId,
  chronicle,
  chronicleLoading,
  onFetchChronicle,
  liveFiles,
  liveFilesLoading,
  onFetchFiles,
  diff,
  diffLoading,
  diffError,
  selectedFile,
  diffBase,
  onSelectFile,
  onDiffBaseChange,
  pendingDiffFile = null,
  onPendingDiffConsumed,
  className,
}: SessionDiffsProps) {
  useEffect(() => {
    onFetchChronicle(sessionId);
    onFetchFiles();
  }, [sessionId, onFetchChronicle, onFetchFiles]);

  useEffect(() => {
    if (!pendingDiffFile) {
      return;
    }
    onSelectFile(sessionId, pendingDiffFile);
    onPendingDiffConsumed?.();
  }, [pendingDiffFile, sessionId, onSelectFile, onPendingDiffConsumed]);

  const loading = chronicleLoading || liveFilesLoading;

  if (loading) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.empty}>Loading files...</div>
      </div>
    );
  }

  // Prefer live files from git; fall back to chronicle timeline files
  const files = liveFiles.length > 0 ? liveFiles : (chronicle?.files ?? []);
  const totalIns = files.reduce((sum, f) => sum + f.ins, 0);
  const totalDel = files.reduce((sum, f) => sum + f.del, 0);

  if (files.length === 0) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.empty}>
          <FileCode className={styles.emptyIcon} />
          <span>No file changes yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)}>
      <div className={styles.filePanel}>
        <div className={styles.filePanelHeader}>
          <div className={styles.summary}>
            <span>
              {files.length} file{files.length !== 1 ? 's' : ''} changed
            </span>
            {totalIns > 0 && <span className={styles.summaryIns}>+{totalIns}</span>}
            {totalDel > 0 && <span className={styles.summaryDel}>-{totalDel}</span>}
          </div>
          <DiffBaseToggle value={diffBase} onChange={onDiffBaseChange} />
        </div>
        <div className={styles.fileList}>
          <FileChangeList
            files={files}
            selectedFile={selectedFile}
            onSelectFile={filePath => onSelectFile(sessionId, filePath)}
          />
        </div>
      </div>
      <div className={styles.diffPanel}>
        <DiffViewer diff={diff} loading={diffLoading} error={diffError} />
      </div>
    </div>
  );
}
