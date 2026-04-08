import type { EventPort, EventHandler, UnsubscribeFn, MimirEvent } from '@/ports';

/**
 * WebSocketEventAdapter — primary real-time event subscription via WebSocket.
 *
 * Connects to `ws://<host>/ws` and parses JSON messages into MimirEvent.
 * Falls back gracefully on connection failure (caller should switch to PollingEventAdapter).
 */
export class WebSocketEventAdapter implements EventPort {
  private ws: WebSocket | null = null;
  private handlers: Set<EventHandler> = new Set();
  private connected = false;

  constructor(private readonly wsUrl: string) {}

  subscribe(handler: EventHandler): UnsubscribeFn {
    this.handlers.add(handler);
    this.ensureConnected();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) {
        this.disconnect();
      }
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensureConnected(): void {
    if (this.ws !== null) {
      return;
    }
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.ws = null;
      };

      this.ws.onerror = () => {
        this.connected = false;
        this.ws = null;
      };

      this.ws.onmessage = (evt) => {
        this.handleMessage(evt.data as string);
      };
    } catch {
      this.connected = false;
      this.ws = null;
    }
  }

  private handleMessage(data: string): void {
    try {
      const event = JSON.parse(data) as MimirEvent;
      for (const handler of this.handlers) {
        handler(event);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  private disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
