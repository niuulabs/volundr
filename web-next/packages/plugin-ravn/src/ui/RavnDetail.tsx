import { useState } from 'react';
import { BudgetBar, StateDot, PersonaAvatar, MountChip, LiveBadge, relTime } from '@niuulabs/ui';
import type { Ravn } from '../domain/ravn';
import type { MessageKind } from '../domain/message';
import type { BudgetState } from '@niuulabs/domain';
import { useTriggers } from './hooks/useTriggers';
import { useSessions } from './hooks/useSessions';
import { useRavnActivity } from './hooks/useSessions';
import { useRavnBudget } from './hooks/useBudget';
import { ravnStatusToDotState } from './grouping';
import { loadStorage, saveStorage } from './storage';
import './RavnDetail.css';

const TAB_STORAGE_KEY = 'ravn.detail.tab';

type TabId = 'overview' | 'triggers' | 'activity' | 'sessions' | 'connectivity';

// ── Helpers ──────────────────────────────────────────────────────────────────

const KIND_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'all' },
  { value: 'user', label: 'user' },
  { value: 'asst', label: 'asst' },
  { value: 'tool', label: 'tool' },
  { value: 'emit', label: 'emit' },
  { value: 'think', label: 'think' },
  { value: 'system', label: 'system' },
];

