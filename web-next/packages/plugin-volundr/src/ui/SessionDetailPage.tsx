import { useState, useMemo, useRef, useEffect } from 'react';
import { useService } from '@niuulabs/plugin-sdk';
import { useQuery } from '@tanstack/react-query';
import { LifecycleBadge, LoadingState, ErrorState, cn } from '@niuulabs/ui';
import type { ParticipantMeta, MeshEvent, MeshEventType } from '@niuulabs/ui';
import { Meter } from './atoms/Meter';
import { SourceLabel } from './atoms/SourceLabel';
import { ClusterChip } from './atoms/ClusterChip';
import { Terminal } from './Terminal/Terminal';
import { FileTree } from './FileTree/FileTree';
import { FileViewer } from './FileTree/FileViewer';
import { useSessionDetail } from './hooks/useSessionStore';
import { toLifecycleState } from './utils/toLifecycleState';
import type { IPtyStream } from '../ports/IPtyStream';
import type { IFileSystemPort, FileTreeNode } from '../ports/IFileSystemPort';
import type { Session } from '../domain/session';
import type { SessionSource } from './atoms/SourceLabel';
import type { ClusterData } from './atoms/ClusterChip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionTab = 'chat' | 'terminal' | 'diffs' | 'files' | 'chronicle' | 'logs';

const TABS: { id: SessionTab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'diffs', label: 'Diffs' },
  { id: 'files', label: 'Files' },
  { id: 'chronicle', label: 'Chronicle' },
  { id: 'logs', label: 'Logs' },
];

export interface SessionDetailPageProps {
  sessionId: string;
  readOnly?: boolean;
  initialTab?: SessionTab;
}

// ---------------------------------------------------------------------------
// Peer color utility (deterministic per peerId, brand-family)
// ---------------------------------------------------------------------------

function peerHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function peerColor(peerId: string | undefined): string {
  if (!peerId || peerId === 'human') return 'var(--color-text-primary)';
  const h = peerHash(peerId);
  const dL = ((h & 0xff) / 255) * 0.24 - 0.12;
  const dC = (((h >> 8) & 0xff) / 255) * 0.06 - 0.03;
  const L = Math.min(0.92, Math.max(0.58, 0.78 + dL)).toFixed(3);
  const C = Math.min(0.15, Math.max(0.06, 0.12 + dC)).toFixed(3);
  return `oklch(${L} ${C} 230)`;
}

// ---------------------------------------------------------------------------
// Mock data builders (chat tab uses mock room data in design mode)
// ---------------------------------------------------------------------------

interface PeerMeta extends ParticipantMeta {
  glyph: string;
  expanded?: boolean;
  gateway?: string;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'thinking' | 'tool';
  peerId: string;
  content: string;
  tool?: string;
  args?: string;
  output?: string;
  status?: 'ok' | 'err' | 'run';
  dur?: string;
  tokens?: number;
  ms?: number;
  ts: number;
  outcome?: OutcomeData;
  directedTo?: string[];
}

interface OutcomeData {
  verdict: string;
  eventType: string;
  summary: string;
  fields?: Record<string, unknown>;
  findings?: Array<{ severity: string; loc: string; msg: string }>;
}

interface MockRoom {
  roomId: string;
  participants: PeerMeta[];
  byId: Record<string, PeerMeta>;
  meshEvents: MeshEvent[];
}

type TurnGroup =
  | { kind: 'single'; turn: ChatTurn }
  | { kind: 'thinking'; turn: ChatTurn }
  | { kind: 'toolrun'; turns: ChatTurn[] };

