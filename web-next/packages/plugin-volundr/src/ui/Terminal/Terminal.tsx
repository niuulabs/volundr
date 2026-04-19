import { useEffect, useRef, useCallback, useState } from 'react';
import type { IPtyStream } from '../../ports/IPtyStream';

const DEFAULT_RECONNECT_DELAY_MS = 3_000;

export interface TerminalProps {
  sessionId: string;
  stream: IPtyStream;
  /** When true, keyboard input is disabled (archived/read-only sessions). */
  readOnly?: boolean;
  /**
   * Milliseconds to wait before attempting a reconnect.
   * Override in tests to avoid real delays.
   * @default 3000
   */
  reconnectDelayMs?: number;
  className?: string;
}

interface TerminalHandle {
  xterm: unknown;
  dispose: () => void;
}

/** Mounts an xterm.js terminal connected to the given IPtyStream. */
export function Terminal({
  sessionId,
  stream,
  readOnly = false,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  className,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectionState, setConnectionState] = useState<
    'connecting' | 'connected' | 'reconnecting'
  >('connecting');

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!handleRef.current) return;
    const { xterm } = handleRef.current as {
      xterm: {
        write: (s: string) => void;
        onData: (cb: (d: string) => void) => { dispose: () => void };
      };
    };

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    setConnectionState('connecting');

    const unsub = stream.subscribe(sessionId, (chunk) => {
      xterm.write(chunk);
      setConnectionState('connected');
      clearReconnectTimer();
    });

    unsubscribeRef.current = unsub;

    // Wire up keyboard input (disabled in read-only mode).
    if (!readOnly) {
      const dataDispose = xterm.onData((data: string) => {
        stream.send(sessionId, data);
      });
      const originalUnsub = unsub;
      unsubscribeRef.current = () => {
        dataDispose.dispose();
        originalUnsub();
      };
    }
  }, [sessionId, stream, readOnly, clearReconnectTimer]);

  /** Public reconnect — also triggered automatically on session change. */
  const reconnect = useCallback(() => {
    clearReconnectTimer();
    setConnectionState('reconnecting');
    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, reconnectDelayMs);
  }, [connect, clearReconnectTimer, reconnectDelayMs]);

  // Initialise xterm once and keep it alive for the lifetime of the component.
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    // Dynamic import keeps xterm out of the SSR bundle.
    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (cancelled || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const xterm = new XTerm({
        theme: {
          background: '#09090b',
          foreground: '#fafafa',
          cursor: '#a1a1aa',
          selectionBackground: '#3f3f46',
        },
        fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: !readOnly,
        disableStdin: readOnly,
        scrollback: 5_000,
      });

      xterm.loadAddon(fitAddon);
      xterm.open(containerRef.current);
      fitAddon.fit();

      handleRef.current = {
        xterm,
        dispose: () => {
          fitAddon.dispose();
          xterm.dispose();
        },
      };

      // Fit on resize.
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(containerRef.current);

      connect();

      handleRef.current.dispose = () => {
        resizeObserver.disconnect();
        fitAddon.dispose();
        xterm.dispose();
      };
    })();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (handleRef.current) {
        handleRef.current.dispose();
        handleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-subscribe when sessionId or stream changes.
  useEffect(() => {
    if (!handleRef.current) return;
    connect();
    return () => {
      clearReconnectTimer();
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [sessionId, stream, connect, clearReconnectTimer]);

  return (
    <div
      className={[
        'niuu-relative niuu-h-full niuu-w-full niuu-overflow-hidden niuu-rounded-md niuu-bg-[#09090b]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {connectionState !== 'connected' && (
        <div
          className="niuu-absolute niuu-top-2 niuu-right-2 niuu-z-10 niuu-flex niuu-items-center niuu-gap-1.5 niuu-rounded niuu-bg-bg-elevated niuu-px-2 niuu-py-1 niuu-text-xs niuu-text-text-muted"
          role="status"
          data-testid="terminal-connection-status"
        >
          <span
            className={[
              'niuu-inline-block niuu-h-1.5 niuu-w-1.5 niuu-rounded-full',
              connectionState === 'reconnecting'
                ? 'niuu-animate-pulse niuu-bg-amber-400'
                : 'niuu-animate-pulse niuu-bg-zinc-500',
            ].join(' ')}
          />
          {connectionState === 'reconnecting' ? 'reconnecting…' : 'connecting…'}
        </div>
      )}
      {readOnly && (
        <div
          className="niuu-absolute niuu-top-2 niuu-left-2 niuu-z-10 niuu-rounded niuu-bg-bg-elevated niuu-px-2 niuu-py-1 niuu-text-xs niuu-text-text-muted"
          aria-label="read-only terminal"
          data-testid="terminal-readonly-badge"
        >
          read-only
        </div>
      )}
      <div
        ref={containerRef}
        className="niuu-h-full niuu-w-full"
        data-testid="terminal-container"
        aria-label={readOnly ? 'read-only terminal output' : 'interactive terminal'}
        role="region"
      />
      {!readOnly && (
        <button
          className="niuu-absolute niuu-bottom-2 niuu-right-2 niuu-z-10 niuu-rounded niuu-bg-bg-elevated niuu-px-2 niuu-py-1 niuu-text-xs niuu-text-text-muted niuu-opacity-60 hover:niuu-opacity-100"
          onClick={reconnect}
          aria-label="reconnect terminal"
          data-testid="terminal-reconnect-button"
        >
          reconnect
        </button>
      )}
    </div>
  );
}
