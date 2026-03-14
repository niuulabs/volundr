import { useRef, useEffect, useState, useCallback } from 'react';
import { Code, RotateCcw } from 'lucide-react';
import { cn } from '@/utils';
import { getAccessToken } from '@/adapters/api/client';
import { createBearerWebSocketFactory, VSCODE_REH_PROTOCOL } from '@/utils/bearerWebSocketFactory';
import { ApiEditorAdapter } from '@/adapters/api/editor.adapter';
import { isInitialized, getInitializedSessionId, markInitialized } from './editorState';
import styles from './EditorPanel.module.css';

export interface EditorPanelProps {
  /** Session pod hostname for the REH server connection. */
  hostname: string | null;
  /** Session identifier. */
  sessionId: string | null;
  /** Additional CSS class name. */
  className?: string;
}

type EditorStatus = 'idle' | 'initializing' | 'connected' | 'error' | 'session-changed';

const editorService = new ApiEditorAdapter();

/**
 * VS Code workbench panel using @codingame/monaco-vscode-api.
 *
 * Renders the full VS Code workbench inside a div, connected to a
 * VS Code REH server in the session pod. All WebSocket connections
 * use subprotocol bearer auth via the custom WebSocket factory.
 *
 * ## Session switching constraint
 *
 * VS Code's `initialize()` registers global services (file system,
 * extension host, terminal mux) that cannot be torn down or
 * re-created. Calling it a second time throws. This is upstream VS
 * Code architecture, not a limitation of @codingame/monaco-vscode-api.
 *
 * Two strategies exist for handling session switches:
 *
 * 1. **Page reload** (current implementation) — detect that the
 *    `sessionId` changed after init and prompt the user to reload.
 *    Simple, no extra iframes, works today.
 *
 * 2. **iframe isolation** — render the workbench inside an iframe so
 *    each session gets its own JS context. CodinGame documents this
 *    as a supported pattern. Adds complexity (postMessage bridge for
 *    auth tokens, theme sync) but avoids a full page reload.
 *
 * We use strategy 1 for the spike. Strategy 2 can be adopted in a
 * follow-up ticket if seamless session switching becomes a
 * requirement.
 */
export function EditorPanel({ hostname, sessionId, className }: EditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<EditorStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const initializeWorkbench = useCallback(async () => {
    if (!hostname || !sessionId || !containerRef.current) {
      return;
    }

    if (isInitialized() && getInitializedSessionId() !== sessionId) {
      setStatus('session-changed');
      return;
    }

    if (isInitialized()) {
      setStatus('connected');
      return;
    }

    setStatus('initializing');

    try {
      const config = editorService.getWorkbenchConfig(sessionId, hostname);

      const wsFactory = createBearerWebSocketFactory({
        getToken: getAccessToken,
      });

      const [
        { initialize },
        { default: getWorkbenchServiceOverride },
        { default: getRemoteAgentServiceOverride },
        { default: getTerminalServiceOverride },
      ] = await Promise.all([
        import('@codingame/monaco-vscode-api'),
        import('@codingame/monaco-vscode-workbench-service-override'),
        import('@codingame/monaco-vscode-remote-agent-service-override'),
        import('@codingame/monaco-vscode-terminal-service-override'),
      ]);

      await initialize(
        {
          ...getWorkbenchServiceOverride(),
          ...getRemoteAgentServiceOverride(),
          ...getTerminalServiceOverride(),
        },
        containerRef.current,
        {
          remoteAuthority: config.remoteAuthority,
          webSocketFactory: {
            create: (url: string) => {
              const ws = wsFactory(url);
              return {
                send: (data: ArrayBuffer | string) => ws.send(data),
                close: () => ws.close(),
                onOpen: (listener: () => void) => {
                  ws.addEventListener('open', listener);
                },
                onClose: (listener: (code: number, reason: string) => void) => {
                  ws.addEventListener('close', (e: CloseEvent) => listener(e.code, e.reason));
                },
                onMessage: (listener: (data: ArrayBuffer | string) => void) => {
                  ws.addEventListener('message', (e: MessageEvent) => listener(e.data));
                },
                onError: (listener: (error: unknown) => void) => {
                  ws.addEventListener('error', listener);
                },
                getProtocol: () => VSCODE_REH_PROTOCOL,
              };
            },
          },
        }
      );

      markInitialized(sessionId);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [hostname, sessionId]);

  useEffect(() => {
    initializeWorkbench();
  }, [initializeWorkbench]);

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

  if (status === 'session-changed') {
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

  const statusLabel =
    status === 'initializing' ? 'Connecting...' : status === 'connected' ? 'Connected' : 'Idle';

  const statusDotClass =
    status === 'initializing'
      ? styles.statusDotConnecting
      : status === 'connected'
        ? styles.statusDotConnected
        : styles.statusDotDisconnected;

  return (
    <div className={cn(styles.container, className)}>
      <div ref={containerRef} className={styles.workbench} />
      <div className={styles.statusBar}>
        <span className={cn(styles.statusDot, statusDotClass)} />
        <span>{statusLabel}</span>
        <span>{hostname}</span>
      </div>
    </div>
  );
}
