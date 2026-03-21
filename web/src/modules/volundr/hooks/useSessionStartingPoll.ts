import { useEffect, useRef } from 'react';
import { getAccessToken } from '@/modules/volundr/adapters/api/client';

/** How often to attempt a probe connection (ms) */
const PROBE_INTERVAL_MS = 5000;

/** How long to wait for a probe WebSocket to open before giving up (ms) */
const PROBE_TIMEOUT_MS = 3000;

interface UseSessionProbeOptions {
  /** WebSocket URL to probe — e.g. wss://host/session */
  url: string | null;
  /** Whether probing is active — the caller controls when to start/stop */
  enabled: boolean;
  /** Called when the probe succeeds (session is connectable) */
  onReady: () => void;
}

/**
 * Probes a session's WebSocket endpoint while `enabled` is true.
 * Every few seconds it opens a throwaway WebSocket to the session URL —
 * if the connection succeeds the session is ready and `onReady` is called
 * so the UI can transition to the live view.
 *
 * The probe stops automatically when `enabled` becomes false or the
 * component unmounts.
 */
export function useSessionProbe({ url, enabled, onReady }: UseSessionProbeOptions): void {
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!url || !enabled) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probe = () => {
      if (cancelled) {
        return;
      }

      let ws: WebSocket | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (ws) {
          ws.onopen = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
          ws = null;
        }
      };

      try {
        // Append access token for gateway JWT validation
        let probeUrl = url;
        const token = getAccessToken();
        if (token) {
          const sep = url.includes('?') ? '&' : '?';
          probeUrl = `${url}${sep}access_token=${encodeURIComponent(token)}`;
        }
        ws = new WebSocket(probeUrl);
      } catch {
        // URL parsing failed — schedule next attempt
        if (!cancelled) {
          timer = setTimeout(probe, PROBE_INTERVAL_MS);
        }
        return;
      }

      // If the connection opens, the session is reachable
      ws.onopen = () => {
        cleanup();
        if (!cancelled) {
          onReadyRef.current();
        }
      };

      // Connection refused / failed — try again later
      ws.onerror = () => {
        cleanup();
        if (!cancelled) {
          timer = setTimeout(probe, PROBE_INTERVAL_MS);
        }
      };

      ws.onclose = () => {
        cleanup();
        if (!cancelled) {
          timer = setTimeout(probe, PROBE_INTERVAL_MS);
        }
      };

      // Abort the probe if it takes too long
      timeout = setTimeout(() => {
        cleanup();
        if (!cancelled) {
          timer = setTimeout(probe, PROBE_INTERVAL_MS);
        }
      }, PROBE_TIMEOUT_MS);
    };

    // Fire the first probe immediately
    probe();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [url, enabled]);
}