function formatTs(isoTs: string): string {
  return new Date(isoTs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function kindMatchesFilter(kind: MessageKind, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'tool') return kind === 'tool_call' || kind === 'tool_result';
  return kind === filter;
}

// ── Section components ──────────────────────────────────────────────────────

interface OverviewSectionProps {
  ravn: Ravn;
  budget: BudgetState | undefined;
}

function OverviewSection({ ravn, budget }: OverviewSectionProps) {
  const uptimeSince = formatTs(ravn.createdAt);

  return (
    <div className="rv-detail-overview">
      {/* Identity panel */}
      <div className="rv-overview-panel" data-testid="identity-panel">
        <div className="rv-overview-panel__head">
          <h5 className="rv-overview-panel__title">Identity</h5>
        </div>
        <div className="rv-overview-panel__body">
          {ravn.role && ravn.letter && (
            <div className="rv-identity-avatar-row">
              <PersonaAvatar role={ravn.role} letter={ravn.letter} size={36} />
              <div className="rv-identity-avatar-info">
                <span className="rv-identity-name">{ravn.personaName}</span>
                <span className={`rv-role-badge rv-role-badge--${ravn.role}`}>{ravn.role}</span>
              </div>
            </div>
          )}
          {!ravn.role && (
            <div className="rv-identity-name rv-identity-name--plain">{ravn.personaName}</div>
          )}
          {ravn.summary && <p className="rv-identity-summary">{ravn.summary}</p>}
          <dl className="rv-overview-dl rv-overview-dl--identity">
            <dt>ID</dt>
            <dd className="rv-overview-dd--model">{ravn.id.slice(0, 8)}</dd>
          </dl>
        </div>
      </div>

      {/* Runtime panel */}
      <div className="rv-overview-panel" data-testid="runtime-panel">
        <div className="rv-overview-panel__head">
          <h5 className="rv-overview-panel__title">Runtime</h5>
        </div>
        <div className="rv-overview-panel__body">
          <dl className="rv-overview-dl">
            <dt>State</dt>
            <dd className="rv-overview-dd--state">
              <StateDot
                state={ravnStatusToDotState(ravn.status)}
                pulse={ravn.status === 'active'}
                size={8}
              />
              <span>{ravn.status}</span>
            </dd>

            <dt>Model</dt>
            <dd className="rv-overview-dd--model">{ravn.model}</dd>

            <dt>Since</dt>
            <dd className="rv-overview-dd--since">{uptimeSince}</dd>

            {ravn.location && (
              <>
                <dt>Location</dt>
                <dd className="rv-overview-dd--model">{ravn.location}</dd>
              </>
            )}

            {ravn.deployment && (
              <>
                <dt>Deployment</dt>
                <dd className="rv-overview-dd--since">{ravn.deployment}</dd>
              </>
            )}

            {ravn.cascade && (
              <>
                <dt>Cascade</dt>
                <dd className="rv-overview-dd--since">{ravn.cascade}</dd>
              </>
            )}

            {ravn.iterationBudget != null && (
              <>
                <dt>Iter budget</dt>
                <dd className="rv-overview-dd--model">{ravn.iterationBudget} iters</dd>
              </>
            )}

            {ravn.writeRouting && (
              <>
                <dt>Write routing</dt>
                <dd className="rv-overview-dd--since">{ravn.writeRouting}</dd>
              </>
            )}
          </dl>

          {budget && (
            <div className="rv-overview-budget">
              <div className="rv-overview-budget__header">
                <span>Budget</span>
                <span className="rv-overview-budget__value">
                  ${budget.spentUsd.toFixed(2)} / ${budget.capUsd.toFixed(2)}
                </span>
              </div>
              <BudgetBar
                spent={budget.spentUsd}
                cap={budget.capUsd}
                warnAt={Math.round(budget.warnAt * 100)}
                size="sm"
              />
            </div>
          )}
        </div>
      </div>

      {/* Mounts panel */}
      {ravn.mounts && ravn.mounts.length > 0 && (
        <div className="rv-overview-panel" data-testid="mounts-panel">
          <div className="rv-overview-panel__head">
            <h5 className="rv-overview-panel__title">Mímir mounts</h5>
            <span className="rv-overview-panel__count">{ravn.mounts.length}</span>
          </div>
          <div className="rv-overview-panel__body">
            <div className="rv-mounts-row">
              {ravn.mounts.map((m) => (
                <MountChip key={m.name} name={m.name} role={m.role} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div className="rv-delete-actions" data-testid="danger-zone">
        <button
          type="button"
          className="rv-suspend-btn"
          data-testid="suspend-btn"
          disabled={ravn.status === 'suspended'}
        >
          {ravn.status === 'suspended' ? 'Already suspended' : 'Suspend ravn'}
        </button>

        <button type="button" className="rv-delete-btn" data-testid="delete-btn">
          Delete ravn
        </button>
      </div>
    </div>
  );
}

interface TriggersSectionProps {
  ravnPersonaName: string;
}

const TRIGGER_KIND_LABELS: Record<string, string> = {
  cron: '⏱',
  event: '⚡',
  webhook: '🔗',
  manual: '▶',
};

function TriggersSection({ ravnPersonaName }: TriggersSectionProps) {
  const { data: triggers } = useTriggers();
  const ravnTriggers = triggers?.filter((t) => t.personaName === ravnPersonaName) ?? [];

  return (
    <div data-testid="triggers-section-body">
      {ravnTriggers.length === 0 ? (
        <p className="rv-empty-text">No triggers configured</p>
      ) : (
        <div className="rv-trigger-cards">
          {ravnTriggers.map((t) => (
            <div
              key={t.id}
              className="rv-trigger-card"
              data-enabled={t.enabled}
              data-testid="trigger-card"
            >
              <div className="rv-trigger-card__header">
                <span
                  className={`rv-trigger-kind rv-trigger-kind--${t.kind}`}
                  data-testid="trigger-kind"
                >
                  <span className="rv-trigger-kind__icon" aria-hidden>
                    {TRIGGER_KIND_LABELS[t.kind] ?? t.kind}
                  </span>
                  {t.kind}
                </span>
                <span className="rv-trigger-spec" data-testid="trigger-spec">
                  {t.spec}
                </span>
                <button
                  type="button"
                  className={`rv-toggle${t.enabled ? ' rv-toggle--on' : ''}`}
                  aria-label={t.enabled ? 'Disable trigger' : 'Enable trigger'}
                  aria-checked={t.enabled}
                  data-testid="trigger-toggle"
                >
                  <span className="rv-toggle__thumb" />
                </button>
              </div>
              <div className="rv-trigger-card__meta">
                {t.lastFiredAt && (
                  <span className="rv-trigger-meta-item" data-testid="trigger-last-fired">
                    Last fired {relTime(t.lastFiredAt)}
                  </span>
                )}
                {t.fireCount != null && (
                  <span
                    className="rv-trigger-meta-item rv-trigger-meta-item--count"
                    data-testid="trigger-fire-count"
                  >
                    {t.fireCount} fires
                  </span>
                )}
                {!t.enabled && (
                  <span className="rv-trigger-meta-item rv-trigger-meta-item--disabled">
                    disabled
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ActivitySectionProps {
  ravnId: string;
  isActive: boolean;
}

function ActivitySection({ ravnId, isActive }: ActivitySectionProps) {
  const [kindFilter, setKindFilter] = useState<string>('all');
  const { data: messages, isLoading } = useRavnActivity(ravnId);

  const filtered = (messages ?? []).filter((m) => kindMatchesFilter(m.kind, kindFilter));
  const displayMessages = filtered.slice(-100);

  if (isLoading) {
    return <p className="rv-empty-text">Loading activity…</p>;
  }

  return (
    <div data-testid="activity-section-body">
      <div className="rv-activity-header">
        {isActive && (
          <span data-testid="activity-live">
            <LiveBadge label="live" />
          </span>
        )}
        <div className="rv-activity-filter" data-testid="activity-filter">
          {KIND_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`rv-activity-filter-btn${kindFilter === opt.value ? ' rv-activity-filter-btn--active' : ''}`}
              onClick={() => setKindFilter(opt.value)}
              data-testid={`activity-filter-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {displayMessages.length === 0 ? (
        <p className="rv-empty-text">
          {messages?.length === 0 ? 'No activity for this ravn' : 'No messages match this filter'}
        </p>
      ) : (
        <div className="rv-activity-messages" data-testid="activity-messages">
          {filtered.length > 100 && (
            <p className="rv-activity-overflow">Showing last 100 of {filtered.length} messages</p>
          )}
          {displayMessages.map((msg) => (
            <div
              key={msg.id}
              className="rv-activity-message"
              data-kind={msg.kind}
              data-testid="activity-message"
            >
              <span className="rv-activity-message__ts">{formatTs(msg.ts)}</span>
              <span
                className={`rv-activity-kind-badge rv-activity-kind-badge--${msg.kind}`}
                data-testid="activity-kind-badge"
              >
                {msg.kind}
              </span>
              <span className="rv-activity-message__content">
                {msg.content.slice(0, 120)}
                {msg.content.length > 120 ? '…' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SessionsSectionProps {
  ravnId: string;
}

function SessionsSection({ ravnId }: SessionsSectionProps) {
  const { data: sessions } = useSessions();
  const ravnSessions = sessions?.filter((s) => s.ravnId === ravnId) ?? [];

  function handleSessionClick(sessionId: string) {
    window.dispatchEvent(new CustomEvent('ravn:session-selected', { detail: { sessionId } }));
  }

  return (
    <div data-testid="sessions-section-body">
      {ravnSessions.length === 0 ? (
        <p className="rv-empty-text">No sessions</p>
      ) : (
        <div className="rv-session-cards">
          {ravnSessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="rv-session-card"
              data-testid="session-card"
              onClick={() => handleSessionClick(s.id)}
            >
              <div className="rv-session-card__header">
                <StateDot
                  state={
                    s.status === 'running'
                      ? 'running'
                      : s.status === 'failed'
                        ? 'failed'
                        : 'unknown'
                  }
                  pulse={s.status === 'running'}
                  size={8}
                />
                <span className="rv-session-card__title" data-testid="session-title">
                  {s.title ?? s.id.slice(0, 8)}
                </span>
                <span className="rv-session-card__status">{s.status}</span>
              </div>
              <div className="rv-session-card__sub">
                <span className="rv-session-card__model">{s.model}</span>
                <span className="rv-session-card__since">{relTime(s.createdAt)}</span>
              </div>
              <div className="rv-session-card__metrics" data-testid="session-metrics">
                {s.messageCount != null && (
                  <span className="rv-session-metric" data-testid="session-message-count">
                    {s.messageCount} msgs
                  </span>
                )}
                {s.costUsd != null && (
                  <span
                    className="rv-session-metric rv-session-metric--cost"
                    data-testid="session-cost"
                  >
                    ${s.costUsd.toFixed(2)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ConnectivitySectionProps {
  ravn: Ravn;
}

function ConnectivitySection({ ravn }: ConnectivitySectionProps) {
  const mcpServers = ravn.mcpServers ?? [];
  const gatewayChannels = ravn.gatewayChannels ?? [];
  const eventSubscriptions = ravn.eventSubscriptions ?? [];

  return (
    <div data-testid="connectivity-section-body">
      {/* MCP Servers */}
      <div className="rv-conn-panel" data-testid="conn-mcp-panel">
        <div className="rv-conn-panel__head">
          <h5 className="rv-conn-panel__title">MCP servers</h5>
          <span className="rv-conn-panel__count">{mcpServers.length}</span>
        </div>
        <div className="rv-conn-panel__body">
          {mcpServers.length === 0 ? (
            <span className="rv-empty-text">None configured</span>
          ) : (
            <div className="rv-conn-chips">
              {mcpServers.map((s) => (
                <span
                  key={s}
                  className="rv-conn-chip rv-conn-chip--mcp"
                  data-testid="mcp-server-chip"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Gateway Channels */}
      <div className="rv-conn-panel" data-testid="conn-gateway-panel">
        <div className="rv-conn-panel__head">
          <h5 className="rv-conn-panel__title">Gateway channels</h5>
          <span className="rv-conn-panel__count">{gatewayChannels.length}</span>
        </div>
        <div className="rv-conn-panel__body">
          {gatewayChannels.length === 0 ? (
            <span className="rv-empty-text">None configured</span>
          ) : (
            <div className="rv-conn-chips">
              {gatewayChannels.map((c) => (
                <span
                  key={c}
                  className="rv-conn-chip rv-conn-chip--gw"
                  data-testid="gateway-channel-chip"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Event Subscriptions */}
      <div className="rv-conn-panel" data-testid="conn-events-panel">
        <div className="rv-conn-panel__head">
          <h5 className="rv-conn-panel__title">Event subscriptions</h5>
          <span className="rv-conn-panel__count">{eventSubscriptions.length}</span>
        </div>
        <div className="rv-conn-panel__body">
          {eventSubscriptions.length === 0 ? (
            <span className="rv-empty-text">None configured</span>
          ) : (
            <div className="rv-conn-chips">
              {eventSubscriptions.map((e) => (
                <span
                  key={e}
                  className="rv-conn-chip rv-conn-chip--event"
                  data-testid="event-subscription-chip"
                >
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export interface RavnDetailProps {
  ravn: Ravn;
  onClose?: () => void;
}

export function RavnDetail({ ravn, onClose }: RavnDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    loadStorage<TabId>(TAB_STORAGE_KEY, 'overview'),
  );

  const { data: budget } = useRavnBudget(ravn.id);
  const { data: triggers } = useTriggers();
  const { data: sessions } = useSessions();

  const triggerCount = triggers?.filter((t) => t.personaName === ravn.personaName).length ?? 0;
  const sessionCount = sessions?.filter((s) => s.ravnId === ravn.id).length ?? 0;

  const handleTabChange = (id: TabId) => {
    saveStorage(TAB_STORAGE_KEY, id);
    setActiveTab(id);
  };

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'triggers', label: 'Triggers', count: triggerCount },
    { id: 'activity', label: 'Activity' },
    { id: 'sessions', label: 'Sessions', count: sessionCount },
    { id: 'connectivity', label: 'Connectivity' },
  ];

  return (
    <div data-testid="ravn-detail" className="rv-detail">
      {/* Header */}
      <div className="rv-detail__header">
        {ravn.role && ravn.letter ? (
          <PersonaAvatar role={ravn.role} letter={ravn.letter} size={22} />
        ) : null}
        <span className="rv-detail__title">{ravn.personaName}</span>
        <StateDot
          state={ravnStatusToDotState(ravn.status)}
          pulse={ravn.status === 'active'}
          size={8}
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail pane"
            className="rv-detail__close"
            data-testid="detail-close-btn"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tab nav */}
      <nav className="rv-sectabs" aria-label="Ravn detail sections" data-testid="ravn-sectabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`rv-sectab${activeTab === tab.id ? ' rv-sectab--active' : ''}`}
            data-testid={`sectab-${tab.id}`}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="rv-sectabs-n">{tab.count}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="rv-section__body" data-testid={`section-body-${activeTab}`}>
        {activeTab === 'overview' && <OverviewSection ravn={ravn} budget={budget} />}
        {activeTab === 'triggers' && <TriggersSection ravnPersonaName={ravn.personaName} />}
        {activeTab === 'activity' && (
          <ActivitySection ravnId={ravn.id} isActive={ravn.status === 'active'} />
        )}
        {activeTab === 'sessions' && <SessionsSection ravnId={ravn.id} />}
        {activeTab === 'connectivity' && <ConnectivitySection ravn={ravn} />}
      </div>
    </div>
  );
}
