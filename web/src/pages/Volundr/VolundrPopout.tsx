import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Hammer,
  Terminal,
  Code,
  MessageSquare,
  Zap,
  Server,
  ArrowLeft,
  FolderGit2,
  Globe,
} from 'lucide-react';
import { StatusBadge, SessionTerminal, SessionChat, SessionStartingIndicator } from '@/components';
import { useAuth } from '@/auth';
import { getAccessToken } from '@/adapters/api/client';
import { useVolundr, useBroadcastChannel, useSessionProbe } from '@/hooks';
import type { VolundrSession } from '@/models';
import { isSessionBooting } from '@/models';
import { getSourceLabel, getBranch, isGitSource } from '@/utils/source';
import styles from './VolundrPopout.module.css';

type TabType = 'terminal' | 'code' | 'chat';

export function VolundrPopout() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');
  const tabType = (searchParams.get('tab') as TabType) || 'terminal';

  const { sessions, models, loading, getCodeServerUrl, markSessionRunning } = useVolundr();
  const { enabled: authEnabled } = useAuth();
  const { subscribe } = useBroadcastChannel('volundr-sync');

  // Try to find the session from the fetched list first; fall back to
  // sessionStorage data stashed by the parent window before the popout opened.
  // This avoids the "session not found" flash while the API fetch completes.
  const session = useMemo(() => {
    const fetched = sessions.find(s => s.id === sessionId);
    if (fetched) {
      return fetched;
    }

    if (!sessionId) {
      return undefined;
    }

    try {
      const stored = sessionStorage.getItem(`volundr-popout-session-${sessionId}`);
      if (stored) {
        return JSON.parse(stored) as VolundrSession;
      }
    } catch {
      // Ignore parse errors
    }

    return undefined;
  }, [sessions, sessionId]);
  const selectedModel = session ? models[session.model] : null;
  const isLocal = selectedModel?.provider === 'local';
  const isManual = session?.origin === 'manual';

  // IDE state for code tab - track which session the URL was fetched for
  const [fetchedIde, setFetchedIde] = useState<{ sessionId: string; url: string | null } | null>(
    null
  );

  const shouldLoadIde = tabType === 'code' && !!session?.id && session.status === 'running';

  // For manual sessions, derive the IDE URL directly from the hostname —
  // just like terminal/chat derive their WebSocket URLs.  This avoids a
  // service call that races against the initial data fetch and may fail
  // in a fresh popout window whose service instance has no cached data yet.
  const directIdeUrl = useMemo(() => {
    if (!shouldLoadIde || !session) {
      return null;
    }
    if (session.origin === 'manual' && session.hostname) {
      return `https://${session.hostname}/`;
    }
    return null;
  }, [shouldLoadIde, session]);

  const ideUrl =
    directIdeUrl ??
    (shouldLoadIde && fetchedIde?.sessionId === session?.id ? fetchedIde.url : null);
  const ideLoading = !directIdeUrl && shouldLoadIde && fetchedIde?.sessionId !== session?.id;

  const sessionHost = session?.hostname ?? null;
  const sessionChatEndpoint = session?.chatEndpoint ?? null;
  const isRunning = session?.status === 'running';

  // Track whether the WebSocket has been verified as connectable.
  // Reset when the session changes using the React "adjust state during
  // render" pattern to avoid the cascading-render lint warning.
  const [connectionVerified, setConnectionVerified] = useState(false);
  const [prevSessionId, setPrevSessionId] = useState(session?.id);
  if (prevSessionId !== session?.id) {
    setPrevSessionId(session?.id);
    setConnectionVerified(false);
  }

  // Probe URL for testing whether a session is connectable
  const probeWsUrl = useMemo(() => {
    if (sessionChatEndpoint) return sessionChatEndpoint;
    if (!sessionHost) return null;
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${sessionHost}/session`;
  }, [sessionChatEndpoint, sessionHost]);

  const handleSessionReady = useCallback(() => {
    setConnectionVerified(true);
    if (session && isSessionBooting(session.status)) {
      markSessionRunning(session.id);
    }
  }, [session, markSessionRunning]);

  const isSessionReady = isRunning && (connectionVerified || !sessionHost);

  const terminalWsUrl = useMemo(() => {
    if (!sessionHost || !isSessionReady) {
      return null;
    }
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (sessionChatEndpoint) {
      try {
        const parsed = new URL(sessionChatEndpoint);
        const prefix = parsed.pathname.replace(/\/(api\/)?session$/, '');
        return `${wsProto}//${parsed.host}${prefix}/terminal/ws`;
      } catch {
        /* fall through */
      }
    }
    return `${wsProto}//${sessionHost}/terminal/ws`;
  }, [sessionHost, sessionChatEndpoint, isSessionReady]);

  const chatWsUrl = useMemo(() => {
    if (!sessionHost || !isSessionReady) {
      return null;
    }
    if (sessionChatEndpoint) return sessionChatEndpoint;
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${sessionHost}/session`;
  }, [sessionHost, sessionChatEndpoint, isSessionReady]);

  // Update window title
  useEffect(() => {
    if (session) {
      const tabLabel = tabType === 'terminal' ? 'Terminal' : tabType === 'chat' ? 'Chat' : 'IDE';
      document.title = `${tabLabel} — ${session.name}`;
    }
    return () => {
      document.title = 'Hlidskjalf';
    };
  }, [session, tabType]);

  // Resolve IDE URL when code tab and session is running.
  // Skip when the URL can be derived directly (manual sessions).
  useEffect(() => {
    if (!shouldLoadIde || !session?.id || directIdeUrl) {
      return;
    }

    let cancelled = false;

    getCodeServerUrl(session.id)
      .then(url => {
        if (!cancelled) {
          setFetchedIde({ sessionId: session.id, url });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedIde({ sessionId: session.id, url: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoadIde, session?.id, directIdeUrl, getCodeServerUrl]);

  // Subscribe to cross-window updates
  useEffect(() => {
    return subscribe(msg => {
      if (msg.type === 'SESSION_STOPPED' || msg.type === 'SESSION_UPDATED') {
        // Session updates are handled by useVolundr's own subscription
      }
    });
  }, [subscribe]);

  // Probe the session's WebSocket endpoint until connectivity is verified
  const needsProbe = !!sessionHost && !connectionVerified;
  useSessionProbe({
    url: probeWsUrl,
    enabled: needsProbe,
    onReady: handleSessionReady,
  });

  if (!session) {
    // Still loading from the API — show a loading state instead of an error
    if (loading) {
      return (
        <div className={styles.wrapper}>
          <div className={styles.error}>
            <Hammer className={styles.errorIcon} />
            <p>Loading session...</p>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.wrapper}>
        <div className={styles.error}>
          <Hammer className={styles.errorIcon} />
          <p>Session not found</p>
          <Link to="/volundr" className={styles.backLink}>
            <ArrowLeft className={styles.backIcon} />
            Return to Völundr
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconContainer}>
            {tabType === 'terminal' ? (
              <Terminal className={styles.icon} />
            ) : tabType === 'chat' ? (
              <MessageSquare className={styles.icon} />
            ) : (
              <Code className={styles.icon} />
            )}
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.titleRow}>
              <span className={styles.title}>{session.name}</span>
              <StatusBadge status={session.status} />
            </div>
            <div className={styles.repoInfo}>
              {isManual ? (
                <>
                  <Globe className={styles.repoIcon} />
                  <span>{session.hostname}</span>
                </>
              ) : (
                <>
                  <FolderGit2 className={styles.repoIcon} />
                  <span>{getSourceLabel(session.source)}</span>
                  {isGitSource(session.source) && (
                    <>
                      <span className={styles.branchArrow}>→</span>
                      <span className={styles.branchName}>{getBranch(session.source)}</span>
                    </>
                  )}
                </>
              )}
              {selectedModel && (
                <span
                  className={styles.modelBadge}
                  style={{ '--model-color': selectedModel.color } as React.CSSProperties}
                >
                  {isLocal ? (
                    <Zap className={styles.modelIcon} />
                  ) : (
                    <Server className={styles.modelIcon} />
                  )}
                  {selectedModel.name}
                </span>
              )}
            </div>
          </div>
        </div>
        <Link to="/volundr" className={styles.backLink}>
          <ArrowLeft className={styles.backIcon} />
          Main View
        </Link>
      </header>

      <main className={styles.content}>
        {tabType === 'terminal' ? (
          isSessionReady ? (
            <SessionTerminal url={terminalWsUrl} className={styles.fullPanel} />
          ) : isSessionBooting(session.status) || (isRunning && !connectionVerified) ? (
            <SessionStartingIndicator className={styles.fullPanel} />
          ) : (
            <div className={styles.emptyState}>
              <Terminal className={styles.emptyIcon} />
              <p>Session is not running</p>
            </div>
          )
        ) : tabType === 'chat' ? (
          isSessionReady ? (
            <SessionChat
              url={chatWsUrl}
              className={styles.fullPanel}
              sessionHost={sessionHost}
              chatEndpoint={sessionChatEndpoint}
            />
          ) : isSessionBooting(session.status) || (isRunning && !connectionVerified) ? (
            <SessionStartingIndicator className={styles.fullPanel} />
          ) : (
            <div className={styles.emptyState}>
              <Hammer className={styles.emptyIcon} />
              <p>Session is not running</p>
            </div>
          )
        ) : isSessionReady ? (
          ideLoading ? (
            <div className={styles.emptyState}>
              <Code className={styles.emptyIcon} />
              <p>Connecting to IDE...</p>
            </div>
          ) : ideUrl ? (
            authEnabled ? (
              <div className={styles.emptyState}>
                <Code className={styles.emptyIcon} />
                <p>VS Code IDE is available for this session</p>
                <a
                  href={(() => {
                    const token = getAccessToken();
                    if (!token) return ideUrl;
                    const sep = ideUrl.includes('?') ? '&' : '?';
                    return `${ideUrl}${sep}access_token=${encodeURIComponent(token)}`;
                  })()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.ideOpenButton}
                >
                  Open IDE in new tab
                </a>
                <span className={styles.ideUrlHint}>{ideUrl}</span>
              </div>
            ) : (
              <div className={styles.iframeContainer}>
                <iframe
                  className={styles.sessionIframe}
                  src={ideUrl}
                  title={`IDE - ${session.name}`}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                />
              </div>
            )
          ) : (
            <div className={styles.emptyState}>
              <Code className={styles.emptyIcon} />
              <p>IDE not available for this session</p>
            </div>
          )
        ) : session.status === 'starting' ||
          session.status === 'provisioning' ||
          (isRunning && !connectionVerified) ? (
          <SessionStartingIndicator className={styles.fullPanel} />
        ) : (
          <div className={styles.emptyState}>
            <Code className={styles.emptyIcon} />
            <p>Session is not running</p>
          </div>
        )}
      </main>
    </div>
  );
}
