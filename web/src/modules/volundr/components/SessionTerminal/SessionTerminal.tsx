import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Wifi, WifiOff, Settings } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';
import { getAccessToken } from '@/modules/volundr/adapters/api/client';
import { cn } from '@/utils';
import { TerminalTabBar } from '@/modules/volundr/components/TerminalTabBar';
import { TerminalAccessoryBar } from '@/modules/volundr/components/TerminalAccessoryBar';
import { DotfileManager } from '@/modules/volundr/components/DotfileManager';
import type { TerminalTab } from '@/modules/volundr/models';
import styles from './SessionTerminal.module.css';

const FONT_LOAD_TIMEOUT_MS = 2000;
const TERMINAL_FONT = '13px "JetBrainsMono NF"';
const NERD_FONT_FAMILY =
  '"JetBrainsMono NF", var(--font-mono), "JetBrains Mono", "Fira Code", monospace';

interface TerminalInstance {
  term: XTerm;
  fitAddon: FitAddon;
}

interface SessionTerminalProps {
  /** Base WebSocket URL — e.g. wss://host/terminal/ws */
  url: string | null;
  /** Optional class name for the outer wrapper */
  className?: string;
}

/**
 * Derive the REST base URL from the WebSocket base URL.
 * e.g. wss://host/s/{id}/terminal/ws -> https://host/s/{id}/terminal
 */
function deriveHttpBase(wsUrl: string): string {
  const httpProto = wsUrl.startsWith('wss:') ? 'https:' : 'http:';
  const parsed = new URL(wsUrl);
  const prefix = parsed.pathname.replace(/\/ws\/?$/, '');
  return `${httpProto}//${parsed.host}${prefix}`;
}

interface ServerSession {
  terminalId: string;
  label: string;
  cli_type: string;
  status: string;
}

/**
 * List existing terminal sessions from the server.
 */
async function listSessions(httpBase: string): Promise<ServerSession[]> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const resp = await fetch(`${httpBase}/api/terminal/sessions`, { headers });
    if (!resp.ok) {
      return [];
    }
    const data = (await resp.json()) as { sessions: ServerSession[] };
    return data.sessions || [];
  } catch {
    return [];
  }
}

/**
 * Kill a terminal session via the REST API.
 */
async function killSession(httpBase: string, terminalId: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    await fetch(`${httpBase}/api/terminal/kill`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ terminalId }),
    });
  } catch {
    // Best-effort — the tmux window will be cleaned up on pod restart regardless
  }
}

/**
 * Spawn a terminal session via the REST API.
 * Returns the terminalId on success, null on failure.
 */
async function spawnSession(
  httpBase: string,
  cliType: string,
  name?: string
): Promise<{ terminalId: string; label: string } | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const body: Record<string, string> = { cli_type: cliType };
  if (name) {
    body.name = name;
  }

  try {
    const resp = await fetch(`${httpBase}/api/terminal/spawn`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`Terminal spawn failed (${resp.status}):`, text);
      return null;
    }

    const data = (await resp.json()) as { terminalId: string; label?: string };
    return { terminalId: data.terminalId, label: data.label || data.terminalId };
  } catch (err) {
    console.error('Terminal spawn request failed:', err);
    return null;
  }
}

/**
 * Multi-tab interactive PTY terminal backed by xterm.js + WebSocket.
 *
 * All tabs are spawned via the REST API to get a stable tmux-backed terminal ID.
 * WebSocket connects to /ws/{terminalId} so tab switches reattach to the same session.
 *
 * Protocol (both directions are JSON):
 *   Client -> Server: { type: "input", data: string } | { type: "resize", cols: number, rows: number }
 *   Server -> Client: { type: "output", data: string } | { type: "exit", data: string }
 */
