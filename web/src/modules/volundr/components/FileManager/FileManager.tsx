import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Upload,
  FolderOpen,
  File,
  Folder,
  FolderPlus,
  Trash2,
  Download,
  RefreshCw,
  ChevronRight,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import type { FileTreeEntry, FileRoot } from '@/modules/volundr/models';
import { getAccessToken } from '@/modules/volundr/adapters/api/client';
import { cn } from '@/utils';
import styles from './FileManager.module.css';

interface FileManagerProps {
  chatEndpoint: string | null;
  className?: string;
}

interface UploadItem {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildApiBase(chatEndpoint: string | null): string | null {
  if (!chatEndpoint) return null;
  try {
    const parsed = new URL(chatEndpoint);
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    const basePath = parsed.pathname.replace(/\/(api\/)?session$/, '');
    return `${protocol}//${parsed.host}${basePath}`;
  } catch {
    const basePath = chatEndpoint.replace(/\/(api\/)?session$/, '');
    return `${window.location.origin}${basePath}`;
  }
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

export function FileManager({ chatEndpoint, className }: FileManagerProps) {
  const apiBase = useMemo(() => buildApiBase(chatEndpoint), [chatEndpoint]);
  const [root, setRoot] = useState<FileRoot>('workspace');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [showMkdir, setShowMkdir] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
  }, []);

