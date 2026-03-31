import { StatusDot } from '@/modules/shared';
import type { ActiveRaid } from '../../hooks';
import styles from './AttentionBar.module.css';

interface AttentionBarProps {
  raids: ActiveRaid[];
}

interface AttentionItem {
  id: string;
  label: string;
  urgency: 'high' | 'med' | 'low';
  dotStatus: string;
  pulse: boolean;
  time: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function deriveAttentionItems(raids: ActiveRaid[]): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const r of raids) {
    if (r.status === 'failed') {
      items.push({
        id: r.tracker_id,
        label: `${r.identifier || r.tracker_id} failed`,
        urgency: 'high',
        dotStatus: 'critical',
        pulse: true,
        time: relativeTime(r.last_updated),
      });
    } else if (r.status === 'escalated') {
      items.push({
        id: r.tracker_id,
        label: `${r.identifier || r.tracker_id} escalated — needs review`,
        urgency: 'med',
        dotStatus: 'escalated',
        pulse: false,
        time: relativeTime(r.last_updated),
      });
    } else if (r.status === 'review') {
      items.push({
        id: r.tracker_id,
        label: `${r.identifier || r.tracker_id} review complete — ${Math.round(r.confidence * 100)}%`,
        urgency: 'low',
        dotStatus: 'review',
        pulse: false,
        time: relativeTime(r.last_updated),
      });
    }
  }

  return items;
}

export function AttentionBar({ raids }: AttentionBarProps) {
  const items = deriveAttentionItems(raids);

  if (items.length === 0) return null;

  return (
    <div className={styles.bar}>
      {items.map(item => (
        <div key={item.id} className={styles.card} data-urgency={item.urgency}>
          <StatusDot status={item.dotStatus} pulse={item.pulse} />
          <span className={styles.label}>{item.label}</span>
          <span className={styles.time}>{item.time}</span>
        </div>
      ))}
    </div>
  );
}
