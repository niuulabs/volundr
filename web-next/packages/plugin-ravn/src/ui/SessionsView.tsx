/**
 * SessionsView — split panel showing session list + live transcript + context sidebar.
 *
 * Left:   list of sessions sorted newest-first. Click to select.
 * Center: message transcript with header card, filter toolbar, and composer.
 * Right:  context sidebar — summary, timeline, injects, stats, emissions, raven card.
 *
 * Also listens for `ravn:session-selected` custom events dispatched by the
 * SessionsSubnav so that subnav selection syncs to the page.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { StateDot, PersonaAvatar, SegmentedFilter } from '@niuulabs/ui';
import { useSessions, useMessages } from './hooks/useSessions';
import { ActiveCursor } from './ActiveCursor';
import { MessageRow } from './MessageRow';
import { loadStorage, saveStorage } from './storage';
import { formatTime } from './formatTime';
import type { Session } from '../domain/session';
import type { Message, MessageKind } from '../domain/message';

const SESSION_STORAGE_KEY = 'ravn.session';

const TIMELINE_MAX_ITEMS = 15;

const STATUS_STATE = {
  running: 'processing',
  idle: 'idle',
  stopped: 'healthy',
  failed: 'failed',
} as const;

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type MessageFilter = 'all' | 'user' | 'asst' | 'tool' | 'emit' | 'system' | 'think';

const FILTER_OPTIONS: { value: MessageFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'user', label: 'User' },
  { value: 'asst', label: 'Assistant' },
  { value: 'tool', label: 'Tool' },
  { value: 'emit', label: 'Emit' },
  { value: 'system', label: 'System' },
  { value: 'think', label: 'Think' },
];

function filterMessages(messages: Message[], filter: MessageFilter): Message[] {
  if (filter === 'all') return messages;
  if (filter === 'tool')
    return messages.filter((m) => m.kind === 'tool_call' || m.kind === 'tool_result');
  return messages.filter((m) => m.kind === (filter as MessageKind));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseEmitContent(content: string): { event: string; payload?: unknown } {
  try {
    const parsed = JSON.parse(content) as { event?: string; payload?: unknown };
    return { event: parsed.event ?? 'event', payload: parsed.payload };
  } catch {
    return { event: 'event' };
  }
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

// ---------------------------------------------------------------------------
// Derived timeline events
// ---------------------------------------------------------------------------

interface TimelineEvent {
  kind: MessageKind | 'start' | 'end';
  ts: string;
  label: string;
}

const TIMELINE_KIND_COLOR: Partial<Record<TimelineEvent['kind'], string>> = {
  tool_call: 'amber',
  tool_result: 'amber',
  emit: 'cyan',
  start: 'cyan',
  end: 'emerald',
};

function deriveTimelineEvents(messages: Message[], session: Session): TimelineEvent[] {
  const events: TimelineEvent[] = [{ kind: 'start', ts: session.createdAt, label: 'started' }];

  for (const m of messages) {
    if (m.kind === 'tool_call') {
      events.push({ kind: 'tool_call', ts: m.ts, label: `tool · ${m.toolName ?? 'call'}` });
    } else if (m.kind === 'emit') {
      const { event } = parseEmitContent(m.content);
      events.push({ kind: 'emit', ts: m.ts, label: `emit · ${event}` });
    }
  }

  if (session.status !== 'running') {
    const endTs = messages.length > 0 ? messages[messages.length - 1]!.ts : session.createdAt;
    events.push({ kind: 'end', ts: endTs, label: session.status });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Session list item
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Transcript header card
// ---------------------------------------------------------------------------

function TranscriptHeader({ session }: { session: Session }) {
  const role = session.personaRole ?? 'build';
  const letter = session.personaLetter ?? session.personaName.charAt(0).toUpperCase();
  const isRunning = session.status === 'running';

  return (
    <div className="rv-transcript__header-card" data-testid="transcript-header">
      <div className="rv-transcript__header-left">
        <PersonaAvatar role={role} letter={letter} size={34} title={session.personaName} />
        <div className="rv-transcript__header-info">
          <div className="rv-transcript__title-row">
            <h3 className="rv-transcript__title">
              {session.title ?? `Session ${session.id.slice(0, 8)}`}
            </h3>
            <StateDot
              state={STATUS_STATE[session.status]}
              pulse={isRunning}
              data-testid="transcript-status-dot"
            />
            <span className="rv-transcript__status-label">{session.status}</span>
          </div>
          <div className="rv-transcript__meta-row">
            <span className="rv-transcript__meta-model">{session.model}</span>
            <span className="rv-transcript__meta-sep">·</span>
            <span className="rv-transcript__meta-ts">
              {session.createdAt.slice(0, 16).replace('T', ' ')}
            </span>
          </div>
        </div>
      </div>
      <div className="rv-transcript__header-right">
        <div className="rv-transcript__metrics" data-testid="transcript-metrics">
          <span className="rv-transcript__metric">
            <span className="rv-transcript__metric-value">{session.messageCount ?? '—'}</span>
            <span className="rv-transcript__metric-label">msgs</span>
          </span>
          {session.tokenCount != null && (
            <span className="rv-transcript__metric">
              <span className="rv-transcript__metric-value">
                {formatTokens(session.tokenCount)}
              </span>
              <span className="rv-transcript__metric-label">tokens</span>
            </span>
          )}
          {session.costUsd != null && (
            <span className="rv-transcript__metric">
              <span className="rv-transcript__metric-value rv-transcript__metric-value--accent">
                ${session.costUsd.toFixed(2)}
              </span>
              <span className="rv-transcript__metric-label">cost</span>
            </span>
          )}
        </div>
        <div className="rv-transcript__actions" data-testid="transcript-actions">
          <button type="button" className="rv-btn rv-btn--sm" aria-label="export session">
            export
          </button>
          <button
            type="button"
            className="rv-btn rv-btn--sm"
            disabled={!isRunning}
            aria-label="pause session"
          >
            pause
          </button>
          <button
            type="button"
            className="rv-btn rv-btn--sm rv-btn--danger"
            disabled={!isRunning}
            aria-label="abort session"
          >
            abort
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({ session }: { session: Session }) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isRunning = session.status === 'running';

  const handleInput = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  const handleSend = () => {
    if (!text.trim() || !isRunning) return;
    // TODO: wire to ISessionStream.sendMessage when port is added
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isRunning) {
    return (
      <div className="rv-composer rv-composer--closed" data-testid="composer-closed">
        <span className="rv-composer__closed-label">session {session.status} · read-only</span>
        <button type="button" className="rv-btn rv-btn--sm">
          resume in new session
        </button>
      </div>
    );
  }

  return (
    <div className="rv-composer" data-testid="composer">
      <div className="rv-composer__toolbar">
        <button type="button" className="rv-composer__icon-btn" aria-label="inject context">
          <span aria-hidden>↓</span> inject
        </button>
        <button type="button" className="rv-composer__icon-btn" aria-label="attach file">
          <span aria-hidden>⌁</span> attach
        </button>
      </div>
      <div className="rv-composer__input-row">
        <textarea
          ref={textareaRef}
          className="rv-composer__textarea"
          placeholder="Steer the raven… (shift-enter for newline, enter to send)"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          aria-label="compose message"
        />
        <button
          type="button"
          className="rv-composer__send rv-btn rv-btn--primary"
          disabled={!text.trim()}
          onClick={handleSend}
          aria-label="send message"
        >
          send
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

function Transcript({
  session,
  messages,
  messagesLoading,
  messagesError,
}: {
  session: Session;
  messages: Message[];
  messagesLoading: boolean;
  messagesError: boolean;
}) {
  const [filter, setFilter] = useState<MessageFilter>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messagesLoading) {
    return (
      <div className="rv-transcript__empty">
        <StateDot state="processing" pulse />
        <span>loading transcript…</span>
      </div>
    );
  }

  if (messagesError) {
    return (
      <div className="rv-transcript__empty rv-transcript__empty--error">
        failed to load messages
      </div>
    );
  }

  const filtered = filterMessages(messages, filter);

  return (
    <div className="rv-transcript" role="log" aria-label={`transcript for ${session.personaName}`}>
      <TranscriptHeader session={session} />
      <SegmentedFilter
        options={FILTER_OPTIONS}
        value={filter}
        onChange={setFilter}
        aria-label="filter messages"
      />
      <div className="rv-transcript__body">
        {filtered.map((msg) => (
          <MessageRow key={msg.id} message={msg} />
        ))}
        <ActiveCursor status={session.status} className="rv-transcript__cursor" />
        <div ref={bottomRef} />
      </div>
      <Composer session={session} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context sidebar
// ---------------------------------------------------------------------------

function ContextSidebar({ session, messages }: { session: Session; messages: Message[] }) {
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const msgs = useMemo(() => messages, [messages]);

  const ratio =
    session.costUsd != null && session.messageCount != null && session.messageCount > 0
      ? session.costUsd / session.messageCount
      : null;

  const timelineEvents = useMemo(() => deriveTimelineEvents(msgs, session), [msgs, session]);
  const visibleEvents = timelineExpanded
    ? timelineEvents
    : timelineEvents.slice(0, TIMELINE_MAX_ITEMS);
  const hasMore = timelineEvents.length > TIMELINE_MAX_ITEMS;

  // Injects: system messages represent context injected into the session
  const injects = useMemo(() => msgs.filter((m) => m.kind === 'system'), [msgs]);

  // Emissions: emit messages emitted by the session
  const emissions = useMemo(() => msgs.filter((m) => m.kind === 'emit'), [msgs]);

  return (
    <aside
      className="rv-sessions-view__sidebar"
      aria-label="session context"
      data-testid="session-context-sidebar"
    >
      {/* Summary */}
      <section className="rv-ctx-sec" data-testid="ctx-summary">
        <h4 className="rv-ctx-sec__title">Summary</h4>
        <p className="rv-ctx-sec__body">{session.title ?? `Session ${session.id.slice(0, 8)}`}</p>
        <p className="rv-ctx-sec__body rv-ctx-sec__body--muted">
          {session.status === 'running' ? 'In progress' : 'Completed'}
        </p>
      </section>

      {/* Timeline — enriched with intermediate events */}
      <section className="rv-ctx-sec" data-testid="ctx-timeline">
        <h4 className="rv-ctx-sec__title">Timeline</h4>
        <ol className="rv-ctx-timeline">
          {visibleEvents.map((ev, i) => (
            <li
              key={i}
              className={`rv-ctx-timeline__item rv-ctx-timeline__item--${TIMELINE_KIND_COLOR[ev.kind] ?? 'muted'}`}
              data-testid={`timeline-event-${ev.kind}`}
            >
              <span
                className={`rv-ctx-timeline__dot rv-ctx-timeline__dot--${TIMELINE_KIND_COLOR[ev.kind] ?? 'muted'}`}
              />
              <span className="rv-ctx-timeline__ts">{formatTime(ev.ts)}</span>
              <span className="rv-ctx-timeline__label">{ev.label}</span>
            </li>
          ))}
        </ol>
        {hasMore && !timelineExpanded && (
          <button
            type="button"
            className="rv-ctx-timeline__more"
            onClick={() => setTimelineExpanded(true)}
            data-testid="timeline-show-more"
          >
            show {timelineEvents.length - TIMELINE_MAX_ITEMS} more
          </button>
        )}
      </section>

      {/* Injects */}
      <section className="rv-ctx-sec" data-testid="ctx-injects">
        <h4 className="rv-ctx-sec__title">
          Injects <span className="rv-ctx-sec__title-sub">context this session has loaded</span>
        </h4>
        {injects.length === 0 ? (
          <p className="rv-ctx-sec__body rv-ctx-sec__body--muted">no injected context</p>
        ) : (
          <ul className="rv-ctx-injects" data-testid="injects-list">
            {injects.map((m) => (
              <li key={m.id} className="rv-ctx-inject-item">
                <span className="rv-ctx-inject-item__badge">sys</span>
                <span className="rv-ctx-inject-item__content">{m.content.slice(0, 60)}</span>
                <span className="rv-ctx-inject-item__ts">{formatTime(m.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Stats */}
      <section className="rv-ctx-sec" data-testid="ctx-stats">
        <h4 className="rv-ctx-sec__title">Stats</h4>
        <dl className="rv-ctx-dl">
          <dt>Messages</dt>
          <dd data-testid="ctx-msg-count">{session.messageCount ?? '—'}</dd>
          <dt>Tokens</dt>
          <dd data-testid="ctx-token-count">
            {session.tokenCount != null ? formatTokens(session.tokenCount) : '—'}
          </dd>
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

      {/* Emissions */}
      <section className="rv-ctx-sec" data-testid="ctx-emissions">
        <h4 className="rv-ctx-sec__title">
          Emissions <span className="rv-ctx-sec__title-sub">events this session has produced</span>
        </h4>
        {emissions.length === 0 ? (
          <p className="rv-ctx-sec__body rv-ctx-sec__body--muted">
            {session.status === 'running' ? 'pending · will emit on completion' : 'no emissions'}
          </p>
        ) : (
          <ul className="rv-ctx-emissions" data-testid="emissions-list">
            {emissions.map((m) => {
              const { event: eventName, payload } = parseEmitContent(m.content);
              const payloadPreview = payload != null
                ? JSON.stringify(payload).slice(0, 48)
                : m.content.slice(0, 48);
              return (
                <li key={m.id} className="rv-ctx-emit-item">
                  <div className="rv-ctx-emit-item__head">
                    <span className="rv-ctx-emit-item__badge">{eventName}</span>
                    <span className="rv-ctx-emit-item__ts">{formatTime(m.ts)}</span>
                  </div>
                  {payloadPreview && (
                    <pre className="rv-ctx-emit-item__payload">{payloadPreview}</pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
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

// ---------------------------------------------------------------------------
// SessionsView (root)
// ---------------------------------------------------------------------------

export function SessionsView() {
  const { data: sessions, isLoading, isError } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    loadStorage<string | null>(SESSION_STORAGE_KEY, null),
  );

  const sorted = sessions
    ? [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const selected = sorted.find((s) => s.id === selectedId) ?? sorted[0] ?? null;

  const {
    data: rawMessages,
    isLoading: messagesLoading,
    isError: messagesError,
  } = useMessages(selected?.id ?? '');
  const sessionMessages = rawMessages ?? [];

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
          <Transcript
            session={selected}
            messages={sessionMessages}
            messagesLoading={messagesLoading}
            messagesError={messagesError}
          />
        ) : (
          <div className="rv-transcript__empty">select a session</div>
        )}
      </main>

      {/* ── Context sidebar ──────────────────────────────────────────── */}
      {selected && <ContextSidebar session={selected} messages={sessionMessages} />}
    </div>
  );
}
