import { useState, useCallback, type FC } from 'react';
import styles from './DeleteSessionDialog.module.css';

export type CleanupTarget = 'workspace_storage' | 'chronicles';

interface CleanupOption {
  target: CleanupTarget;
  label: string;
  hint: string;
}

const CLEANUP_OPTIONS: CleanupOption[] = [
  {
    target: 'workspace_storage',
    label: 'Delete workspace storage',
    hint: 'Permanently delete the workspace PVC. Cannot be reused by future sessions.',
  },
  {
    target: 'chronicles',
    label: 'Delete chronicles',
    hint: 'Remove session chronicles and timeline history.',
  },
];

export interface DeleteSessionDialogProps {
  isOpen: boolean;
  sessionName: string;
  isManual: boolean;
  onConfirm: (cleanup: CleanupTarget[]) => void;
  onCancel: () => void;
}

export const DeleteSessionDialog: FC<DeleteSessionDialogProps> = ({
  isOpen,
  sessionName,
  isManual,
  onConfirm,
  onCancel,
}) => {
  const [selected, setSelected] = useState<Set<CleanupTarget>>(new Set());

  const handleToggle = useCallback((target: CleanupTarget) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(selected));
    setSelected(new Set());
  }, [onConfirm, selected]);

  const handleCancel = useCallback(() => {
    setSelected(new Set());
    onCancel();
  }, [onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay} data-testid="delete-session-dialog">
      <div className={styles.backdrop} onClick={handleCancel} />
      <div className={styles.dialog}>
        <h2 className={styles.title}>
          {isManual ? 'Remove session' : 'Delete session'}
        </h2>
        <p className={styles.description}>
          {isManual ? (
            <>
              Remove <span className={styles.sessionName}>{sessionName}</span> from the
              session list?
            </>
          ) : (
            <>
              Are you sure you want to delete{' '}
              <span className={styles.sessionName}>{sessionName}</span>? This action cannot
              be undone.
            </>
          )}
        </p>

        {!isManual && (
          <div className={styles.cleanupSection}>
            <p className={styles.cleanupHeading}>Also clean up:</p>
            <div className={styles.checkboxList}>
              {CLEANUP_OPTIONS.map(option => (
                <label key={option.target} className={styles.checkboxItem}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selected.has(option.target)}
                    onChange={() => handleToggle(option.target)}
                    data-testid={`cleanup-${option.target}`}
                  />
                  <div className={styles.checkboxContent}>
                    <span className={styles.checkboxLabel}>{option.label}</span>
                    <span className={styles.checkboxHint}>{option.hint}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={handleCancel}
            data-testid="delete-session-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={handleConfirm}
            data-testid="delete-session-confirm"
          >
            {isManual ? 'Remove' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};
