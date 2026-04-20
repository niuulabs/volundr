/**
 * RavnSubnav — per-tab subnav rendered in the shell's left subnav column.
 *
 * Tabs that show subnav:
 *   personas  — persona list grouped by role
 *   sessions  — session list split into active / closed
 *
 * All other ravn tabs return null (shell hides the subnav column).
 */

import { useRouterState, useRouter } from '@tanstack/react-router';
import { PersonaAvatar } from '@niuulabs/ui';
import { usePersonas } from './usePersonas';
import { useSessions } from './hooks/useSessions';
import { useRavens } from './hooks/useRavens';
import { PERSONA_ROLE_ORDER } from '../catalog';
import { loadStorage, saveStorage } from './storage';
import type { PersonaRole } from '@niuulabs/domain';

const PERSONA_STORAGE_KEY = 'ravn.persona';
const SESSION_STORAGE_KEY = 'ravn.session';

// ── Personas subnav ──────────────────────────────────────────────────────────

function PersonasSubnav() {
  const { data, isLoading } = usePersonas();
  const { location } = useRouterState({ select: (s) => ({ location: s.location }) });
  const router = useRouter();

  const selectedName = loadStorage<string | null>(PERSONA_STORAGE_KEY, null);

  const handleSelect = (name: string) => {
    saveStorage(PERSONA_STORAGE_KEY, name);
    window.dispatchEvent(new CustomEvent('ravn:persona-selected', { detail: name }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void router.navigate({ to: location.pathname as any });
  };

  if (isLoading) {
    return (
      <div className="niuu-p-3 niuu-text-xs niuu-text-text-muted" data-testid="personas-subnav-loading">
        Loading personas…
      </div>
    );
  }

  const personas = data ?? [];

  // Group by role following PERSONA_ROLE_ORDER
  const byRole = new Map<PersonaRole, typeof personas>();
  for (const role of PERSONA_ROLE_ORDER) byRole.set(role, []);
  for (const p of personas) {
    const group = byRole.get(p.role);
    if (group) group.push(p);
    else byRole.get('plan')!.push(p);
  }

  return (
    <nav
      aria-label="Persona list"
      className="niuu-flex niuu-flex-col niuu-py-2 niuu-overflow-y-auto"
      data-testid="personas-subnav"
    >
      <div className="niuu-px-3 niuu-pt-1 niuu-pb-2 niuu-border-b niuu-border-border-subtle">
        <div className="niuu-text-sm niuu-font-medium niuu-text-text-primary">
          Personas{' '}
          <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">{personas.length}</span>
        </div>
        <div className="niuu-text-xs niuu-text-text-muted">cognitive templates</div>
      </div>

      {PERSONA_ROLE_ORDER.map((role) => {
        const group = byRole.get(role) ?? [];
        if (group.length === 0) return null;

        return (
          <div key={role} className="niuu-mt-2">
            <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-3 niuu-py-0.5">
              <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-uppercase niuu-tracking-wide">
                {role}
              </span>
              <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted">{group.length}</span>
            </div>
            {group.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handleSelect(p.name)}
                aria-current={p.name === selectedName ? 'page' : undefined}
                data-testid={`persona-subnav-item-${p.name}`}
                className={[
                  'niuu-flex niuu-items-center niuu-gap-2 niuu-w-full niuu-px-3 niuu-py-1.5',
                  'niuu-text-left niuu-text-xs niuu-border-0 niuu-rounded-none',
                  'niuu-transition-colors niuu-cursor-pointer',
                  p.name === selectedName
                    ? 'niuu-bg-bg-tertiary niuu-text-text-primary'
                    : 'niuu-bg-transparent niuu-text-text-secondary hover:niuu-bg-bg-secondary hover:niuu-text-text-primary',
                ].join(' ')}
              >
                <PersonaAvatar role={p.role} letter={p.letter} size={18} />
                <span className="niuu-font-mono niuu-truncate niuu-flex-1">{p.name}</span>
                {p.isBuiltin && (
                  <span className="niuu-shrink-0 niuu-px-1 niuu-py-0 niuu-rounded niuu-text-xs niuu-bg-bg-elevated niuu-text-text-muted">
                    usr
                  </span>
                )}
                {p.hasOverride && (
                  <span className="niuu-shrink-0 niuu-px-1 niuu-py-0 niuu-rounded niuu-text-xs niuu-bg-amber-500/10 niuu-text-amber-400">
                    ovr
                  </span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

// ── Sessions subnav ──────────────────────────────────────────────────────────

function SessionsSubnav() {
  const { data: sessions, isLoading } = useSessions();
  const { data: ravens } = useRavens();
  const { location } = useRouterState({ select: (s) => ({ location: s.location }) });
  const router = useRouter();

  const selectedId = loadStorage<string | null>(SESSION_STORAGE_KEY, null);

  const handleSelect = (id: string) => {
    saveStorage(SESSION_STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent('ravn:session-selected', { detail: id }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void router.navigate({ to: location.pathname as any });
  };

  if (isLoading) {
    return (
      <div className="niuu-p-3 niuu-text-xs niuu-text-text-muted" data-testid="sessions-subnav-loading">
        Loading sessions…
      </div>
    );
  }

  const sessionList = sessions ?? [];
  const ravnById = new Map((ravens ?? []).map((r) => [r.id, r]));

  const active = sessionList.filter((s) => s.status === 'running');
  const closed = sessionList.filter((s) => s.status !== 'running');

  return (
    <nav
      aria-label="Session list"
      className="niuu-flex niuu-flex-col niuu-py-2 niuu-overflow-y-auto"
      data-testid="sessions-subnav"
    >
      <div className="niuu-px-3 niuu-pt-1 niuu-pb-2 niuu-border-b niuu-border-border-subtle">
        <div className="niuu-text-sm niuu-font-medium niuu-text-text-primary">Sessions</div>
        <div className="niuu-text-xs niuu-text-text-muted">
          {active.length} active · {closed.length} closed
        </div>
      </div>

      {/* Active group */}
      {active.length > 0 && (
        <div className="niuu-mt-2">
          <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-3 niuu-py-0.5">
            <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-uppercase niuu-tracking-wide">
              active
            </span>
            <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted">{active.length}</span>
          </div>
          {active.map((s) => {
            const ravn = ravnById.get(s.ravnId);
            const persona = ravn?.personaName ?? s.personaName;
            return (
              <SessionSubnavItem
                key={s.id}
                id={s.id}
                title={s.title ?? `session ${s.id.slice(0, 8)}`}
                ravnId={s.ravnId}
                messageCount={s.messageCount}
                costUsd={s.costUsd}
                personaName={persona}
                selected={s.id === selectedId}
                faded={false}
                onSelect={handleSelect}
              />
            );
          })}
        </div>
      )}

      {/* Closed group */}
      {closed.length > 0 && (
        <div className="niuu-mt-2">
          <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-3 niuu-py-0.5">
            <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-uppercase niuu-tracking-wide">
              closed
            </span>
            <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted">{closed.length}</span>
          </div>
          {closed.map((s) => {
            const ravn = ravnById.get(s.ravnId);
            const persona = ravn?.personaName ?? s.personaName;
            return (
              <SessionSubnavItem
                key={s.id}
                id={s.id}
                title={s.title ?? `session ${s.id.slice(0, 8)}`}
                ravnId={s.ravnId}
                messageCount={s.messageCount}
                costUsd={s.costUsd}
                personaName={persona}
                selected={s.id === selectedId}
                faded
                onSelect={handleSelect}
              />
            );
          })}
        </div>
      )}
    </nav>
  );
}

interface SessionSubnavItemProps {
  id: string;
  title: string;
  ravnId: string;
  messageCount?: number;
  costUsd?: number;
  personaName: string;
  selected: boolean;
  faded: boolean;
  onSelect: (id: string) => void;
}

function SessionSubnavItem({
  id,
  title,
  ravnId,
  messageCount,
  costUsd,
  personaName,
  selected,
  faded,
  onSelect,
}: SessionSubnavItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-current={selected ? 'page' : undefined}
      data-testid={`session-subnav-item-${id}`}
      className={[
        'niuu-flex niuu-items-start niuu-gap-2 niuu-w-full niuu-px-3 niuu-py-1.5',
        'niuu-text-left niuu-text-xs niuu-border-0 niuu-rounded-none niuu-cursor-pointer',
        'niuu-transition-colors',
        faded ? 'niuu-opacity-50' : '',
        selected
          ? 'niuu-bg-bg-tertiary niuu-text-text-primary'
          : 'niuu-bg-transparent niuu-text-text-secondary hover:niuu-bg-bg-secondary hover:niuu-text-text-primary',
      ].join(' ')}
    >
      <PersonaAvatar role="build" letter={personaName[0]?.toUpperCase() ?? '?'} size={18} />
      <div className="niuu-flex niuu-flex-col niuu-min-w-0 niuu-flex-1">
        <span className="niuu-truncate niuu-text-xs">{title}</span>
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
          {ravnId.slice(0, 8)}
          {messageCount != null && ` · ${messageCount}m`}
          {costUsd != null && ` · $${costUsd.toFixed(2)}`}
        </span>
      </div>
    </button>
  );
}

// ── Root export ──────────────────────────────────────────────────────────────

export function RavnSubnav() {
  const { location } = useRouterState({ select: (s) => ({ location: s.location }) });
  const pathname = location.pathname;

  if (pathname === '/ravn/personas' || pathname.startsWith('/ravn/personas/')) {
    return <PersonasSubnav />;
  }

  if (pathname === '/ravn/sessions' || pathname.startsWith('/ravn/sessions/')) {
    return <SessionsSubnav />;
  }

  return null;
}
