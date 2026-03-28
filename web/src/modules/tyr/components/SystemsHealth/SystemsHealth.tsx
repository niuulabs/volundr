import { StatusDot } from '@/modules/shared';
import type { DetailedHealth } from '../../hooks';
import styles from './SystemsHealth.module.css';

interface SystemsHealthProps {
  health: DetailedHealth | null;
  loading: boolean;
}

export function SystemsHealth({ health, loading }: SystemsHealthProps) {
  if (loading || !health) {
    return <div className={styles.wrap}>Loading...</div>;
  }

  const items = [
    { label: 'DB', ok: health.database === 'ok', pulse: false },
    { label: 'Events', ok: health.event_bus_subscriber_count > 0, pulse: true },
    { label: 'Subscriber', ok: health.activity_subscriber_running, pulse: true },
    { label: 'Reviewer', ok: health.review_engine_running, pulse: true },
    { label: 'Notifs', ok: health.notification_service_running, pulse: false },
  ];

  return (
    <div className={styles.wrap}>
      {items.map(item => (
        <div key={item.label} className={styles.chip}>
          <StatusDot status={item.ok ? 'healthy' : 'failed'} pulse={item.ok && item.pulse} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
