import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Wifi, WifiOff } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';
import { cn } from '@/utils';
import { TerminalTabBar } from '@/components/TerminalTabBar';
import { TerminalAccessoryBar } from '@/components/TerminalAccessoryBar';
import type { TerminalTab } from '@/models';
import styles from './SessionTerminal.module.css';

const FONT_LOAD_TIMEOUT_MS = 2000;
const TERMINAL_FONT = '13px "JetBrains Mono"';

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

function makeTabLabel(index: number): string {
  return `Terminal ${index + 1}`;
}

/**
 * Multi-tab interactive PTY terminal backed by xterm.js + WebSocket.
 *
 * Protocol (both directions are JSON):
 *   Client -> Server: { type: "input", data: string } | { type: "resize", cols: number, rows: number }
 *   Server -> Client: { type: "output", data: string } | { type: "exit", data: string }
 */
export function SessionTerminal({ url, className }: SessionTerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [
    { id: 'default', label: makeTabLabel(0), restricted: false },
  ]);
  const [activeTabId, setActiveTabId] = useState('default');
  const [connected, setConnected] = useState(false);
  const [fontReady, setFontReady] = useState(false);

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const instanceRefs = useRef<Map<string, TerminalInstance>>(new Map());
  const tabCounterRef = useRef(1);
  const isTouch = useIsTouchDevice();

  // Compute the WebSocket URL for the active tab
  const activeWsUrl = useMemo(() => {
    if (!url) {
      return null;
    }
    // For the default ad-hoc tab, use the base URL (backward compat)
    if (activeTabId === 'default') {
      return url;
    }
    // For spawned tabs, append terminalId
    const base = url.replace(/\/ws\/?$/, '');
    return `${base}/ws/${activeTabId}`;
  }, [url, activeTabId]);

  // Stable reference so the WebSocket callbacks can write to xterm
  const writeToTerminal = useCallback(
    (data: string) => {
      instanceRefs.current.get(activeTabId)?.term.write(data);
    },
    [activeTabId]
  );

  const { sendJson } = useWebSocket(activeWsUrl, {
    onOpen: () => {
      setConnected(true);
      const inst = instanceRefs.current.get(activeTabId);
      if (inst) {
        sendJson({ type: 'resize', cols: inst.term.cols, rows: inst.term.rows });
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
    Promise.race([
      document.fonts.load(TERMINAL_FONT),
      new Promise(r => setTimeout(r, FONT_LOAD_TIMEOUT_MS)),
    ]).then(() => {
      if (!cancelled) {
        setFontReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        fontFamily: 'var(--font-mono), "JetBrains Mono", "Fira Code", monospace',
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

  // Forward terminal input to WebSocket for active tab
  useEffect(() => {
    const inst = instanceRefs.current.get(activeTabId);
    if (!inst) {
      return;
    }

    const disposable = inst.term.onData((data: string) => {
      sendJson({ type: 'input', data });
    });

    return () => disposable.dispose();
  }, [activeTabId, sendJson]);

  // Forward resize events
  useEffect(() => {
    const inst = instanceRefs.current.get(activeTabId);
    if (!inst) {
      return;
    }

    const disposable = inst.term.onResize(({ cols, rows }) => {
      sendJson({ type: 'resize', cols, rows });
    });

    return () => disposable.dispose();
  }, [activeTabId, sendJson]);

  // Refit on container resize
  useEffect(() => {
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

  // Tab management
  const handleAddTab = useCallback(() => {
    const index = tabCounterRef.current;
    tabCounterRef.current += 1;
    const newTab: TerminalTab = {
      id: `tab-${index}`,
      label: makeTabLabel(index),
      restricted: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
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
    [activeTabId]
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
      </div>

      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onAddTab={handleAddTab}
      />

      <div className={styles.terminalArea}>
        {tabs.map(tab => (
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
        ))}
      </div>

      {isTouch && <TerminalAccessoryBar onInput={handleAccessoryInput} />}
    </div>
  );
}
