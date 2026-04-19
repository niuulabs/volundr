/**
 * SessionsView — split panel showing session list + live transcript.
 *
 * Left:  list of sessions sorted newest-first. Click to select.
 * Right: message transcript for the selected session, with ActiveCursor
 *        at the bottom when status === 'running'.
 */

import { useState, useEffect, useRef } from 'react';
import { StateDot } from '@niuulabs/ui';
import { useSessions, useMessages } from './useSessions';
import { ActiveCursor } from './ActiveCursor';
import { MessageRow } from './MessageRow';
import type { Session } from '../domain/session';

const STATUS_STATE = {
  running: 'processing',
  idle: 'idle',
  stopped: 'healthy',
  failed: 'failed',
} as const;

function SessionListItem({
  session,
  selected,
  onSelect,
}: {
  session: Session;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`rv-session-item${selected ? ' rv-session-item--active' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`session ${session.personaName}`}
    >
      <div className="rv-session-item__head">
        <StateDot state={STATUS_STATE[session.status]} pulse={session.status === 'running'} />
        <span className="rv-session-item__name">{session.personaName}</span>
        <span className="rv-session-item__status">{session.status}</span>
      </div>
      <div className="rv-session-item__meta">
        <span className="rv-session-item__model">{session.model}</span>
        <span className="rv-session-item__ts">{session.createdAt.slice(0, 10)}</span>
      </div>
    </button>
  );
}

function Transcript({ session }: { session: Session }) {
  const { data: messages, isLoading, isError } = useMessages(session.id);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (isLoading) {
    return (
      <div className="rv-transcript__empty">
        <StateDot state="processing" pulse />
        <span>loading transcript…</span>
      </div>
    );
  }

  if (isError) {
    return <div className="rv-transcript__empty rv-transcript__empty--error">failed to load messages</div>;
  }

  return (
    <div className="rv-transcript" role="log" aria-label={`transcript for ${session.personaName}`}>
      <div className="rv-transcript__header">
        <span className="rv-transcript__persona">{session.personaName}</span>
        <span className="rv-transcript__model">{session.model}</span>
        <span className="rv-transcript__count">{messages?.length ?? 0} messages</span>
      </div>
      <div className="rv-transcript__body">
        {messages?.map((msg) => <MessageRow key={msg.id} message={msg} />)}
        <ActiveCursor status={session.status} className="rv-transcript__cursor" />
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export function SessionsView() {
  const { data: sessions, isLoading, isError } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = sessions ? [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const selected = sorted.find((s) => s.id === selectedId) ?? sorted[0] ?? null;

  if (isLoading) {
    return (
      <div className="rv-sessions-view">
        <div className="rv-sessions-view__loading">
          <StateDot state="processing" pulse />
          <span>loading sessions…</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rv-sessions-view">
        <div className="rv-sessions-view__error">failed to load sessions</div>
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="rv-sessions-view">
        <div className="rv-sessions-view__empty">no sessions yet</div>
      </div>
    );
  }

  return (
    <div className="rv-sessions-view">
      {/* ── Session list ─────────────────────────────────────────────── */}
      <aside className="rv-sessions-view__list" aria-label="session list">
        <div className="rv-sessions-view__list-head">
          <span className="rv-sessions-view__list-label">sessions</span>
          <span className="rv-sessions-view__list-count">{sorted.length}</span>
        </div>
        {sorted.map((session) => (
          <SessionListItem
            key={session.id}
            session={session}
            selected={session.id === (selected?.id ?? null)}
            onSelect={() => setSelectedId(session.id)}
          />
        ))}
      </aside>

      {/* ── Transcript ───────────────────────────────────────────────── */}
      <main className="rv-sessions-view__transcript">
        {selected ? (
          <Transcript session={selected} />
        ) : (
          <div className="rv-transcript__empty">select a session</div>
        )}
      </main>
    </div>
  );
}
