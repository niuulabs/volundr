import { useRef, useEffect, useState, useMemo } from 'react';
import { Code, RotateCcw } from 'lucide-react';
import { cn } from '@/utils';
import { isInitialized, getInitializedSessionId } from './editorState';
import { initWorkbench } from './workbenchInit';
import styles from './EditorPanel.module.css';

export interface EditorPanelProps {
  /** Session pod hostname for the REH server connection. */
  hostname: string | null;
  /** Session identifier. */
  sessionId: string | null;
  /** Code endpoint URL — used to derive the session base path for routing. */
  codeEndpoint?: string | null;
  /** Additional CSS class name. */
  className?: string;
}

type EditorStatus = 'idle' | 'initializing' | 'connected' | 'error';

/**
 * VS Code workbench panel using @codingame/monaco-vscode-api.
 *
 * Renders the full VS Code workbench inside a div, connected to a
 * VS Code REH server in the session pod.
 *
 * `initialize()` can only be called once per page load (upstream VS Code
 * constraint). If the sessionId changes, the user must reload the page.
 */
export function EditorPanel({ hostname, sessionId, codeEndpoint, className }: EditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<EditorStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Derive session-changed state without setState in the effect body.
  const sessionChanged = useMemo(
    () => isInitialized() && sessionId != null && getInitializedSessionId() !== sessionId,
    [sessionId]
  );

  useEffect(() => {
    if (!hostname || !sessionId || !containerRef.current || sessionChanged) {
      return;
    }

    if (isInitialized()) {
      return;
    }

    let cancelled = false;

    initWorkbench({
      hostname,
      sessionId,
      codeEndpoint: codeEndpoint ?? undefined,
      container: containerRef.current,
    })
      .then(() => {
        if (!cancelled) setStatus('connected');
      })
      .catch(err => {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hostname, sessionId, codeEndpoint, sessionChanged]);

  if (!hostname || !sessionId) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.emptyState}>
          <Code className={styles.emptyIcon} />
          <p>Start a session to access the editor</p>
        </div>
      </div>
    );
  }

  if (sessionChanged) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.emptyState}>
          <RotateCcw className={styles.emptyIcon} />
          <p>Session changed — the editor requires a page reload to reconnect.</p>
          <button
            className={styles.reloadButton}
            onClick={() => globalThis.location.reload()}
            type="button"
          >
            <RotateCcw size={14} />
            Reload page
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.emptyState}>
          <Code className={styles.emptyIcon} />
          <p>Failed to initialize editor</p>
          {errorMessage && <p>{errorMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)}>
      <div ref={containerRef} className={styles.workbench} />
    </div>
  );
}
