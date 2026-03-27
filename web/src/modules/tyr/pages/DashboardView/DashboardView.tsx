import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBadge, StatusDot, LoadingIndicator } from '@/modules/shared';
import { getAccessToken } from '@/modules/shared/api/client';
import { createApiClient } from '@/modules/shared/api/client';
import { cn } from '@/modules/shared/utils/classnames';
import type { RaidStatus } from '../../models';
import styles from './DashboardView.module.css';

/* ── Types ────────────────────────────────────────────── */

interface ActiveRaid {
  tracker_id: string;
  identifier: string;
  title: string;
  url: string;
  status: RaidStatus;
  session_id: string | null;
  confidence: number;
  pr_url: string | null;
  last_updated: string;
}

interface DetailedHealth {
  status: string;
  database: string;
  event_bus_subscribers: number;
  activity_subscriber_running: boolean;
  notification_running: boolean;
  review_engine_running: boolean;
}

interface SseEvent {
  id: string;
  type: string;
  data: string;
  receivedAt: Date;
}

/* ── API client ───────────────────────────────────────── */

const tyrApi = createApiClient('/api/v1/tyr');

/* ── Helpers ──────────────────────────────────────────── */

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MAX_EVENTS = 100;

/* ── Component ────────────────────────────────────────── */

export function DashboardView() {
  /* -- Active Raids ------------------------------------------------- */
  const [raids, setRaids] = useState<ActiveRaid[]>([]);
  const [raidsLoading, setRaidsLoading] = useState(true);
  const [raidsError, setRaidsError] = useState<string | null>(null);

  const fetchRaids = useCallback(async () => {
    try {
      const data = await tyrApi.get<ActiveRaid[]>('/raids/active');
      setRaids(data);
      setRaidsError(null);
    } catch {
      // Endpoint may not exist yet — show empty state
      setRaids([]);
      setRaidsError(null);
    } finally {
      setRaidsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRaids();
  }, [fetchRaids]);

  /* -- Service Health ----------------------------------------------- */
  const [health, setHealth] = useState<DetailedHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await tyrApi.get<DetailedHealth>('/health/detailed');
      setHealth(data);
      setHealthError(null);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Failed to load health');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  /* -- SSE Events --------------------------------------------------- */
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const eventIdCounter = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;

    function connect() {
      const token = getAccessToken();
      const url = token
        ? `/api/v1/tyr/events?token=${encodeURIComponent(token)}`
        : '/api/v1/tyr/events';

      es = new EventSource(url);

      es.onopen = () => setSseConnected(true);

      // Listen for named Tyr events
      const eventTypes = [
        'raid.state_changed',
        'session.state_changed',
        'confidence.updated',
        'phase.unlocked',
        'dispatcher.state',
      ];

      for (const type of eventTypes) {
        es.addEventListener(type, (event: MessageEvent) => {
          const sseEvent: SseEvent = {
            id: String(eventIdCounter.current++),
            type,
            data: event.data,
            receivedAt: new Date(),
          };
          setEvents(prev => [sseEvent, ...prev].slice(0, MAX_EVENTS));
        });
      }

      // Also catch unnamed messages
      es.onmessage = (event: MessageEvent) => {
        const sseEvent: SseEvent = {
          id: String(eventIdCounter.current++),
          type: 'message',
          data: event.data,
          receivedAt: new Date(),
        };
        setEvents(prev => [sseEvent, ...prev].slice(0, MAX_EVENTS));
      };

      es.onerror = () => {
        setSseConnected(false);
        es?.close();
        setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      es?.close();
    };
  }, []);

  /* -- Render ------------------------------------------------------- */

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Dashboard</h2>
        <span className={cn(sseConnected ? styles.connected : styles.disconnected)}>
          {sseConnected ? 'live' : 'disconnected'}
        </span>
      </div>

      {/* Active Raids */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Active Raids</h3>
        <ActiveRaidsTable raids={raids} loading={raidsLoading} error={raidsError} />
      </section>

      {/* Service Health */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Service Health</h3>
        <ServiceHealthPanel health={health} loading={healthLoading} error={healthError} />
      </section>

      {/* Recent Events */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Recent Events</h3>
        <EventFeed events={events} />
      </section>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────── */

function ActiveRaidsTable({
  raids,
  loading,
  error,
}: {
  raids: ActiveRaid[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <LoadingIndicator messages={['Loading raids...']} />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (raids.length === 0) {
    return <div className={styles.empty}>No active raids</div>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Ticket</th>
          <th>Status</th>
          <th>Confidence</th>
          <th>PR</th>
          <th>Last Updated</th>
        </tr>
      </thead>
      <tbody>
        {raids.map(raid => (
          <tr key={raid.tracker_id}>
            <td>
              <div className={styles.raidInfo}>
                {raid.url ? (
                  <a
                    href={raid.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.raidLink}
                  >
                    {raid.identifier || raid.tracker_id}
                  </a>
                ) : (
                  <span className={styles.monoCell}>{raid.identifier || raid.tracker_id}</span>
                )}
                {raid.title && <span className={styles.raidTitle}>{raid.title}</span>}
              </div>
            </td>
            <td>
              <StatusBadge status={raid.status} />
            </td>
            <td className={styles.confidenceCell}>{Math.round(raid.confidence * 100)}%</td>
            <td>
              {raid.pr_url ? (
                <a
                  href={raid.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.prLink}
                >
                  PR
                </a>
              ) : (
                <span className={styles.muted}>{'\u2014'}</span>
              )}
            </td>
            <td className={styles.timestampCell}>{formatTimestamp(raid.last_updated)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ServiceHealthPanel({
  health,
  loading,
  error,
}: {
  health: DetailedHealth | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <LoadingIndicator messages={['Checking health...']} />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (!health) {
    return <div className={styles.empty}>No health data</div>;
  }

  const items: { label: string; status: string; value?: string }[] = [
    { label: 'Database', status: health.database === 'ok' ? 'healthy' : 'failed' },
    {
      label: 'Event Bus',
      status: health.event_bus_subscribers > 0 ? 'healthy' : 'idle',
      value: `${health.event_bus_subscribers} consumer${health.event_bus_subscribers === 1 ? '' : 's'}`,
    },
    {
      label: 'Activity Subscriber',
      status: health.activity_subscriber_running ? 'running' : 'stopped',
    },
    {
      label: 'Notification',
      status: health.notification_running ? 'running' : 'stopped',
    },
    {
      label: 'Review Engine',
      status: health.review_engine_running ? 'running' : 'stopped',
    },
  ];

  return (
    <div className={styles.healthGrid}>
      {items.map(item => (
        <div key={item.label} className={styles.healthCard}>
          <StatusDot status={item.status} pulse={item.status === 'running'} />
          <span className={styles.healthLabel}>{item.label}</span>
          {item.value && <span className={styles.healthValue}>{item.value}</span>}
        </div>
      ))}
    </div>
  );
}

function formatEventData(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const parts: string[] = [];
    if (data.tracker_id) parts.push(data.tracker_id);
    if (data.session_id) parts.push(`session=${data.session_id.slice(0, 8)}`);
    if (data.status) parts.push(data.status);
    if (data.state) parts.push(data.state);
    if (data.confidence !== undefined) parts.push(`conf=${data.confidence}`);
    if (parts.length > 0) return parts.join(' · ');
    return raw.slice(0, 120);
  } catch {
    return raw.slice(0, 120);
  }
}

function EventFeed({ events }: { events: SseEvent[] }) {
  if (events.length === 0) {
    return (
      <div className={styles.eventFeed}>
        <div className={styles.emptyFeed}>Waiting for events...</div>
      </div>
    );
  }

  return (
    <div className={styles.eventFeed}>
      {events.map(event => (
        <div key={event.id} className={styles.eventItem}>
          <span className={styles.eventTime}>{formatTime(event.receivedAt)}</span>
          <span className={styles.eventType}>{event.type}</span>
          <span className={styles.eventData}>{formatEventData(event.data)}</span>
        </div>
      ))}
    </div>
  );
}