function buildMockRoom(session: Session): MockRoom {
  const now = Date.now();
  const participants: PeerMeta[] = [
    {
      peerId: 'human',
      persona: 'human',
      displayName: 'You',
      glyph: 'H',
      status: 'idle',
      subscribesTo: [],
      emits: ['user.message'],
      tools: [],
    },
    {
      peerId: `ravn-${session.ravnId}`,
      persona: session.personaName,
      displayName: session.personaName,
      glyph: session.personaName[0]?.toUpperCase() ?? 'R',
      status: session.state === 'running' ? 'busy' : 'idle',
      subscribesTo: ['user.message', 'code.changed', 'test.result'],
      emits: ['code.changed', 'outcome.review'],
      tools: ['read_file', 'write_file', 'run_command', 'search_files'],
      gateway: 'bifrost://anthropic/claude-sonnet',
      expanded: true,
    },
    {
      peerId: 'reviewer-1',
      persona: 'reviewer',
      displayName: 'Reviewer',
      glyph: 'V',
      status: 'idle',
      subscribesTo: ['code.changed', 'outcome.review'],
      emits: ['outcome.review'],
      tools: ['read_file', 'search_files'],
      gateway: 'bifrost://anthropic/claude-haiku',
    },
  ];

  const byId: Record<string, PeerMeta> = {};
  for (const p of participants) {
    byId[p.peerId] = p;
  }

  const meshEvents: MeshEvent[] = [
    {
      id: 'me-1',
      type: 'outcome',
      timestamp: new Date(now - 300_000),
      participantId: 'reviewer-1',
      participant: { color: peerColor('reviewer-1') },
      persona: 'reviewer',
      eventType: 'code.review',
      verdict: 'pass',
      summary: 'Code review passed - clean implementation',
    },
    {
      id: 'me-2',
      type: 'mesh_message',
      timestamp: new Date(now - 200_000),
      participantId: `ravn-${session.ravnId}`,
      participant: { color: peerColor(`ravn-${session.ravnId}`) },
      fromPersona: session.personaName,
      eventType: 'code.changed',
      preview: 'Updated auth handler with new validation logic',
    },
    {
      id: 'me-3',
      type: 'notification',
      timestamp: new Date(now - 100_000),
      participantId: `ravn-${session.ravnId}`,
      participant: { color: peerColor(`ravn-${session.ravnId}`) },
      persona: session.personaName,
      notificationType: 'build.complete',
      summary: 'Build completed successfully',
      urgency: 1,
      recommendation: 'Ready for review',
    },
  ];

  return { roomId: `room-${session.id}`, participants, byId, meshEvents };
}

function buildMockTurns(_session: Session, room: MockRoom): ChatTurn[] {
  const now = Date.now();
  const mainPeer = room.participants[1]!;
  return [
    {
      id: 't-1',
      role: 'user',
      peerId: 'human',
      content: 'Implement the authentication handler with JWT validation',
      ts: now - 600_000,
    },
    {
      id: 't-2',
      role: 'thinking',
      peerId: mainPeer.peerId,
      content: 'I need to create a JWT validation handler. Let me check the existing auth setup first.',
      ms: 1200,
      ts: now - 590_000,
    },
    {
      id: 't-3',
      role: 'tool',
      peerId: mainPeer.peerId,
      content: '',
      tool: 'read_file',
      args: 'src/auth/handler.ts',
      output: 'export class AuthHandler { ... }',
      status: 'ok',
      dur: '45ms',
      ts: now - 580_000,
    },
    {
      id: 't-4',
      role: 'tool',
      peerId: mainPeer.peerId,
      content: '',
      tool: 'write_file',
      args: 'src/auth/jwt.ts',
      status: 'ok',
      dur: '12ms',
      ts: now - 570_000,
    },
    {
      id: 't-5',
      role: 'assistant',
      peerId: mainPeer.peerId,
      content: 'I\'ve implemented the JWT validation handler. It validates tokens using RS256 and checks expiry, issuer, and audience claims.',
      tokens: 847,
      ms: 3200,
      ts: now - 560_000,
    },
    {
      id: 't-6',
      role: 'user',
      peerId: 'human',
      content: 'Run the tests to make sure everything passes',
      ts: now - 400_000,
    },
    {
      id: 't-7',
      role: 'tool',
      peerId: mainPeer.peerId,
      content: '',
      tool: 'run_command',
      args: 'npm test',
      output: 'PASS src/auth/jwt.test.ts\n  14 passing (1.2s)',
      status: 'ok',
      dur: '1.2s',
      ts: now - 390_000,
    },
    {
      id: 't-8',
      role: 'assistant',
      peerId: mainPeer.peerId,
      content: 'All 14 tests pass. The JWT validation is working correctly.',
      tokens: 156,
      ms: 890,
      ts: now - 380_000,
      outcome: {
        verdict: 'pass',
        eventType: 'test.result',
        summary: 'All tests passing',
      },
    },
  ];
}