  const fetchEntries = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ root });
      if (currentPath) params.set('path', currentPath);
      const response = await fetch(`${apiBase}/api/files?${params}`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json();
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, currentPath, root]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSelected(null);
  }, []);

  const handleRowClick = useCallback(
    (entry: FileTreeEntry) => {
      if (entry.type === 'directory') {
        navigateTo(entry.path);
        return;
      }
      setSelected(prev => (prev === entry.path ? null : entry.path));
    },
    [navigateTo]
  );

  const handleDownload = useCallback(async () => {
    if (!selected || !apiBase) return;
    try {
      const params = new URLSearchParams({ path: selected, root });
      const response = await fetch(`${apiBase}/api/files/download?${params}`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = selected.split('/').pop() ?? 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Download failed');
    }
  }, [apiBase, selected, root, showError]);

  const handleDelete = useCallback(async () => {
    if (!selected || !apiBase) return;
    try {
      const params = new URLSearchParams({ path: selected, root });
      await fetch(`${apiBase}/api/files?${params}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setSelected(null);
      fetchEntries();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [apiBase, selected, root, fetchEntries, showError]);

  const handleMkdir = useCallback(async () => {
    if (!mkdirName.trim() || !apiBase) return;
    const dirPath = currentPath ? `${currentPath}/${mkdirName.trim()}` : mkdirName.trim();
    try {
      await fetch(`${apiBase}/api/files/mkdir`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath, root }),
      });
      setShowMkdir(false);
      setMkdirName('');
      fetchEntries();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to create folder');
    }
  }, [apiBase, currentPath, root, mkdirName, fetchEntries, showError]);

  const doUpload = useCallback(
    async (files: File[]) => {
      if (!apiBase) return;
      const items: UploadItem[] = files.map(f => ({ file: f, status: 'pending' as const }));
      setUploads(prev => [...prev, ...items]);

      for (const item of items) {
        item.status = 'uploading';
        setUploads(prev => [...prev]);
        try {
          const params = new URLSearchParams({ root });
          if (currentPath) params.set('path', currentPath);
          const formData = new FormData();
          formData.append('files', item.file);
          const response = await fetch(`${apiBase}/api/files/upload?${params}`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
          });
          if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
          item.status = 'done';
        } catch (e) {
          item.status = 'error';
          item.error = e instanceof Error ? e.message : 'Upload failed';
        }
        setUploads(prev => [...prev]);
      }
      fetchEntries();
    },
    [apiBase, currentPath, root, fetchEntries]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        doUpload(files);
      }
    },
    [doUpload]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        doUpload(files);
      }
      e.target.value = '';
    },
    [doUpload]
  );

  const clearDoneUploads = useCallback(() => {
    setUploads(prev => prev.filter(u => u.status !== 'done' && u.status !== 'error'));
  }, []);

  const breadcrumbParts = currentPath ? currentPath.split('/') : [];

  const selectedEntry = selected ? entries.find(e => e.path === selected) : null;
  const canDownload = selectedEntry?.type === 'file';
  const canDelete = !!selected;
  const hasFinishedUploads = uploads.some(u => u.status === 'done' || u.status === 'error');

  return (
    <div
      className={cn(styles.container, dragActive && styles.containerDragActive, className)}
      onDragOver={e => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleFileInput}
        data-testid="file-input"
      />

      <div className={styles.toolbar}>
        <div className={styles.rootToggle}>
          <button
            type="button"
            className={cn(styles.rootButton, root === 'workspace' && styles.rootButtonActive)}
            onClick={() => {
              setRoot('workspace');
              setCurrentPath('');
              setSelected(null);
            }}
          >
            Workspace
          </button>
          <button
            type="button"
            className={cn(styles.rootButton, root === 'home' && styles.rootButtonActive)}
            onClick={() => {
              setRoot('home');
              setCurrentPath('');
              setSelected(null);
            }}
          >
            Home
          </button>
        </div>
        <div className={styles.toolbarSpacer} />
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => fileInputRef.current?.click()}
          title="Upload"
        >
          <Upload className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => setShowMkdir(true)}
          title="New Folder"
        >
          <FolderPlus className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={handleDownload}
          disabled={!canDownload}
          title="Download"
        >
          <Download className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={cn(styles.toolbarButton, styles.toolbarButtonDanger)}
          onClick={handleDelete}
          disabled={!canDelete}
          title="Delete"
        >
          <Trash2 className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={fetchEntries}
          title="Refresh"
        >
          <RefreshCw className={styles.toolbarIcon} />
        </button>
      </div>

      <div className={styles.breadcrumb}>
        <button type="button" className={styles.breadcrumbSegment} onClick={() => navigateTo('')}>
          {root === 'workspace' ? 'workspace' : 'home'}
        </button>
        {breadcrumbParts.map((part, i) => {
          const partPath = breadcrumbParts.slice(0, i + 1).join('/');
          return (
            <span key={partPath}>
              <ChevronRight className={cn(styles.toolbarIcon, styles.breadcrumbSeparatorIcon)} />
              <button
                type="button"
                className={styles.breadcrumbSegment}
                onClick={() => navigateTo(partPath)}
              >
                {part}
              </button>
            </span>
          );
        })}
      </div>

      <div className={styles.fileTable}>
        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : entries.length === 0 ? (
          <div className={styles.emptyDir}>
            <FolderOpen className={styles.emptyIcon} />
            <span>Empty directory</span>
          </div>
        ) : (
          entries.map(entry => (
            <div
              key={entry.path}
              className={cn(styles.fileRow, selected === entry.path && styles.fileRowSelected)}
              onClick={() => handleRowClick(entry)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRowClick(entry);
              }}
            >
              {entry.type === 'directory' ? (
                <Folder className={cn(styles.fileIcon, styles.fileIconDir)} />
              ) : (
                <File className={cn(styles.fileIcon, styles.fileIconFile)} />
              )}
              <span className={styles.fileName}>{entry.name}</span>
              <span className={styles.fileSize}>
                {entry.type === 'file' && entry.size != null ? formatBytes(entry.size) : ''}
              </span>
              <span className={styles.fileModified}>
                {entry.modified ? formatDate(entry.modified) : ''}
              </span>
            </div>
          ))
        )}
      </div>

      {dragActive && (
        <div className={styles.dropOverlay}>
          <Upload className={styles.dropIcon} />
          <span className={styles.dropLabel}>Drop files to upload</span>
        </div>
      )}

      {error && (
        <div className={styles.errorBar} role="alert">
          <XCircle className={styles.toolbarIcon} />
          <span>{error}</span>
          <button type="button" className={styles.errorDismiss} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {uploads.length > 0 && (
        <div className={styles.uploadBar}>
          <div className={styles.uploadBarHeader}>
            <span className={styles.uploadBarTitle}>
              Uploads ({uploads.filter(u => u.status === 'done').length}/{uploads.length})
            </span>
            {hasFinishedUploads && (
              <button type="button" className={styles.uploadBarClear} onClick={clearDoneUploads}>
                Clear
              </button>
            )}
          </div>
          <div className={styles.uploadQueue}>
            {uploads.map((item, i) => (
              <div key={`${item.file.name}-${i}`} className={styles.uploadItem}>
                {item.status === 'done' && (
                  <CheckCircle className={cn(styles.toolbarIcon, styles.uploadItemDone)} />
                )}
                {item.status === 'error' && (
                  <XCircle className={cn(styles.toolbarIcon, styles.uploadItemError)} />
                )}
                {(item.status === 'pending' || item.status === 'uploading') && (
                  <RefreshCw className={cn(styles.toolbarIcon, styles.uploadItemSpinner)} />
                )}
                <span className={styles.uploadItemName}>{item.file.name}</span>
                <span className={styles.uploadItemSize}>{formatBytes(item.file.size)}</span>
                {item.status === 'done' && <span className={styles.uploadItemStatus}>Done</span>}
                {item.status === 'error' && (
                  <span className={styles.uploadItemStatusError}>{item.error ?? 'Failed'}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showMkdir && (
        <>
          <div className={styles.overlay} onClick={() => setShowMkdir(false)} role="presentation" />
          <div className={styles.dialog} role="dialog" aria-label="New Folder">
            <div className={styles.dialogTitle}>New Folder</div>
            <input
              className={styles.dialogInput}
              value={mkdirName}
              onChange={e => setMkdirName(e.target.value)}
              placeholder="folder-name"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleMkdir();
                if (e.key === 'Escape') setShowMkdir(false);
              }}
              data-testid="mkdir-input"
            />
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogButton}
                onClick={() => setShowMkdir(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cn(styles.dialogButton, styles.dialogButtonPrimary)}
                onClick={handleMkdir}
                data-testid="mkdir-submit"
              >
                Create
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
