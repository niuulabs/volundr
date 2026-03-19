import { useState, useEffect, useCallback, useMemo } from 'react';
import { HardDrive } from 'lucide-react';
import type { VolundrWorkspace, WorkspaceStatus, AdminSettings } from '@/models';
import type { IVolundrService } from '@/ports';
import { cn } from '@/utils/classnames';
import styles from './StorageSection.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type StatusFilter = 'all' | WorkspaceStatus;

interface StorageSectionProps {
  service: IVolundrService;
}

export function StorageSection({ service }: StorageSectionProps) {
  const [workspaces, setWorkspaces] = useState<VolundrWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<VolundrWorkspace | null>(null);
  const [adminSettings, setAdminSettings] = useState<AdminSettings | null>(null);
  const [settingsToggling, setSettingsToggling] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const data = await service.listAllWorkspaces();
      setWorkspaces(data);
    } finally {
      setLoading(false);
    }
  }, [service]);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await service.getAdminSettings();
      setAdminSettings(settings);
    } catch {
      // Settings endpoint may not be available in all environments
    }
  }, [service]);

  useEffect(() => {
    loadWorkspaces();
    loadSettings();
  }, [loadWorkspaces, loadSettings]);

  const handleToggleHomeEnabled = useCallback(async () => {
    if (!adminSettings) {
      return;
    }
    setSettingsToggling(true);
    try {
      const updated = await service.updateAdminSettings({
        storage: {
          ...adminSettings.storage,
          homeEnabled: !adminSettings.storage.homeEnabled,
        },
      });
      setAdminSettings(updated);
    } finally {
      setSettingsToggling(false);
    }
  }, [service, adminSettings]);

  const handleToggleFileManager = useCallback(async () => {
    if (!adminSettings) {
      return;
    }
    setSettingsToggling(true);
    try {
      const updated = await service.updateAdminSettings({
        storage: {
          ...adminSettings.storage,
          fileManagerEnabled: !adminSettings.storage.fileManagerEnabled,
        },
      });
      setAdminSettings(updated);
    } finally {
      setSettingsToggling(false);
    }
  }, [service, adminSettings]);

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

  const uniqueUsers = useMemo(() => [...new Set(workspaces.map(w => w.ownerId))], [workspaces]);

  const filteredWorkspaces = useMemo(() => {
    let result = workspaces;
    if (statusFilter !== 'all') {
      result = result.filter(w => w.status === statusFilter);
    }
    if (userFilter !== 'all') {
      result = result.filter(w => w.ownerId === userFilter);
    }
    return result;
  }, [workspaces, statusFilter, userFilter]);

  const totalCount = workspaces.length;
  const activeCount = workspaces.filter(w => w.status === 'active').length;
  const archivedCount = workspaces.filter(w => w.status === 'archived').length;
  const totalStorageGb = workspaces
    .filter(w => w.status !== 'deleted')
    .reduce((sum, w) => sum + w.sizeGb, 0);

  if (loading) {
    return <div className={styles.loadingSpinner}>Loading workspaces...</div>;
  }

  return (
    <div className={styles.section}>
      {/* Settings */}
      {adminSettings && (
        <div className={styles.settingsPanel}>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>Persistent home directories</span>
              <span className={styles.settingDescription}>
                Mount a persistent volume as $HOME for each session. Preserves dotfiles, shell
                history, and CLI credentials across sessions.
              </span>
            </div>
            <button
              type="button"
              className={cn(styles.toggle, adminSettings.storage.homeEnabled && styles.toggleOn)}
              onClick={handleToggleHomeEnabled}
              disabled={settingsToggling}
              aria-label="Toggle persistent home directories"
            >
              <span className={styles.toggleKnob} />
            </button>
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingLabel}>File Manager</span>
              <span className={styles.settingDescription}>
                Show the Files tab in sessions, allowing users to upload, download, and manage files
                in session workspaces and home directories.
              </span>
            </div>
            <button
              type="button"
              className={cn(styles.toggle, adminSettings.storage.fileManagerEnabled && styles.toggleOn)}
              onClick={handleToggleFileManager}
              disabled={settingsToggling}
              aria-label="Toggle file manager"
            >
              <span className={styles.toggleKnob} />
            </button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className={styles.summaryCards}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Total</div>
          <div className={styles.summaryValue}>{totalCount}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Active</div>
          <div className={styles.summaryValue}>{activeCount}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Archived</div>
          <div className={styles.summaryValue}>{archivedCount}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Storage</div>
          <div className={styles.summaryValue}>{totalStorageGb} GB</div>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <span className={styles.filterLabel}>User</span>
        <select
          className={styles.filterSelect}
          value={userFilter}
          onChange={e => setUserFilter(e.target.value)}
        >
          <option value="all">All users</option>
          {uniqueUsers.map(uid => (
            <option key={uid} value={uid}>
              {uid}
            </option>
          ))}
        </select>

        <span className={styles.filterLabel}>Status</span>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Table */}
      {filteredWorkspaces.length === 0 ? (
        <div className={styles.emptyState}>
          <HardDrive className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>No workspaces match the current filters</span>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeader}>User</th>
              <th className={styles.tableHeader}>PVC Name</th>
              <th className={styles.tableHeader}>Session</th>
              <th className={styles.tableHeader}>Size</th>
              <th className={styles.tableHeader}>Status</th>
              <th className={styles.tableHeader}>Created</th>
              <th className={styles.tableHeader}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredWorkspaces.map(ws => (
              <tr key={ws.id} className={styles.tableRow}>
                <td className={cn(styles.tableCell, styles.userCell)} title={ws.ownerId}>
                  {ws.ownerId}
                </td>
                <td className={cn(styles.tableCell, styles.pvcName)}>{ws.pvcName}</td>
                <td className={cn(styles.tableCell, styles.pvcName)}>{ws.sessionId ?? '--'}</td>
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
              Delete workspace <strong>{deleteTarget.pvcName}</strong>? This action cannot be
              undone.
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
