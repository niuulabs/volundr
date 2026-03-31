import { useState, useEffect, useCallback } from 'react';
import { Upload, Trash2, RotateCcw, FileText } from 'lucide-react';
import { getAccessToken } from '@/modules/volundr/adapters/api/client';
import styles from './DotfileManager.module.css';

interface Dotfile {
  name: string;
  exists: boolean;
  hasDefault: boolean;
  size?: number;
}

interface ShellPreferences {
  default_shell: string;
}

export interface DotfileManagerProps {
  httpBase: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchDotfiles(httpBase: string): Promise<Dotfile[]> {
  try {
    const resp = await fetch(`${httpBase}/api/terminal/dotfiles`, {
      headers: authHeaders(),
    });
    if (!resp.ok) {
      return [];
    }
    const data = (await resp.json()) as { dotfiles: Dotfile[] };
    return data.dotfiles || [];
  } catch {
    return [];
  }
}

async function uploadDotfile(
  httpBase: string,
  filename: string,
  content: string
): Promise<boolean> {
  try {
    const resp = await fetch(`${httpBase}/api/terminal/dotfiles`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function deleteDotfile(httpBase: string, filename: string): Promise<boolean> {
  try {
    const resp = await fetch(`${httpBase}/api/terminal/dotfiles/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function fetchPreferences(httpBase: string): Promise<ShellPreferences> {
  try {
    const resp = await fetch(`${httpBase}/api/terminal/preferences`, {
      headers: authHeaders(),
    });
    if (!resp.ok) {
      return { default_shell: 'bash' };
    }
    return (await resp.json()) as ShellPreferences;
  } catch {
    return { default_shell: 'bash' };
  }
}

async function savePreferences(httpBase: string, shell: string): Promise<boolean> {
  try {
    const resp = await fetch(`${httpBase}/api/terminal/preferences`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_shell: shell }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

const SHELL_OPTIONS = ['bash', 'zsh', 'fish'] as const;

export function DotfileManager({ httpBase }: DotfileManagerProps) {
  const [dotfiles, setDotfiles] = useState<Dotfile[]>([]);
  const [defaultShell, setDefaultShell] = useState('bash');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [files, prefs] = await Promise.all([fetchDotfiles(httpBase), fetchPreferences(httpBase)]);
    setDotfiles(files);
    setDefaultShell(prefs.default_shell);
    setLoading(false);
  }, [httpBase]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [files, prefs] = await Promise.all([
        fetchDotfiles(httpBase),
        fetchPreferences(httpBase),
      ]);
      if (!cancelled) {
        setDotfiles(files);
        setDefaultShell(prefs.default_shell);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [httpBase]);

  const handleUpload = useCallback(
    async (filename: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          return;
        }
        const content = await file.text();
        const ok = await uploadDotfile(httpBase, filename, content);
        if (ok) {
          reload();
        }
      };
      input.click();
    },
    [httpBase, reload]
  );

  const handleDelete = useCallback(
    async (filename: string) => {
      const ok = await deleteDotfile(httpBase, filename);
      if (ok) {
        reload();
      }
    },
    [httpBase, reload]
  );

  const handleShellChange = useCallback(
    async (shell: string) => {
      setDefaultShell(shell);
      await savePreferences(httpBase, shell);
    },
    [httpBase]
  );

  if (loading) {
    return <div className={styles.container}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Default Shell</h3>
        <div className={styles.shellOptions}>
          {SHELL_OPTIONS.map(shell => (
            <button
              key={shell}
              className={styles.shellOption}
              data-active={shell === defaultShell}
              onClick={() => handleShellChange(shell)}
            >
              {shell}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Dotfiles</h3>
        <div className={styles.dotfileList}>
          {dotfiles.map(df => (
            <div key={df.name} className={styles.dotfileRow}>
              <div className={styles.dotfileInfo}>
                <FileText className={styles.fileIcon} />
                <span className={styles.dotfileName}>{df.name}</span>
                {df.exists && df.size !== undefined && (
                  <span className={styles.dotfileSize}>{df.size}B</span>
                )}
              </div>
              <div className={styles.dotfileActions}>
                <button
                  className={styles.actionButton}
                  onClick={() => handleUpload(df.name)}
                  aria-label={`Upload ${df.name}`}
                  title="Upload"
                >
                  <Upload className={styles.actionIcon} />
                </button>
                {df.exists && (
                  <button
                    className={styles.actionButton}
                    data-danger="true"
                    onClick={() => handleDelete(df.name)}
                    aria-label={`Delete ${df.name}`}
                    title={df.hasDefault ? 'Delete (default will restore on next shell)' : 'Delete'}
                  >
                    {df.hasDefault ? (
                      <RotateCcw className={styles.actionIcon} />
                    ) : (
                      <Trash2 className={styles.actionIcon} />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
