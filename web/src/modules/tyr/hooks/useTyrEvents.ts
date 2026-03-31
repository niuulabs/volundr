import { useEffect, useRef, useState, useCallback } from 'react';
import { createApiClient, getAccessToken } from '@/modules/shared/api/client';

export interface SseEvent {
  id: string;
  type: string;
  data: string;
  receivedAt: Date;
}

const MAX_EVENTS = 100;
const RECONNECT_MS = 5_000;

const EVENT_TYPES = [
  'raid.state_changed',
  'session.state_changed',
  'confidence.updated',
  'phase.unlocked',
  'dispatcher.state',
] as const;

interface ActivityEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface ActivityLogResponse {
  events: ActivityEvent[];
  total: number;
}

const tyrApi = createApiClient('/api/v1/tyr');

async function fetchSeedEvents(): Promise<SseEvent[]> {
  try {
    const log = await tyrApi.get<ActivityLogResponse>('/dispatcher/log?limit=50');
    return log.events.map((e, i) => ({
      id: `seed-${i}`,
      type: e.event,
      data: JSON.stringify(e.data),
      receivedAt: new Date(e.timestamp),
    }));
  } catch {
    return [];
  }
}

interface UseTyrEventsResult {
  events: SseEvent[];
  connected: boolean;
}

export function useTyrEvents(onEvent?: (event: SseEvent) => void): UseTyrEventsResult {
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const idCounter = useRef(0);
  const onEventRef = useRef(onEvent);
  const seededRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const pushEvent = useCallback((type: string, data: string, at?: Date) => {
    const ev: SseEvent = {
      id: String(idCounter.current++),
      type,
      data,
      receivedAt: at ?? new Date(),
    };
    setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS));
    onEventRef.current?.(ev);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;

    function connect() {
      // Seed from ring buffer on first connect
      if (!seededRef.current) {
        seededRef.current = true;
        fetchSeedEvents().then(seed => {
          for (const ev of seed) {
            pushEvent(ev.type, ev.data, ev.receivedAt);
          }
        });
      }

      const token = getAccessToken();
      const url = token
        ? `/api/v1/tyr/events?token=${encodeURIComponent(token)}`
        : '/api/v1/tyr/events';

      es = new EventSource(url);
      es.onopen = () => setConnected(true);

      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (event: MessageEvent) => {
          pushEvent(type, event.data);
        });
      }

      es.onmessage = (event: MessageEvent) => {
        pushEvent('message', event.data);
      };

      es.onerror = () => {
        setConnected(false);
        es?.close();
        setTimeout(connect, RECONNECT_MS);
      };
    }

    connect();
    return () => {
      es?.close();
    };
  }, [pushEvent]);

  return { events, connected };
}
