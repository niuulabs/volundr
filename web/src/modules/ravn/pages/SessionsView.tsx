import { useEffect, useState } from 'react';
import styles from './SessionsView.module.css';

interface AgentSession {
  id: string;
  status: string;
  model: string;
  created_at: string;
}

async function fetchSessions(): Promise<AgentSession[]> {
  const resp = await fetch('/api/v1/ravn/sessions');
  if (!resp.ok) return [];
  return resp.json();
}

export function SessionsView() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className={styles.empty}>Loading agent sessions…</div>;
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Active Agent Sessions</h2>
      {sessions.length === 0 ? (
        <p className={styles.empty}>No active agent sessions.</p>
      ) : (
        <ul className={styles.list}>
          {sessions.map(session => (
            <li key={session.id} className={styles.item}>
              <span className={styles.sessionId}>{session.id.slice(0, 8)}</span>
              <span className={styles[`status_${session.status}`] ?? styles.statusDefault}>
                {session.status}
              </span>
              <span className={styles.meta}>model: {session.model}</span>
              <span className={styles.meta}>{session.created_at}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
