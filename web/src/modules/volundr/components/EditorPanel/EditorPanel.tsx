import { useRef, useEffect, useState } from 'react';
import { Code } from 'lucide-react';
import { cn } from '@/utils';
import { isInitialized } from './editorState';
import { getActiveRoute } from './sessionRouter';
import { initWorkbench, switchSession } from './workbenchInit';
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
  /** When true, keep the DOM mounted but visually hidden. */
  hidden?: boolean;
}

type EditorStatus = 'idle' | 'initializing' | 'connected' | 'switching' | 'error';

/**
 * VS Code workbench panel using @codingame/monaco-vscode-api.
 *
 * Renders the full VS Code workbench inside a div, connected to a
 * VS Code REH server in the session pod.
 *
 * The workbench is initialized once on first mount. When the session
 * changes, the WebSocket routing and workspace folder are dynamically
 * swapped without requiring a page reload.
 */
export function EditorPanel({
  hostname,
  sessionId,
  codeEndpoint,
  className,
  hidden,
}: EditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<EditorStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // First-time initialization effect.
  useEffect(() => {
    if (!hostname || !sessionId || !containerRef.current) {
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
  }, [hostname, sessionId, codeEndpoint]);

  // Session switch effect — runs when session changes after initialization.
  useEffect(() => {
    if (!hostname || !sessionId) {
      return;
    }

    if (!isInitialized()) {
      return;
    }

    // Skip if this is already the active session.
    const currentRoute = getActiveRoute();
    if (currentRoute?.sessionId === sessionId) {
      return;
    }

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        if (!cancelled) setStatus('switching');
        return switchSession(sessionId, hostname, codeEndpoint ?? undefined);
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
  }, [hostname, sessionId, codeEndpoint]);

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
    <div className={cn(styles.container, className, hidden && styles.hidden)}>
      <div ref={containerRef} className={styles.workbench} />
    </div>
  );
}
