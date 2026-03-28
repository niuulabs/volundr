import { useEffect, useRef, useState, useCallback } from 'react';
import { getAccessToken } from '@/modules/shared/api/client';

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

interface UseTyrEventsResult {
  events: SseEvent[];
  connected: boolean;
}

export function useTyrEvents(onEvent?: (event: SseEvent) => void): UseTyrEventsResult {
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const idCounter = useRef(0);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const pushEvent = useCallback((type: string, data: string) => {
    const ev: SseEvent = {
      id: String(idCounter.current++),
      type,
      data,
      receivedAt: new Date(),
    };
    setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS));
    onEventRef.current?.(ev);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;

    function connect() {
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
