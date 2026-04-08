export type EventType = 'ingest_queued' | 'ingest_running' | 'ingest_complete' | 'ingest_failed' | 'page_updated' | 'lint_complete';

export interface MimirEvent {
  type: EventType;
  sourceId?: string;
  pagePath?: string;
  message?: string;
  timestamp: string;
}

export type EventHandler = (event: MimirEvent) => void;
export type UnsubscribeFn = () => void;

/**
 * Port interface for subscribing to real-time Ravn event stream.
 * Implementations: WebSocketEventAdapter (primary), PollingEventAdapter (fallback).
 */
export interface EventPort {
  /** Subscribe to events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler): UnsubscribeFn;

  /** Whether the connection is currently active */
  isConnected(): boolean;
}