export function SessionTerminal({ url, className }: SessionTerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const [showDotfiles, setShowDotfiles] = useState(false);

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const instanceRefs = useRef<Map<string, TerminalInstance>>(new Map());
  const isTouch = useIsTouchDevice();
  const initialSpawnedRef = useRef(false);

  // Derive HTTP base for REST calls
  const httpBase = useMemo(() => (url ? deriveHttpBase(url) : null), [url]);

  // Compute the WebSocket URL for the active tab
  const activeWsUrl = useMemo(() => {
    if (!url || !activeTabId) {
      return null;
    }
    const base = url.replace(/\/ws\/?$/, '');
    return `${base}/ws/${activeTabId}`;
  }, [url, activeTabId]);

  // Stable reference so the WebSocket callbacks can write to xterm
  const writeToTerminal = useCallback(
    (data: string) => {
      if (activeTabId) {
        instanceRefs.current.get(activeTabId)?.term.write(data);
      }
    },
    [activeTabId]
  );

  const { sendJson } = useWebSocket(activeWsUrl, {
    onOpen: () => {
      setConnected(true);
      if (activeTabId) {
        const inst = instanceRefs.current.get(activeTabId);
        if (inst) {
          sendJson({ type: 'resize', cols: inst.term.cols, rows: inst.term.rows });
        }
      }
    },
    onMessage: (raw: string) => {
      try {
        const msg = JSON.parse(raw) as { type: string; data?: string };
        if (msg.type === 'output' && msg.data) {
          writeToTerminal(msg.data);
        }
        if (msg.type === 'exit') {
          writeToTerminal('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
        }
      } catch {
        writeToTerminal(raw);
      }
    },
    onClose: () => setConnected(false),
    onError: () => setConnected(false),
  });

  // Wait for terminal font before initializing
  useEffect(() => {
    let cancelled = false;

    async function waitForFont() {
      // Wait for all font-face declarations to finish loading
      await document.fonts.ready;

      // Explicitly load the Nerd Font (triggers fetch if not already started)
      try {
        await Promise.race([
          document.fonts.load(TERMINAL_FONT),
          new Promise(r => setTimeout(r, FONT_LOAD_TIMEOUT_MS)),
        ]);
      } catch {
        // Font load failed — proceed with fallback
      }

      if (!cancelled) {
        setFontReady(true);
      }
    }

    waitForFont();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load existing sessions or spawn an initial shell tab
  useEffect(() => {
    if (!httpBase || initialSpawnedRef.current) {
      return;
    }
    initialSpawnedRef.current = true;

    (async () => {
      // Check for existing sessions (e.g. after tab switch re-mount)
      const existing = await listSessions(httpBase);
      if (existing.length > 0) {
        const restoredTabs = existing.map((s, i) => ({
          id: s.terminalId,
          label: s.label || `Terminal ${i + 1}`,
          restricted: false,
          cliType: s.cli_type,
        }));
        setTabs(restoredTabs);
        setActiveTabId(restoredTabs[0].id);
        return;
      }

      // No existing sessions — spawn a fresh shell
      const result = await spawnSession(httpBase, 'shell');
      if (!result) {
        return;
      }
      const tab: TerminalTab = {
        id: result.terminalId,
        label: 'Terminal 1',
        restricted: false,
        cliType: 'shell',
      };
      setTabs([tab]);
      setActiveTabId(result.terminalId);
    })();
  }, [httpBase]);

  // Create xterm instance for a tab when its container mounts
  const mountTerminal = useCallback(
    (tabId: string, container: HTMLDivElement | null) => {
      if (!container || !fontReady) {
        return;
      }

      // Already mounted
      if (instanceRefs.current.has(tabId)) {
        return;
      }

      containerRefs.current.set(tabId, container);

      const term = new XTerm({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: NERD_FONT_FAMILY,
        fontSize: 13,
        lineHeight: 1.4,
        theme: {
          background: '#09090b',
          foreground: '#a1a1aa',
          cursor: '#f97316',
          cursorAccent: '#09090b',
          selectionBackground: '#f9731640',
          selectionForeground: '#fafafa',
          black: '#09090b',
          red: '#ef4444',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#a1a1aa',
          brightBlack: '#52525b',
          brightRed: '#f87171',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#fafafa',
        },
        allowProposedApi: true,
        scrollback: 5000,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(container);

      try {
        fitAddon.fit();
      } catch {
        // Container might not be visible yet
      }

      instanceRefs.current.set(tabId, { term, fitAddon });
    },
    [fontReady]
  );

  // Dispose xterm instances on unmount
  useEffect(() => {
    const instances = instanceRefs.current;
    const containers = containerRefs.current;
    return () => {
      for (const inst of instances.values()) {
        inst.term.dispose();
      }
      instances.clear();
      containers.clear();
    };
  }, []);

  // Forward terminal input to WebSocket for active tab.
  // Depends on fontReady so the effect re-runs after the xterm instance is created.
  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    const inst = instanceRefs.current.get(activeTabId);
    if (!inst) {
      return;
    }

    const disposable = inst.term.onData((data: string) => {
      sendJson({ type: 'input', data });
    });

    return () => disposable.dispose();
  }, [activeTabId, sendJson, fontReady]);

  // Forward resize events
  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    const inst = instanceRefs.current.get(activeTabId);
    if (!inst) {
      return;
    }

    const disposable = inst.term.onResize(({ cols, rows }) => {
      sendJson({ type: 'resize', cols, rows });
    });

    return () => disposable.dispose();
  }, [activeTabId, sendJson, fontReady]);

  // Refit on container resize
  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    const container = containerRefs.current.get(activeTabId);
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      try {
        instanceRefs.current.get(activeTabId)?.fitAddon.fit();
      } catch {
        // Ignore fit errors during transitions
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [activeTabId]);

  // Refit when tab changes
  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    // Small delay to let display: none -> block settle
    const timer = setTimeout(() => {
      try {
        instanceRefs.current.get(activeTabId)?.fitAddon.fit();
      } catch {
        // ignore
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [activeTabId]);

  // Handle accessory bar input
  const handleAccessoryInput = useCallback(
    (data: string) => {
      sendJson({ type: 'input', data });
    },
    [sendJson]
  );

  // Tab management — local-only fallback (should not normally be needed)
  const handleAddTab = useCallback(() => {
    if (!httpBase) {
      return;
    }
    spawnSession(httpBase, 'shell').then(result => {
      if (!result) {
        return;
      }
      const newTab: TerminalTab = {
        id: result.terminalId,
        label: result.label,
        restricted: false,
        cliType: 'shell',
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(result.terminalId);
    });
  }, [httpBase]);

  // Spawn a CLI tab via the terminal REST API
  const handleAddCliTab = useCallback(
    async (cliType: string) => {
      if (!httpBase) {
        return;
      }

      const result = await spawnSession(httpBase, cliType);
      if (!result) {
        return;
      }

      const newTab: TerminalTab = {
        id: result.terminalId,
        label: result.label,
        restricted: false,
        cliType,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(result.terminalId);
    },
    [httpBase]
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      // Kill the server-side tmux session
      if (httpBase) {
        killSession(httpBase, tabId);
      }

      setTabs(prev => {
        if (prev.length <= 1) {
          return prev;
        }
        const filtered = prev.filter(t => t.id !== tabId);

        // If we're closing the active tab, switch to an adjacent tab
        if (tabId === activeTabId) {
          const closedIndex = prev.findIndex(t => t.id === tabId);
          const newActive = filtered[Math.min(closedIndex, filtered.length - 1)];
          setActiveTabId(newActive.id);
        }

        // Clean up xterm instance
        const inst = instanceRefs.current.get(tabId);
        if (inst) {
          inst.term.dispose();
          instanceRefs.current.delete(tabId);
        }
        containerRefs.current.delete(tabId);

        return filtered;
      });
    },
    [activeTabId, httpBase]
  );

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  return (
    <div className={cn(styles.wrapper, className)}>
      <div className={styles.toolbar}>
        <div className={styles.statusIndicator} data-connected={connected}>
          {connected ? (
            <Wifi className={styles.statusIcon} />
          ) : (
            <WifiOff className={styles.statusIcon} />
          )}
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <button
          className={styles.settingsButton}
          onClick={() => setShowDotfiles(prev => !prev)}
          aria-label="Terminal settings"
          aria-pressed={showDotfiles}
        >
          <Settings className={styles.statusIcon} />
        </button>
      </div>

      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId ?? ''}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onAddTab={handleAddTab}
        onAddCliTab={handleAddCliTab}
      />

      <div className={styles.terminalArea}>
        {showDotfiles && httpBase ? (
          <DotfileManager httpBase={httpBase} />
        ) : (
          tabs.map(tab => (
            <div
              key={tab.id}
              className={styles.terminalContainer}
              data-visible={tab.id === activeTabId}
              ref={el => {
                if (el) {
                  mountTerminal(tab.id, el);
                }
              }}
            />
          ))
        )}
      </div>

      {isTouch && <TerminalAccessoryBar onInput={handleAccessoryInput} />}
    </div>
  );
}
