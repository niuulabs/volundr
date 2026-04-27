import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAccessToken } from '@niuulabs/query';
import { cn } from '@niuulabs/ui';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface SessionTerminalLiveProps {
  url: string | null;
  readOnly?: boolean;
}

interface TerminalTab {
  id: string;
  label: string;
  cliType: string;
}

interface ServerSession {
  terminalId: string;
  label: string;
  cli_type: string;
  status: string;
}

interface TerminalInstance {
  term: XTerm;
  fitAddon: FitAddon;
}

function deriveHttpBase(wsUrl: string): string {
  const httpProto = wsUrl.startsWith('wss:') ? 'https:' : 'http:';
  const parsed = new URL(wsUrl);
  const prefix = parsed.pathname.replace(/\/ws\/?$/, '');
  return `${httpProto}//${parsed.host}${prefix}`;
}

async function listSessions(httpBase: string): Promise<ServerSession[] | null> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${httpBase}/api/terminal/sessions`, { headers });
  if (resp.status === 404) return null;
  if (!resp.ok) return [];
  const data = (await resp.json()) as { sessions?: ServerSession[] };
  return data.sessions ?? [];
}

async function spawnSession(
  httpBase: string,
  cliType: string,
): Promise<{ terminalId: string; label: string } | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(`${httpBase}/api/terminal/spawn`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cli_type: cliType }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { terminalId: string; label?: string };
  return { terminalId: data.terminalId, label: data.label || data.terminalId };
}

export function SessionTerminalLive({ url, readOnly = false }: SessionTerminalLiveProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const instanceRefs = useRef<Map<string, TerminalInstance>>(new Map());
  const socketRefs = useRef<Map<string, WebSocket>>(new Map());
  const initialisedRef = useRef(false);

  const httpBase = useMemo(() => (url ? deriveHttpBase(url) : null), [url]);
  const activeWsUrl = useMemo(() => {
    if (!url || !activeTabId) return null;
    return `${url.replace(/\/ws\/?$/, '')}/ws/${activeTabId}`;
  }, [activeTabId, url]);

  useEffect(() => {
    if (!httpBase || initialisedRef.current) return;
    initialisedRef.current = true;

    (async () => {
      const existing = await listSessions(httpBase);
      if (existing === null) {
        setUnavailable(true);
        return;
      }
      if (existing.length > 0) {
        const restored = existing.map((session, index) => ({
          id: session.terminalId,
          label: session.label || `Terminal ${index + 1}`,
          cliType: session.cli_type,
        }));
        setTabs(restored);
        setActiveTabId(restored[0]?.id ?? null);
        return;
      }

      const created = await spawnSession(httpBase, 'shell');
      if (!created) {
        setUnavailable(true);
        return;
      }
      setTabs([{ id: created.terminalId, label: 'Terminal 1', cliType: 'shell' }]);
      setActiveTabId(created.terminalId);
    })();
  }, [httpBase]);

  const mountTerminal = useCallback((tabId: string, container: HTMLDivElement | null) => {
    if (!container || instanceRefs.current.has(tabId)) return;
    containerRefs.current.set(tabId, container);

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      disableStdin: readOnly,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#a1a1aa',
        selectionBackground: '#3f3f46',
      },
    });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);
    fitAddon.fit();

    instanceRefs.current.set(tabId, { term, fitAddon });

    if (!readOnly) {
      term.onData((data) => {
        const socket = socketRefs.current.get(tabId);
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });
    }
  }, [readOnly]);

  useEffect(() => {
    if (!activeWsUrl || !activeTabId || unavailable) return;

    const socket = new WebSocket(activeWsUrl + (getAccessToken() ? `?access_token=${encodeURIComponent(getAccessToken()!)}` : ''));
    socketRefs.current.set(activeTabId, socket);

    socket.onopen = () => {
      setConnected(true);
      const instance = instanceRefs.current.get(activeTabId);
      if (instance) {
        socket.send(
          JSON.stringify({
            type: 'resize',
            cols: instance.term.cols,
            rows: instance.term.rows,
          }),
        );
      }
    };

    socket.onmessage = (event) => {
      const instance = instanceRefs.current.get(activeTabId);
      if (!instance) return;
      try {
        const msg = JSON.parse(String(event.data)) as { type: string; data?: string };
        if (msg.type === 'output' && msg.data) instance.term.write(msg.data);
        if (msg.type === 'exit') instance.term.write('\r\n[Process exited]\r\n');
      } catch {
        instance.term.write(String(event.data));
      }
    };

    socket.onclose = () => {
      setConnected(false);
      socketRefs.current.delete(activeTabId);
    };

    return () => {
      socket.close();
      socketRefs.current.delete(activeTabId);
    };
  }, [activeTabId, activeWsUrl, unavailable]);

  if (!url) {
    return (
      <div className="niuu-flex niuu-h-full niuu-items-center niuu-justify-center niuu-text-sm niuu-text-text-muted">
        terminal unavailable
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="niuu-flex niuu-h-full niuu-items-center niuu-justify-center niuu-p-6 niuu-text-center niuu-text-sm niuu-text-text-muted">
        This backend does not expose the legacy terminal transport yet.
      </div>
    );
  }

  return (
    <div className="niuu-flex niuu-h-full niuu-min-h-0 niuu-flex-col niuu-bg-bg-primary">
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-3 niuu-py-2">
        <div className="niuu-flex niuu-items-center niuu-gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                'niuu-flex niuu-items-center niuu-gap-2 niuu-rounded-md niuu-border niuu-px-3 niuu-py-1.5 niuu-font-mono niuu-text-[11px]',
                activeTabId === tab.id
                  ? 'niuu-border-border niuu-bg-bg-elevated niuu-text-text-primary'
                  : 'niuu-border-transparent niuu-text-text-muted hover:niuu-border-border-subtle hover:niuu-text-text-secondary',
              )}
            >
              <span className="niuu-text-brand">{'>_'}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="niuu-font-mono niuu-text-[11px] niuu-text-text-muted">
          {connected ? 'connected' : 'connecting…'}
        </div>
      </div>
      <div className="niuu-min-h-0 niuu-flex-1 niuu-overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(node) => mountTerminal(tab.id, node)}
            className={cn(
              'niuu-h-full niuu-w-full',
              activeTabId === tab.id ? 'niuu-block' : 'niuu-hidden',
            )}
          />
        ))}
      </div>
    </div>
  );
}