function groupTurns(turns: ChatTurn[]): TurnGroup[] {
  const out: TurnGroup[] = [];
  let bucket: { kind: 'toolrun'; peerId: string; turns: ChatTurn[] } | null = null;
  for (const t of turns) {
    if (t.role === 'tool') {
      if (!bucket || bucket.peerId !== t.peerId) {
        bucket = { kind: 'toolrun', peerId: t.peerId, turns: [] };
        out.push(bucket);
      }
      bucket.turns.push(t);
    } else {
      bucket = null;
      if (t.role === 'thinking') {
        out.push({ kind: 'thinking', turn: t });
      } else {
        out.push({ kind: 'single', turn: t });
      }
    }
  }
  return out;
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Stat helper
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="niuu-flex niuu-flex-col niuu-items-center niuu-gap-0.5" data-testid="stat">
      <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
        {label}
      </span>
      <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionHeader
// ---------------------------------------------------------------------------

function SessionHeader({
  session,
  readOnly,
}: {
  session: Session;
  readOnly: boolean;
}) {
  const [showRes, setShowRes] = useState(false);
  const r = session.resources;

  // Derive a mock source and cluster from session data
  const source: SessionSource = {
    type: 'git',
    repo: `niuulabs/${session.templateId}`,
    branch: 'main',
  };

  const cluster: ClusterData = {
    name: session.clusterId,
    kind: 'primary',
  };

  // Duration since startedAt
  const elapsedMs = Date.now() - new Date(session.startedAt).getTime();
  const durationMin = Math.floor(elapsedMs / 60_000);
  const duration =
    durationMin >= 60 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : `${durationMin}m`;

  return (
    <header data-testid="session-header">
      {/* Main row */}
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2">
        <LifecycleBadge state={toLifecycleState(session.state)} />
        <h1
          className="niuu-font-mono niuu-text-sm niuu-font-medium niuu-text-text-primary"
          data-testid="session-name"
        >
          {session.personaName}
        </h1>
        <span
          className="niuu-font-mono niuu-text-xs niuu-text-text-muted"
          data-testid="session-id-label"
        >
          {session.id}
        </span>

        {session.sagaId && (
          <a
            className="niuu-font-mono niuu-text-xs niuu-text-brand hover:niuu-underline"
            href="#"
            data-testid="session-issue-link"
          >
            {session.sagaId}
          </a>
        )}

        <span className="niuu-mx-1 niuu-h-3 niuu-w-px niuu-bg-border-subtle" aria-hidden />

        <SourceLabel source={source} short />

        <span className="niuu-mx-1 niuu-h-3 niuu-w-px niuu-bg-border-subtle" aria-hidden />

        <ClusterChip cluster={cluster} />

        {readOnly && (
          <span
            className="niuu-rounded niuu-bg-bg-elevated niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-text-text-muted"
            data-testid="session-archived-badge"
          >
            archived
          </span>
        )}

        <div className="niuu-flex-1" />

        <div className="niuu-flex niuu-items-center niuu-gap-4" data-testid="session-stats">
          <Stat label="uptime" value={duration} />
          <Stat label="events" value={session.events.length} />
        </div>

        <button
          className={cn(
            'niuu-ml-2 niuu-rounded niuu-px-2 niuu-py-1 niuu-text-xs niuu-font-mono',
            showRes
              ? 'niuu-bg-bg-elevated niuu-text-brand'
              : 'niuu-text-text-muted hover:niuu-text-text-secondary',
          )}
          onClick={() => setShowRes((v) => !v)}
          data-testid="resources-toggle"
        >
          {showRes ? 'hide' : 'res'}
        </button>
      </div>

      {/* Resources row (collapsible) */}
      {showRes && (
        <div
          className="niuu-flex niuu-items-center niuu-gap-4 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2"
          data-testid="resources-row"
        >
          <Meter
            used={r.cpuUsed}
            limit={r.cpuLimit}
            unit="c"
            label="cpu"
            className="niuu-w-32"
          />
          <Meter
            used={r.memUsedMi}
            limit={r.memLimitMi}
            unit="Mi"
            label="mem"
            className="niuu-w-32"
          />
          {r.gpuCount > 0 && (
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
              gpu: {r.gpuCount}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// PeerRail (left column of chat)
// ---------------------------------------------------------------------------

function PeerCard({
  peer,
  active,
  onToggle,
}: {
  peer: PeerMeta;
  active: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(peer.expanded ?? false);
  const color = peerColor(peer.peerId);

  return (
    <div
      className={cn(
        'niuu-rounded-md niuu-border niuu-p-2',
        active ? 'niuu-border-brand niuu-bg-bg-tertiary' : 'niuu-border-border-subtle',
      )}
      data-testid="peer-card"
    >
      <button
        className="niuu-flex niuu-w-full niuu-items-center niuu-gap-2 niuu-text-left"
        onClick={onToggle}
        data-testid="peer-focus-btn"
      >
        <span
          className="niuu-flex niuu-h-6 niuu-w-6 niuu-items-center niuu-justify-center niuu-rounded-full niuu-font-mono niuu-text-xs"
          style={{ backgroundColor: color, color: '#000' }}
          data-testid="peer-avatar"
        >
          {peer.glyph}
        </span>
        <span className="niuu-flex niuu-flex-col">
          <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary" style={{ color }}>
            {peer.displayName}
          </span>
          <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
            {peer.persona} · {peer.status ?? 'idle'}
          </span>
        </span>
      </button>

      <button
        className="niuu-mt-1 niuu-w-full niuu-text-left niuu-font-mono niuu-text-[10px] niuu-text-text-muted hover:niuu-text-text-secondary"
        onClick={() => setOpen((v) => !v)}
        data-testid="peer-expand-btn"
      >
        {open ? '\u25BC details' : '\u25B6 details'}
      </button>

      {open && (
        <div className="niuu-mt-2 niuu-flex niuu-flex-col niuu-gap-2" data-testid="peer-details">
          {peer.subscribesTo && peer.subscribesTo.length > 0 && (
            <div>
              <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
                subscribes
              </span>
              <div className="niuu-mt-0.5 niuu-flex niuu-flex-wrap niuu-gap-1">
                {peer.subscribesTo.map((s) => (
                  <span
                    key={s}
                    className="niuu-font-mono niuu-text-[10px] niuu-text-text-secondary"
                  >
                    \u2193 {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {peer.emits && peer.emits.length > 0 && (
            <div>
              <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
                emits
              </span>
              <div className="niuu-mt-0.5 niuu-flex niuu-flex-wrap niuu-gap-1">
                {peer.emits.map((e) => (
                  <span key={e} className="niuu-font-mono niuu-text-[10px] niuu-text-brand">
                    \u2191 {e}
                  </span>
                ))}
              </div>
            </div>
          )}
          {peer.tools && peer.tools.length > 0 && (
            <div>
              <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
                tools
              </span>
              <div className="niuu-mt-0.5 niuu-flex niuu-flex-wrap niuu-gap-1">
                {peer.tools.map((t) => (
                  <span
                    key={t}
                    className="niuu-rounded niuu-bg-bg-elevated niuu-px-1 niuu-font-mono niuu-text-[10px] niuu-text-text-secondary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {peer.gateway && (
            <div>
              <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
                gateway
              </span>
              <div className="niuu-mt-0.5 niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
                {peer.gateway}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PeerRail({
  room,
  focusPeer,
  setFocusPeer,
}: {
  room: MockRoom;
  focusPeer: string | null;
  setFocusPeer: (id: string | null) => void;
}) {
  return (
    <div
      className="niuu-flex niuu-w-56 niuu-flex-col niuu-gap-2 niuu-overflow-y-auto niuu-border-r niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-3"
      data-testid="peer-rail"
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between">
        <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
          participants
        </span>
        <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
          {room.participants.length}
        </span>
      </div>
      {room.participants.map((p) => (
        <PeerCard
          key={p.peerId}
          peer={p}
          active={focusPeer === p.peerId}
          onToggle={() => setFocusPeer(focusPeer === p.peerId ? null : p.peerId)}
        />
      ))}
      <div className="niuu-mt-auto niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
        room · {room.roomId}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatStream (center column of chat)
// ---------------------------------------------------------------------------

function ThinkingBlock({ turn, peer }: { turn: ChatTurn; peer: PeerMeta | undefined }) {
  const [open, setOpen] = useState(false);
  const firstLine = (turn.content || '').split('\n')[0] ?? '';
  const color = peerColor(peer?.peerId);

  return (
    <div className="niuu-my-1" data-testid="thinking-block">
      <button
        className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-left niuu-text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="niuu-text-text-muted">{open ? '\u25BC' : '\u25B6'}</span>
        {peer && (
          <span className="niuu-font-mono" style={{ color }}>
            {peer.glyph}
          </span>
        )}
        <span className="niuu-font-mono niuu-text-text-muted">thinking</span>
        <span className="niuu-font-mono niuu-text-text-muted">{turn.ms}ms</span>
        {!open && (
          <span className="niuu-text-text-muted">{truncate(firstLine, 80)}</span>
        )}
      </button>
      {open && (
        <pre className="niuu-ml-8 niuu-mt-1 niuu-whitespace-pre-wrap niuu-font-mono niuu-text-xs niuu-text-text-secondary">
          {turn.content}
        </pre>
      )}
    </div>
  );
}

function ToolRunBlock({
  turns,
  room,
}: {
  turns: ChatTurn[];
  room: MockRoom;
}) {
  const [open, setOpen] = useState(false);
  const peer = room.byId[turns[0]?.peerId ?? ''];
  const color = peerColor(peer?.peerId);
  const errCount = turns.filter((t) => t.status === 'err').length;
  const okCount = turns.filter((t) => t.status === 'ok').length;
  const headline = turns[turns.length - 1]!;

  return (
    <div className="niuu-my-1 niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary" data-testid="tool-run">
      <button
        className="niuu-flex niuu-w-full niuu-items-center niuu-gap-2 niuu-px-3 niuu-py-1.5 niuu-text-left niuu-text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="niuu-text-text-muted">{open ? '\u25BC' : '\u25B6'}</span>
        {peer && (
          <span className="niuu-font-mono" style={{ color }}>
            {peer.glyph} {peer.displayName}
          </span>
        )}
        <span className="niuu-font-mono niuu-text-text-muted">
          {turns.length} {turns.length === 1 ? 'call' : 'calls'}
        </span>
        <span className="niuu-font-mono niuu-text-text-secondary">{headline.tool}</span>
        <span className="niuu-font-mono niuu-text-text-muted">
          {truncate(headline.args, 40)}
        </span>
        <div className="niuu-flex-1" />
        {okCount > 0 && (
          <span className="niuu-font-mono niuu-text-[10px] niuu-text-state-ok">{okCount} ok</span>
        )}
        {errCount > 0 && (
          <span className="niuu-font-mono niuu-text-[10px] niuu-text-critical">{errCount} err</span>
        )}
      </button>
      {open && (
        <div className="niuu-border-t niuu-border-border-subtle niuu-px-3 niuu-py-2">
          {turns.map((t) => (
            <div key={t.id} className="niuu-flex niuu-items-start niuu-gap-2 niuu-py-1 niuu-text-xs">
              <span className="niuu-font-mono niuu-text-text-secondary">{t.tool}</span>
              <span className="niuu-font-mono niuu-text-text-muted">{t.args}</span>
              {t.status === 'ok' && (
                <span className="niuu-font-mono niuu-text-state-ok">ok</span>
              )}
              {t.status === 'err' && (
                <span className="niuu-font-mono niuu-text-critical">err</span>
              )}
              <span className="niuu-font-mono niuu-text-text-muted">{t.dur}</span>
              {t.output && (
                <pre className="niuu-mt-0.5 niuu-whitespace-pre-wrap niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
                  {truncate(t.output, 120)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatTurnComponent({ turn, room }: { turn: ChatTurn; room: MockRoom }) {
  const peer = room.byId[turn.peerId];
  const color = peerColor(peer?.peerId);

  if (turn.role === 'user') {
    return (
      <div className="niuu-my-2 niuu-flex niuu-gap-3" data-testid="chat-turn-user">
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">you</span>
        <div className="niuu-flex-1">
          {turn.directedTo && turn.directedTo.length > 0 && (
            <div className="niuu-mb-1 niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
              directed \u2192{' '}
              {turn.directedTo.map((id) => (
                <span key={id} style={{ color: peerColor(id) }}>
                  {room.byId[id]?.displayName ?? id}
                </span>
              ))}
            </div>
          )}
          <div className="niuu-text-sm niuu-text-text-primary">{turn.content}</div>
        </div>
        <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
          {formatTimestamp(turn.ts)}
        </span>
      </div>
    );
  }

  // assistant turn
  return (
    <div className="niuu-my-2 niuu-flex niuu-gap-3" data-testid="chat-turn-assistant">
      <span
        className="niuu-flex niuu-h-6 niuu-w-6 niuu-flex-shrink-0 niuu-items-center niuu-justify-center niuu-rounded-full niuu-font-mono niuu-text-xs"
        style={{ backgroundColor: color, color: '#000' }}
      >
        {peer?.glyph ?? 'c'}
      </span>
      <div className="niuu-flex-1">
        <div className="niuu-mb-1 niuu-flex niuu-items-center niuu-gap-2 niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
          <span style={{ color }}>{peer?.displayName ?? turn.peerId}</span>
          <span>\u00b7</span>
          <span>{peer?.persona ?? ''}</span>
          {turn.tokens && (
            <>
              <span>\u00b7</span>
              <span>{turn.tokens}t</span>
            </>
          )}
          {turn.ms && (
            <>
              <span>\u00b7</span>
              <span>{turn.ms}ms</span>
            </>
          )}
        </div>
        <div className="niuu-text-sm niuu-text-text-primary">{turn.content}</div>
        {turn.outcome && (
          <div
            className="niuu-mt-2 niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-tertiary niuu-p-2"
            data-testid="outcome-card"
          >
            <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-xs">
              <span className="niuu-font-mono niuu-text-text-muted">---outcome---</span>
              <span
                className={cn(
                  'niuu-font-mono niuu-font-medium',
                  turn.outcome.verdict === 'pass' || turn.outcome.verdict === 'verified'
                    ? 'niuu-text-state-ok'
                    : turn.outcome.verdict === 'fail' || turn.outcome.verdict === 'blocked'
                      ? 'niuu-text-critical'
                      : 'niuu-text-state-warn',
                )}
              >
                {turn.outcome.verdict}
              </span>
              <span className="niuu-font-mono niuu-text-text-muted">{turn.outcome.eventType}</span>
            </div>
            <div className="niuu-mt-1 niuu-text-xs niuu-text-text-secondary">
              {turn.outcome.summary}
            </div>
          </div>
        )}
      </div>
      <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
        {formatTimestamp(turn.ts)}
      </span>
    </div>
  );
}

function ChatStream({
  groups,
  room,
}: {
  groups: TurnGroup[];
  room: MockRoom;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [groups.length]);

  return (
    <div
      className="niuu-flex niuu-flex-1 niuu-flex-col niuu-overflow-hidden"
      data-testid="chat-stream"
    >
      <div className="niuu-flex-1 niuu-overflow-y-auto niuu-px-4 niuu-py-2" ref={scrollRef}>
        {groups.map((g, i) => {
          if (g.kind === 'toolrun') {
            return <ToolRunBlock key={i} turns={g.turns} room={room} />;
          }
          if (g.kind === 'thinking') {
            return (
              <ThinkingBlock key={i} turn={g.turn} peer={room.byId[g.turn.peerId]} />
            );
          }
          return <ChatTurnComponent key={i} turn={g.turn} room={room} />;
        })}
        {groups.length === 0 && (
          <div className="niuu-py-8 niuu-text-center niuu-font-mono niuu-text-xs niuu-text-text-muted">
            no messages yet
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MeshCascade (right column of chat)
// ---------------------------------------------------------------------------

type CascadeFilterType = 'all' | MeshEventType;

function CascadeEvent({ event, room }: { event: MeshEvent; room: MockRoom }) {
  const ts = new Date(event.timestamp);
  const tsLabel = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
  const participantPeer = room.byId[event.participantId];
  const dotColor = peerColor(participantPeer?.peerId);

  if (event.type === 'outcome') {
    const verdictClass =
      event.verdict === 'pass' || event.verdict === 'approve'
        ? 'niuu-text-state-ok'
        : event.verdict === 'fail' || event.verdict === 'escalate'
          ? 'niuu-text-critical'
          : 'niuu-text-state-warn';
    return (
      <div
        className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-2"
        data-testid="cascade-event"
      >
        <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-xs">
          <span className="niuu-font-mono niuu-text-text-muted">outcome</span>
          <span className="niuu-font-mono niuu-text-text-muted">{tsLabel}</span>
        </div>
        <div className="niuu-mt-1 niuu-flex niuu-items-center niuu-gap-1">
          <span
            className="niuu-inline-block niuu-h-2 niuu-w-2 niuu-rounded-full"
            style={{ backgroundColor: dotColor }}
          />
          <span className="niuu-font-mono niuu-text-xs">
            {participantPeer?.displayName ?? event.participantId}
          </span>
          <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
            {event.eventType}
          </span>
        </div>
        {event.verdict && (
          <div className={cn('niuu-mt-1 niuu-font-mono niuu-text-xs niuu-font-medium', verdictClass)}>
            {event.verdict}
          </div>
        )}
        {event.summary && (
          <div className="niuu-mt-1 niuu-text-xs niuu-text-text-secondary">{event.summary}</div>
        )}
      </div>
    );
  }

  if (event.type === 'mesh_message') {
    return (
      <div
        className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-2"
        data-testid="cascade-event"
      >
        <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-xs">
          <span className="niuu-font-mono niuu-text-text-muted">delegation</span>
          <span className="niuu-font-mono niuu-text-text-muted">{tsLabel}</span>
        </div>
        <div className="niuu-mt-1 niuu-flex niuu-items-center niuu-gap-1">
          <span
            className="niuu-inline-block niuu-h-2 niuu-w-2 niuu-rounded-full"
            style={{ backgroundColor: dotColor }}
          />
          <span className="niuu-font-mono niuu-text-xs">{event.fromPersona}</span>
          <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
            {event.eventType}
          </span>
        </div>
        {event.preview && (
          <div className="niuu-mt-1 niuu-text-xs niuu-text-text-muted">{event.preview}</div>
        )}
      </div>
    );
  }

  // notification
  const urgencyLabel = event.urgency >= 3 ? 'urgent' : event.urgency >= 2 ? 'help' : 'note';
  return (
    <div
      className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-p-2"
      data-testid="cascade-event"
    >
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-xs">
        <span className="niuu-font-mono niuu-text-text-muted">{urgencyLabel}</span>
        <span className="niuu-font-mono niuu-text-text-muted">{tsLabel}</span>
      </div>
      <div className="niuu-mt-1 niuu-flex niuu-items-center niuu-gap-1">
        <span
          className="niuu-inline-block niuu-h-2 niuu-w-2 niuu-rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <span className="niuu-font-mono niuu-text-xs">
          {participantPeer?.displayName ?? event.participantId}
        </span>
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
          {event.notificationType}
        </span>
      </div>
      <div className="niuu-mt-1 niuu-text-xs niuu-text-text-secondary">{event.summary}</div>
      {event.recommendation && (
        <div className="niuu-mt-1 niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
          \u2192 {event.recommendation}
        </div>
      )}
    </div>
  );
}

function MeshCascade({
  room,
  events,
  filter,
  setFilter,
}: {
  room: MockRoom;
  events: MeshEvent[];
  filter: CascadeFilterType;
  setFilter: (f: CascadeFilterType) => void;
}) {
  const filtered = filter === 'all' ? events : events.filter((e) => e.type === filter);

  const filterOptions: { id: CascadeFilterType; label: string }[] = [
    { id: 'all', label: 'all' },
    { id: 'outcome', label: 'outcomes' },
    { id: 'mesh_message', label: 'delegations' },
    { id: 'notification', label: 'notifs' },
  ];

  return (
    <div
      className="niuu-flex niuu-w-56 niuu-flex-col niuu-border-l niuu-border-border-subtle niuu-bg-bg-secondary"
      data-testid="mesh-cascade"
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-3 niuu-py-2">
        <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-wider niuu-text-text-muted">
          mesh cascade
        </span>
        <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
          {filtered.length}
        </span>
      </div>

      <div className="niuu-flex niuu-gap-1 niuu-px-3 niuu-pb-2">
        {filterOptions.map((f) => (
          <button
            key={f.id}
            className={cn(
              'niuu-rounded niuu-px-1.5 niuu-py-0.5 niuu-font-mono niuu-text-[10px]',
              filter === f.id
                ? 'niuu-bg-bg-elevated niuu-text-brand'
                : 'niuu-text-text-muted hover:niuu-text-text-secondary',
            )}
            onClick={() => setFilter(f.id)}
            data-testid={`cascade-filter-${f.id}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="niuu-flex niuu-flex-1 niuu-flex-col niuu-gap-2 niuu-overflow-y-auto niuu-px-3 niuu-pb-3">
        {filtered.map((e) => (
          <CascadeEvent key={e.id} event={e} room={room} />
        ))}
        {filtered.length === 0 && (
          <div className="niuu-py-4 niuu-text-center niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
            no events
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatTab
// ---------------------------------------------------------------------------

function ChatTab({ session }: { session: Session }) {
  const room = useMemo(() => buildMockRoom(session), [session]);
  const turns = useMemo(() => buildMockTurns(session, room), [session, room]);
  const grouped = useMemo(() => groupTurns(turns), [turns]);
  const [focusPeer, setFocusPeer] = useState<string | null>(null);
  const [cascadeFilter, setCascadeFilter] = useState<CascadeFilterType>('all');

  const filteredGroups = useMemo(() => {
    if (!focusPeer) return grouped;
    return grouped
      .map((g) => {
        if (g.kind === 'toolrun') {
          const t = g.turns.filter((x) => x.peerId === focusPeer);
          return t.length ? { kind: 'toolrun' as const, turns: t } : null;
        }
        return g.turn.peerId === focusPeer ? g : null;
      })
      .filter((g): g is TurnGroup => g !== null);
  }, [grouped, focusPeer]);

  return (
    <div className="niuu-flex niuu-h-full" data-testid="chat-tab">
      <PeerRail room={room} focusPeer={focusPeer} setFocusPeer={setFocusPeer} />
      <ChatStream groups={filteredGroups} room={room} />
      <MeshCascade
        room={room}
        events={room.meshEvents}
        filter={cascadeFilter}
        setFilter={setCascadeFilter}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder tabs
// ---------------------------------------------------------------------------

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div
      className="niuu-flex niuu-h-full niuu-items-center niuu-justify-center niuu-font-mono niuu-text-sm niuu-text-text-muted"
      data-testid={`placeholder-${label.toLowerCase()}`}
    >
      {label} tab \u2014 coming soon
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

/** Six-tab session detail page (Chat / Terminal / Diffs / Files / Chronicle / Logs). */
export function SessionDetailPage({
  sessionId,
  readOnly = false,
  initialTab = 'chat',
}: SessionDetailPageProps) {
  const [activeTab, setActiveTab] = useState<SessionTab>(initialTab);
  const [activePath, setActivePath] = useState<string | undefined>(undefined);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | undefined>(undefined);

  const ptyStream = useService<IPtyStream>('ptyStream');
  const filesystem = useService<IFileSystemPort>('filesystem');

  const sessionQuery = useSessionDetail(sessionId);

  const treeQuery = useQuery<FileTreeNode[]>({
    queryKey: ['volundr', 'filetree', sessionId],
    queryFn: () => filesystem.listTree(sessionId),
    enabled: activeTab === 'files',
  });

  async function handleOpenFile(path: string) {
    setActivePath(path);
    setFileLoading(true);
    setFileError(undefined);
    setFileContent('');
    try {
      const content = await filesystem.readFile(sessionId, path);
      setFileContent(content);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setFileLoading(false);
    }
  }

  const session = sessionQuery.data;

  return (
    <div className="niuu-flex niuu-h-full niuu-flex-col" data-testid="session-detail-page">
      {/* Header */}
      {session ? (
        <SessionHeader session={session} readOnly={readOnly} />
      ) : (
        <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2">
          <span
            className="niuu-font-mono niuu-text-sm niuu-text-text-primary"
            data-testid="session-id-label"
          >
            {sessionId}
          </span>
          {readOnly && (
            <span
              className="niuu-rounded niuu-bg-bg-elevated niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-text-text-muted"
              data-testid="session-archived-badge"
            >
              archived
            </span>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div
        className="niuu-flex niuu-items-center niuu-gap-0 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary"
        role="tablist"
        aria-label="Session tabs"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={
              activeTab === tab.id
                ? 'niuu-border-b-2 niuu-border-brand niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-brand'
                : 'niuu-border-b-2 niuu-border-transparent niuu-px-4 niuu-py-2 niuu-text-sm niuu-text-text-muted hover:niuu-text-text-secondary'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="niuu-min-h-0 niuu-flex-1 niuu-overflow-auto">
        {/* Chat */}
        <div
          role="tabpanel"
          aria-labelledby="tab-chat"
          hidden={activeTab !== 'chat'}
          className="niuu-h-full"
        >
          {activeTab === 'chat' && sessionQuery.isLoading && (
            <LoadingState label="Loading session\u2026" />
          )}
          {activeTab === 'chat' && sessionQuery.isError && (
            <ErrorState
              title="Failed to load session"
              message={
                sessionQuery.error instanceof Error ? sessionQuery.error.message : 'Unknown error'
              }
            />
          )}
          {activeTab === 'chat' && session && <ChatTab session={session} />}
        </div>

        {/* Terminal */}
        <div
          role="tabpanel"
          aria-labelledby="tab-terminal"
          hidden={activeTab !== 'terminal'}
          className="niuu-h-full niuu-min-h-[300px]"
        >
          {activeTab === 'terminal' && (
            <Terminal sessionId={sessionId} stream={ptyStream} readOnly={readOnly} />
          )}
        </div>

        {/* Diffs */}
        <div
          role="tabpanel"
          aria-labelledby="tab-diffs"
          hidden={activeTab !== 'diffs'}
          className="niuu-h-full"
        >
          {activeTab === 'diffs' && <PlaceholderTab label="Diffs" />}
        </div>

        {/* Files */}
        <div
          role="tabpanel"
          aria-labelledby="tab-files"
          hidden={activeTab !== 'files'}
          className="niuu-grid niuu-h-full niuu-grid-cols-[220px_1fr] niuu-gap-4 niuu-p-4"
        >
          {activeTab === 'files' && (
            <>
              <div className="niuu-overflow-auto niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary">
                {treeQuery.isLoading && (
                  <p
                    className="niuu-p-3 niuu-text-xs niuu-text-text-muted"
                    data-testid="filetree-loading"
                  >
                    loading files\u2026
                  </p>
                )}
                {treeQuery.isError && (
                  <p
                    className="niuu-p-3 niuu-text-xs niuu-text-critical"
                    data-testid="filetree-error"
                  >
                    failed to load files
                  </p>
                )}
                {treeQuery.data && (
                  <FileTree
                    nodes={treeQuery.data}
                    onOpenFile={handleOpenFile}
                    activePath={activePath}
                  />
                )}
              </div>

              <div className="niuu-overflow-hidden">
                {activePath ? (
                  <FileViewer
                    path={activePath}
                    content={fileContent}
                    isLoading={fileLoading}
                    error={fileError}
                    onClose={() => setActivePath(undefined)}
                  />
                ) : (
                  <div
                    className="niuu-flex niuu-h-full niuu-items-center niuu-justify-center niuu-rounded-md niuu-border niuu-border-border-subtle niuu-text-sm niuu-text-text-muted"
                    data-testid="file-viewer-placeholder"
                  >
                    Select a file to view its contents
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Chronicle */}
        <div
          role="tabpanel"
          aria-labelledby="tab-chronicle"
          hidden={activeTab !== 'chronicle'}
          className="niuu-h-full"
        >
          {activeTab === 'chronicle' && <PlaceholderTab label="Chronicle" />}
        </div>

        {/* Logs */}
        <div
          role="tabpanel"
          aria-labelledby="tab-logs"
          hidden={activeTab !== 'logs'}
          className="niuu-h-full"
        >
          {activeTab === 'logs' && <PlaceholderTab label="Logs" />}
        </div>
      </div>
    </div>
  );
}
