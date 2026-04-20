/**
 * SessionsView — split panel showing session list + live transcript + context sidebar.
 *
 * Left:   list of sessions sorted newest-first. Click to select.
 * Center: message transcript for the selected session.
 * Right:  context sidebar — summary, stats, raven card.
 *
 * Also listens for `ravn:session-selected` custom events dispatched by the
 * SessionsSubnav so that subnav selection syncs to the page.
 */

import { useState, useEffect, useRef } from 'react';
import { StateDot } from '@niuulabs/ui';
import { useSessions, useMessages } from './hooks/useSessions';
import { ActiveCursor } from './ActiveCursor';
import { MessageRow } from './MessageRow';
import { loadStorage, saveStorage } from './storage';
import type { Session } from '../domain/session';

const SESSION_STORAGE_KEY = 'ravn.session';

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
    return (
      <div className="rv-transcript__empty rv-transcript__empty--error">
        failed to load messages
      </div>
    );
  }

  return (
    <div className="rv-transcript" role="log" aria-label={`transcript for ${session.personaName}`}>
      <div className="rv-transcript__header">
        <span className="rv-transcript__persona">{session.personaName}</span>
        <span className="rv-transcript__model">{session.model}</span>
        <span className="rv-transcript__count">{messages?.length ?? 0} messages</span>
      </div>
      <div className="rv-transcript__body">
        {messages?.map((msg) => (
          <MessageRow key={msg.id} message={msg} />
        ))}
        <ActiveCursor status={session.status} className="rv-transcript__cursor" />
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function ContextSidebar({ session }: { session: Session }) {
  const ratio = session.costUsd != null && session.messageCount != null && session.messageCount > 0
    ? session.costUsd / session.messageCount
    : null;

  return (
    <aside className="rv-sessions-view__sidebar" aria-label="session context" data-testid="session-context-sidebar">
      {/* Summary */}
      <section className="rv-ctx-sec" data-testid="ctx-summary">
        <h4 className="rv-ctx-sec__title">Summary</h4>
        <p className="rv-ctx-sec__body">
          {session.title ?? `Session ${session.id.slice(0, 8)}`}
        </p>
        <p className="rv-ctx-sec__body rv-ctx-sec__body--muted">
          {session.status === 'running' ? 'In progress' : 'Completed'}
        </p>
      </section>

      {/* Timeline */}
      <section className="rv-ctx-sec" data-testid="ctx-timeline">
        <h4 className="rv-ctx-sec__title">Timeline</h4>
        <ol className="rv-ctx-timeline">
          <li className="rv-ctx-timeline__item">
            <span className="rv-ctx-timeline__dot" />
            <span className="rv-ctx-timeline__ts">{session.createdAt.slice(0, 16).replace('T', ' ')}</span>
            <span className="rv-ctx-timeline__label">started</span>
          </li>
          {session.status !== 'running' && (
            <li className="rv-ctx-timeline__item">
              <span className="rv-ctx-timeline__dot" />
              <span className="rv-ctx-timeline__label">{session.status}</span>
            </li>
          )}
        </ol>
      </section>

      {/* Stats */}
      <section className="rv-ctx-sec" data-testid="ctx-stats">
        <h4 className="rv-ctx-sec__title">Stats</h4>
        <dl className="rv-ctx-dl">
          <dt>Messages</dt>
          <dd data-testid="ctx-msg-count">{session.messageCount ?? '—'}</dd>
          <dt>Cost</dt>
          <dd data-testid="ctx-cost">
            {session.costUsd != null ? `$${session.costUsd.toFixed(2)}` : '—'}
          </dd>
          {ratio != null && (
            <>
              <dt>Cost/msg</dt>
              <dd>${ratio.toFixed(3)}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Raven card */}
      <section className="rv-ctx-sec" data-testid="ctx-raven">
        <h4 className="rv-ctx-sec__title">Raven</h4>
        <dl className="rv-ctx-dl">
          <dt>Persona</dt>
          <dd>{session.personaName}</dd>
          <dt>Model</dt>
          <dd className="rv-ctx-dl__mono">{session.model}</dd>
          <dt>Ravn ID</dt>
          <dd className="rv-ctx-dl__mono">{session.ravnId.slice(0, 8)}</dd>
        </dl>
      </section>
    </aside>
  );
}

export function SessionsView() {
  const { data: sessions, isLoading, isError } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    loadStorage<string | null>(SESSION_STORAGE_KEY, null),
  );

  // Listen for subnav selection events
  useEffect(() => {
    const handleSelect = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      saveStorage(SESSION_STORAGE_KEY, id);
      setSelectedId(id);
    };
    window.addEventListener('ravn:session-selected', handleSelect);
    return () => window.removeEventListener('ravn:session-selected', handleSelect);
  }, []);

  const sorted = sessions
    ? [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
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
    <div className="rv-sessions-view rv-sessions-view--with-sidebar">
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
            onSelect={() => {
              saveStorage(SESSION_STORAGE_KEY, session.id);
              setSelectedId(session.id);
            }}
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

      {/* ── Context sidebar ──────────────────────────────────────────── */}
      {selected && <ContextSidebar session={selected} />}
    </div>
  );
}
