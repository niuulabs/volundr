import type { ConfidenceEvent } from '../../models';
import type { RaidStatus } from '../../models';
import type { TimelineEvent } from '../../hooks/useTyrSessions';
import styles from './RaidTimeline.module.css';

interface RaidTimelineProps {
  confidenceEvents: ConfidenceEvent[];
  sessionEvents?: TimelineEvent[];
  status: RaidStatus;
  sessionId: string | null;
}

interface TimelineEntry {
  color: 'purple' | 'cyan' | 'brand' | 'emerald' | 'red' | 'orange';
  main: string;
  sub: string;
}

function formatTs(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function typeToColor(type: string): TimelineEntry['color'] {
  if (type === 'start' || type === 'dispatch') return 'purple';
  if (type === 'tool_use' || type === 'assistant') return 'cyan';
  if (type === 'commit') return 'emerald';
  if (type === 'error' || type === 'fail') return 'red';
  if (type === 'bash' || type === 'command') return 'cyan';
  return 'cyan';
}

function buildFromSessionEvents(events: TimelineEvent[], status: RaidStatus): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const ev of events) {
    entries.push({
      color: typeToColor(ev.type),
      main: ev.label,
      sub: [
        formatTs(ev.t),
        ev.tokens ? `${ev.tokens} tokens` : null,
        ev.action ? ev.action : null,
        ev.ins != null || ev.del != null ? `+${ev.ins ?? 0}/-${ev.del ?? 0}` : null,
      ]
        .filter(Boolean)
        .join(' \u00b7 '),
    });
  }

  // Terminal status
  if (status === 'review') {
    entries.push({ color: 'brand', main: 'Entered review', sub: '' });
  } else if (status === 'escalated') {
    entries.push({ color: 'orange', main: 'Escalated to human review', sub: '' });
  } else if (status === 'merged') {
    entries.push({ color: 'emerald', main: 'Merged', sub: '' });
  } else if (status === 'failed') {
    entries.push({ color: 'red', main: 'Failed', sub: '' });
  }

  return entries;
}

function buildFromConfidenceEvents(
  events: ConfidenceEvent[],
  status: RaidStatus,
  sessionId: string | null
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  if (events.length > 0) {
    entries.push({
      color: 'purple',
      main: 'Dispatched',
      sub: `${formatTime(events[0].created_at)}${sessionId ? ` \u00b7 session ${sessionId.slice(0, 8)}` : ''}`,
    });
  }

  for (const ev of events) {
    if (ev.event_type === 'ci_pass') {
      entries.push({
        color: 'emerald',
        main: 'CI passed',
        sub: `${formatTime(ev.created_at)} \u00b7 confidence +${Math.round(ev.delta * 100)}% \u2192 ${Math.round(ev.score_after * 100)}%`,
      });
    } else if (ev.event_type === 'ci_fail') {
      entries.push({
        color: 'red',
        main: 'CI failed',
        sub: `${formatTime(ev.created_at)} \u00b7 confidence ${Math.round(ev.delta * 100)}% \u2192 ${Math.round(ev.score_after * 100)}%`,
      });
    } else if (ev.event_type === 'scope_breach') {
      entries.push({
        color: 'orange',
        main: 'Scope breach detected',
        sub: formatTime(ev.created_at),
      });
    } else if (ev.event_type === 'retry') {
      entries.push({
        color: 'cyan',
        main: 'Retry attempt',
        sub: formatTime(ev.created_at),
      });
    } else if (ev.event_type === 'human_reject') {
      entries.push({
        color: 'red',
        main: 'Rejected by human',
        sub: formatTime(ev.created_at),
      });
    }
  }

  if (status === 'review') {
    entries.push({ color: 'brand', main: 'Entered review', sub: '' });
  } else if (status === 'escalated') {
    entries.push({ color: 'orange', main: 'Escalated to human review', sub: '' });
  } else if (status === 'merged') {
    entries.push({ color: 'emerald', main: 'Merged', sub: '' });
  } else if (status === 'failed') {
    entries.push({ color: 'red', main: 'Failed', sub: '' });
  }

  return entries;
}

export function RaidTimeline({
  confidenceEvents,
  sessionEvents,
  status,
  sessionId,
}: RaidTimelineProps) {
  // Prefer session timeline (richer data) over confidence events
  const entries =
    sessionEvents && sessionEvents.length > 0
      ? buildFromSessionEvents(sessionEvents, status)
      : buildFromConfidenceEvents(confidenceEvents, status, sessionId);

  if (entries.length === 0) {
    return <div className={styles.empty}>No timeline data</div>;
  }

  return (
    <div className={styles.timeline}>
      {entries.map((entry, i) => (
        <div key={i} className={styles.item}>
          <span className={styles.dot} data-color={entry.color} />
          <div className={styles.body}>
            <div className={styles.main}>{entry.main}</div>
            {entry.sub && <div className={styles.sub}>{entry.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
