import { useState, useEffect, useCallback } from 'react';
import { HardDrive } from 'lucide-react';
import type { VolundrWorkspace } from '@/models';
import type { IVolundrService } from '@/ports';
import { cn } from '@/utils/classnames';
import styles from './WorkspacesSection.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function workspaceLabel(ws: VolundrWorkspace): string {
  if (ws.sessionName) return ws.sessionName;
  if (ws.sourceUrl) {
    const repoName = ws.sourceUrl.replace(/.*\//, '').replace(/\.git$/, '');
    const ref = ws.sourceRef || 'main';
    return `${repoName} / ${ref}`;
  }
  return ws.pvcName;
}

interface WorkspacesSectionProps {
  service: IVolundrService;
}

export function WorkspacesSection({ service }: WorkspacesSectionProps) {
  const [workspaces, setWorkspaces] = useState<VolundrWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<VolundrWorkspace | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const data = await service.listWorkspaces();
      setWorkspaces(data);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleRestore = useCallback(
    async (id: string) => {
      await service.restoreWorkspace(id);
      await loadWorkspaces();
    },
    [service, loadWorkspaces]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    await service.deleteWorkspace(deleteTarget.sessionId);
    setDeleteTarget(null);
    await loadWorkspaces();
  }, [deleteTarget, service, loadWorkspaces]);

  const handleToggleSelectAll = useCallback(() => {
    if (selectedIds.size === workspaces.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(workspaces.map(ws => ws.sessionId)));
    }
  }, [selectedIds, workspaces]);

  const handleToggleSelect = useCallback((sessionId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      await service.bulkDeleteWorkspaces(Array.from(selectedIds));
      setSelectedIds(new Set());
      await loadWorkspaces();
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedIds, service, loadWorkspaces]);

  const totalStorageGb = workspaces
    .filter(w => w.status !== 'deleted')
    .reduce((sum, w) => sum + w.sizeGb, 0);

  if (loading) {
    return <div className={styles.loadingSpinner}>Loading workspaces...</div>;
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div className={styles.usageSummary}>
          Total storage: <span className={styles.usageValue}>{totalStorageGb} GB</span>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkBarText}>{selectedIds.size} selected</span>
          <button
            type="button"
            className={cn(styles.actionButton, styles.deleteButton)}
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
          >
            {bulkDeleting
              ? 'Deleting...'
              : `Delete ${selectedIds.size} workspace${selectedIds.size > 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {workspaces.length === 0 ? (
        <div className={styles.emptyState}>
          <HardDrive className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>No workspaces found</span>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeader}>
                <input
                  type="checkbox"
                  className={styles.selectCheckbox}
                  checked={workspaces.length > 0 && selectedIds.size === workspaces.length}
                  onChange={handleToggleSelectAll}
                />
              </th>
              <th className={styles.tableHeader}>Workspace</th>
              <th className={styles.tableHeader}>Size</th>
              <th className={styles.tableHeader}>Status</th>
              <th className={styles.tableHeader}>Created</th>
              <th className={styles.tableHeader}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map(ws => (
              <tr
                key={ws.id}
                className={cn(styles.tableRow, selectedIds.has(ws.sessionId) && styles.selectedRow)}
              >
                <td className={styles.tableCell}>
                  <input
                    type="checkbox"
                    className={styles.selectCheckbox}
                    checked={selectedIds.has(ws.sessionId)}
                    onChange={() => handleToggleSelect(ws.sessionId)}
                  />
                </td>
                <td className={cn(styles.tableCell, styles.workspaceCell)}>
                  <span className={styles.workspaceLabel}>{workspaceLabel(ws)}</span>
                  <span className={styles.workspacePvc}>{ws.pvcName}</span>
                </td>
                <td className={cn(styles.tableCell, styles.sizeCell)}>{ws.sizeGb} GB</td>
                <td className={styles.tableCell}>
                  <span className={styles.statusBadge} data-status={ws.status}>
                    {ws.status}
                  </span>
                </td>
                <td className={cn(styles.tableCell, styles.dateCell)}>
                  {formatDate(ws.createdAt)}
                </td>
                <td className={styles.tableCell}>
                  <div className={styles.actions}>
                    {ws.status === 'archived' && (
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => handleRestore(ws.id)}
                      >
                        Restore
                      </button>
                    )}
                    {ws.status !== 'deleted' && (
                      <button
                        type="button"
                        className={cn(styles.actionButton, styles.deleteButton)}
                        onClick={() => setDeleteTarget(ws)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {deleteTarget && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmPanel}>
            <p className={styles.confirmText}>
              Delete workspace <strong>{workspaceLabel(deleteTarget)}</strong>? This action cannot
              be undone.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.confirmDeleteButton}
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
