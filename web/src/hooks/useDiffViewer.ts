import { useState, useCallback, useMemo } from 'react';
import type { DiffData, DiffBase, SessionFile } from '@/models';
import { getAccessToken } from '@/adapters/api/client';
import { volundrService } from '@/adapters';

function buildApiBase(chatEndpoint: string | null): string | null {
  if (!chatEndpoint) {
    return null;
  }
  try {
    const parsed = new URL(chatEndpoint);
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    const basePath = parsed.pathname.replace(/\/(api\/)?session$/, '');
    return `${protocol}//${parsed.host}${basePath}`;
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export interface UseDiffViewerResult {
  files: SessionFile[];
  filesLoading: boolean;
  diff: DiffData | null;
  diffLoading: boolean;
  diffError: Error | null;
  selectedFile: string | null;
  diffBase: DiffBase;
  fetchFiles: () => Promise<void>;
  selectFile: (sessionId: string, filePath: string) => Promise<void>;
  setDiffBase: (base: DiffBase) => void;
  clearDiff: () => void;
}

export function useDiffViewer(chatEndpoint: string | null = null): UseDiffViewerResult {
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [diff, setDiff] = useState<DiffData | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<Error | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffBase, setDiffBaseState] = useState<DiffBase>('last-commit');

  const apiBase = useMemo(() => buildApiBase(chatEndpoint), [chatEndpoint]);

  const fetchFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      if (!apiBase) {
        return;
      }
      const params = new URLSearchParams({ base: diffBase });
      const response = await fetch(`${apiBase}/api/diff/files?${params}`, {
        headers: authHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files ?? []);
      }
    } catch {
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [apiBase, diffBase]);

  const fetchDiff = useCallback(
    async (sessionId: string, filePath: string, base: DiffBase): Promise<DiffData> => {
      if (apiBase) {
        const params = new URLSearchParams({ file: filePath, base });
        const response = await fetch(`${apiBase}/api/diff?${params}`, {
          headers: authHeaders(),
        });
        if (response.ok) {
          return response.json();
        }
      }
      // Fallback: use Volundr API proxy
      return volundrService.getSessionDiff(sessionId, filePath, base);
    },
    [apiBase]
  );

  const selectFile = useCallback(
    async (sessionId: string, filePath: string) => {
      setSelectedFile(filePath);
      setDiffLoading(true);
      setDiffError(null);
      try {
        const data = await fetchDiff(sessionId, filePath, diffBase);
        setDiff(data);
      } catch (err) {
        setDiffError(err instanceof Error ? err : new Error('Failed to fetch diff'));
        setDiff(null);
      } finally {
        setDiffLoading(false);
      }
    },
    [diffBase, fetchDiff]
  );

  const refetchFiles = useCallback(
    async (base: DiffBase) => {
      if (!apiBase) return;
      setFilesLoading(true);
      try {
        const params = new URLSearchParams({ base });
        const response = await fetch(`${apiBase}/api/diff/files?${params}`, {
          headers: authHeaders(),
        });
        if (response.ok) {
          const data = await response.json();
          setFiles(data.files ?? []);
        }
      } catch {
        setFiles([]);
      } finally {
        setFilesLoading(false);
      }
    },
    [apiBase]
  );

  const setDiffBase = useCallback(
    (base: DiffBase) => {
      setDiffBaseState(base);
      // Re-fetch the file list for the new base
      refetchFiles(base);
      // Clear selected file — the old selection may not exist in the new base
      setSelectedFile(null);
      setDiff(null);
      setDiffError(null);
    },
    [refetchFiles]
  );

  const clearDiff = useCallback(() => {
    setDiff(null);
    setSelectedFile(null);
    setDiffError(null);
    setFiles([]);
  }, []);

  return {
    files,
    filesLoading,
    diff,
    diffLoading,
    diffError,
    selectedFile,
    diffBase,
    fetchFiles,
    selectFile,
    setDiffBase,
    clearDiff,
  };
}
