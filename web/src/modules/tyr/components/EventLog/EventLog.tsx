import type { SseEvent, ActiveRaid } from '../../hooks';
import styles from './EventLog.module.css';

interface EventLogProps {
  events: SseEvent[];
  raids?: ActiveRaid[];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

type TagCategory = 'state' | 'conf' | 'phase' | 'dispatch' | 'session' | 'review';

function eventTag(type: string): { tag: string; category: TagCategory } {
  if (type.startsWith('raid.state') || type.startsWith('dispatcher.state')) {
    return { tag: 'state', category: 'state' };
  }
  if (type.startsWith('confidence')) {
    return { tag: 'conf', category: 'conf' };
  }
  if (type.startsWith('phase')) {
    return { tag: 'phase', category: 'phase' };
  }
  if (type.startsWith('dispatch')) {
    return { tag: 'dispatch', category: 'dispatch' };
  }
  if (type.startsWith('session')) {
    return { tag: 'session', category: 'session' };
  }
  if (type.includes('review')) {
    return { tag: 'review', category: 'review' };
  }
  return { tag: type.split('.')[0], category: 'state' };
}

function formatEventMessage(data: string, raidMap: Map<string, string>): string {
  try {
    const parsed = JSON.parse(data);
    const parts: string[] = [];
    if (parsed.identifier) {
      parts.push(parsed.identifier);
    } else if (parsed.tracker_id) {
      parts.push(raidMap.get(parsed.tracker_id) ?? parsed.tracker_id.slice(0, 8));
    }
    if (parsed.status) parts.push(`\u2192 ${parsed.status.toUpperCase()}`);
    if (parsed.confidence !== undefined) parts.push(`(${Math.round(parsed.confidence * 100)}%)`);
    if (parsed.state) parts.push(parsed.state);
    if (parsed.session_id && !parsed.tracker_id)
      parts.push(`session ${parsed.session_id.slice(0, 8)}`);
    if (parts.length > 0) return parts.join(' ');
    return data.slice(0, 100);
  } catch {
    return data.slice(0, 100);
  }
}

export function EventLog({ events, raids }: EventLogProps) {
  const raidMap = new Map<string, string>();
  if (raids) {
    for (const r of raids) {
      raidMap.set(r.tracker_id, r.identifier || r.title || r.tracker_id.slice(0, 8));
    }
  }

  if (events.length === 0) {
    return (
      <div className={styles.scroll}>
        <div className={styles.empty}>Waiting for events...</div>
      </div>
    );
  }

  return (
    <div className={styles.scroll}>
      {events.map(ev => {
        const { tag, category } = eventTag(ev.type);
        return (
          <div key={ev.id} className={styles.event}>
            <span className={styles.time}>{formatTime(ev.receivedAt)}</span>
            <div className={styles.body}>
              <span className={styles.tag} data-category={category}>
                {tag}
              </span>
              <span className={styles.msg}>{formatEventMessage(ev.data, raidMap)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
