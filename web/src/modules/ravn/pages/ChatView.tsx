import { useState, useMemo, useCallback } from 'react';
import { SessionChat } from '@/modules/shared/components/SessionChat/SessionChat';
import styles from './ChatView.module.css';

const STORAGE_KEY = 'ravn_gateway_url';
const DEFAULT_URL = 'ws://localhost:7477/ws';

function getStoredUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export function ChatView() {
  const [inputUrl, setInputUrl] = useState(getStoredUrl);
  const [activeUrl, setActiveUrl] = useState<string | null>(() => {
    const stored = getStoredUrl();
    return stored ? stored : null;
  });

  const handleConnect = useCallback(() => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // ignore storage errors
    }
    setActiveUrl(trimmed);
  }, [inputUrl]);

  const handleDisconnect = useCallback(() => {
    setActiveUrl(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleConnect();
      }
    },
    [handleConnect]
  );

  const wsUrl = useMemo(() => activeUrl, [activeUrl]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <label className={styles.label}>Gateway</label>
        <input
          className={styles.urlInput}
          type="text"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ws://localhost:7477/ws"
          disabled={activeUrl !== null}
        />
        {activeUrl ? (
          <button className={styles.disconnectBtn} onClick={handleDisconnect}>
            Disconnect
          </button>
        ) : (
          <button className={styles.connectBtn} onClick={handleConnect}>
            Connect
          </button>
        )}
        {activeUrl && <span className={styles.status}>Connected</span>}
      </div>
      <div className={styles.chatArea}>
        {wsUrl ? (
          <SessionChat url={wsUrl} className={styles.chat} />
        ) : (
          <div className={styles.empty}>
            Enter a Ravn gateway URL and click Connect to start chatting.
          </div>
        )}
      </div>
    </div>
  );
}
