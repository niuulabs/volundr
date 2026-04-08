import type { EventPort, EventHandler, UnsubscribeFn, MimirEvent, EventType } from '@/ports';

const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Classify a log entry string into the appropriate EventType. */
function classifyEntry(entry: string): EventType {
  const lower = entry.toLowerCase();
  if (lower.includes('ingest') && lower.includes('running')) return 'ingest_running';
  if (lower.includes('ingest') && lower.includes('complete')) return 'ingest_complete';
  if (lower.includes('ingest') && lower.includes('fail')) return 'ingest_failed';
  if (lower.includes('ingest')) return 'ingest_queued';
  if (lower.includes('lint')) return 'lint_complete';
  return 'page_updated';
}

/**
 * PollingEventAdapter — fallback event source that polls GET /mimir/log
 * when WebSocket is unavailable.
 */
export class PollingEventAdapter implements EventPort {
  private handlers: Set<EventHandler> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastEntryCount = 0;
  private connected = false;

  constructor(
    private readonly logUrl: string,
    private readonly intervalMs = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  subscribe(handler: EventHandler): UnsubscribeFn {
    this.handlers.add(handler);
    this.ensurePolling();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) {
        this.stopPolling();
      }
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensurePolling(): void {
    if (this.intervalId !== null) {
      return;
    }
    this.connected = true;
    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  private stopPolling(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.connected = false;
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(this.logUrl);
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { entries: string[] };
      const entries = data.entries ?? [];
      if (entries.length <= this.lastEntryCount) {
        return;
      }

      const newEntries = entries.slice(this.lastEntryCount);
      this.lastEntryCount = entries.length;

      for (const entry of newEntries) {
        const event: MimirEvent = {
          type: classifyEntry(entry),
          message: entry,
          timestamp: new Date().toISOString(),
        };
        for (const handler of this.handlers) {
          handler(event);
        }
      }
    } catch {
      // Ignore transient errors
    }
  }
}
