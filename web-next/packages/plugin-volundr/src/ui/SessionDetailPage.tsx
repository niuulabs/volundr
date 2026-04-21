import { useState, useMemo, useRef, useEffect } from 'react';
import { useService } from '@niuulabs/plugin-sdk';
import { useQuery } from '@tanstack/react-query';
import {
  LifecycleBadge,
  LoadingState,
  ErrorState,
  cn,
  Meter,
  MeshSidebar,
  MeshEventCard,
  resolveParticipantColor,
  relTime,
} from '@niuulabs/ui';
import type { MeshEvent, MeshEventType, RoomParticipant } from '@niuulabs/ui';
import { SourceLabel } from './atoms/SourceLabel';
import { ClusterChip } from './atoms/ClusterChip';
import { Terminal } from './Terminal/Terminal';
import { FileTree } from './FileTree/FileTree';
import { FileViewer } from './FileTree/FileViewer';
import { useSessionDetail } from './hooks/useSessionStore';
import { toLifecycleState } from './utils/toLifecycleState';
import { buildMockRoom, buildMockTurns, groupTurns } from '../testing/mockChatData';
import type { ChatTurn, PeerMeta, MockRoom, TurnGroup } from '../testing/mockChatData';
import type { IPtyStream } from '../ports/IPtyStream';
import type { IFileSystemPort, FileTreeNode } from '../ports/IFileSystemPort';
import type { Session, SessionFileStats } from '../domain/session';
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
// Helpers
// ---------------------------------------------------------------------------

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
// FileChangeSummary
// ---------------------------------------------------------------------------

function FileChangeSummary({ files }: { files: SessionFileStats }) {
  return (
    <div
      className="niuu-flex niuu-items-center niuu-gap-3 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-1.5"
      data-testid="file-change-summary"
    >
      <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted">files</span>
      <span className="niuu-font-mono niuu-text-xs niuu-text-state-ok" data-testid="files-added">
        +{files.added}
      </span>
      <span
        className="niuu-font-mono niuu-text-xs niuu-text-state-warn"
        data-testid="files-modified"
      >
        ~{files.modified}
      </span>
      <span className="niuu-font-mono niuu-text-xs niuu-text-critical" data-testid="files-deleted">
        -{files.deleted}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionHeader
// ---------------------------------------------------------------------------

function SessionHeader({ session, readOnly }: { session: Session; readOnly: boolean }) {
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

      {/* File change summary row */}
      {session.files && <FileChangeSummary files={session.files} />}

      {/* Resources row (collapsible) */}
      {showRes && (
        <div
          className="niuu-flex niuu-items-center niuu-gap-4 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2"
          data-testid="resources-row"
        >
          <Meter used={r.cpuUsed} limit={r.cpuLimit} unit="c" label="cpu" className="niuu-w-32" />
          <Meter
            used={r.memUsedMi}
            limit={r.memLimitMi}
            unit="Mi"
            label="mem"
            className="niuu-w-32"
          />
          {r.diskUsedMi !== undefined && r.diskLimitMi !== undefined && (
            <Meter
              used={r.diskUsedMi}
              limit={r.diskLimitMi}
              unit="Mi"
              label="disk"
              className="niuu-w-32"
            />
          )}
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
// ChatStream (center column of chat)
// ---------------------------------------------------------------------------

function ThinkingBlock({ turn, peer }: { turn: ChatTurn; peer: PeerMeta | undefined }) {
  const [open, setOpen] = useState(false);
  const firstLine = (turn.content || '').split('\n')[0] ?? '';
  const color = resolveParticipantColor(peer?.peerId ?? '');

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
        {!open && <span className="niuu-text-text-muted">{truncate(firstLine, 80)}</span>}
      </button>
      {open && (
        <pre className="niuu-ml-8 niuu-mt-1 niuu-whitespace-pre-wrap niuu-font-mono niuu-text-xs niuu-text-text-secondary">
          {turn.content}
        </pre>
      )}
    </div>
  );
}

function ToolRunBlock({ turns, room }: { turns: ChatTurn[]; room: MockRoom }) {
  const [open, setOpen] = useState(false);
  const peer = room.byId[turns[0]?.peerId ?? ''];
  const color = resolveParticipantColor(peer?.peerId ?? '');
  const errCount = turns.filter((t) => t.status === 'err').length;
  const okCount = turns.filter((t) => t.status === 'ok').length;
  const headline = turns[turns.length - 1]!;

  return (
    <div
      className="niuu-my-1 niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary"
      data-testid="tool-run"
    >
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
        <span className="niuu-font-mono niuu-text-text-muted">{truncate(headline.args, 40)}</span>
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
            <div
              key={t.id}
              className="niuu-flex niuu-items-start niuu-gap-2 niuu-py-1 niuu-text-xs"
            >
              <span className="niuu-font-mono niuu-text-text-secondary">{t.tool}</span>
              <span className="niuu-font-mono niuu-text-text-muted">{t.args}</span>
              {t.status === 'ok' && <span className="niuu-font-mono niuu-text-state-ok">ok</span>}
              {t.status === 'err' && <span className="niuu-font-mono niuu-text-critical">err</span>}
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
  const color = resolveParticipantColor(peer?.peerId ?? '');

  if (turn.role === 'user') {
    return (
      <div className="niuu-my-2 niuu-flex niuu-gap-3" data-testid="chat-turn-user">
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">you</span>
        <div className="niuu-flex-1">
          {turn.directedTo && turn.directedTo.length > 0 && (
            <div className="niuu-mb-1 niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
              directed {'\u2192'}{' '}
              {turn.directedTo.map((id) => (
                <span key={id} style={{ color: resolveParticipantColor(id) }}>
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
          <span>{'\u00b7'}</span>
          <span>{peer?.persona ?? ''}</span>
          {turn.tokens && (
            <>
              <span>{'\u00b7'}</span>
              <span>{turn.tokens}t</span>
            </>
          )}
          {turn.ms && (
            <>
              <span>{'\u00b7'}</span>
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

function ChatStream({ groups, room }: { groups: TurnGroup[]; room: MockRoom }) {
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
            return <ThinkingBlock key={i} turn={g.turn} peer={room.byId[g.turn.peerId]} />;
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

function MeshCascade({
  events,
  filter,
  setFilter,
}: {
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
          <div key={e.id} data-testid="cascade-event">
            <MeshEventCard event={e} />
          </div>
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
  const room = useMemo(() => (import.meta.env.DEV ? buildMockRoom(session) : null), [session]);
  const turns = useMemo(() => (room ? buildMockTurns(session, room) : []), [session, room]);
  const grouped = useMemo(() => groupTurns(turns), [turns]);
  const [focusPeer, setFocusPeer] = useState<string | null>(null);
  const [cascadeFilter, setCascadeFilter] = useState<CascadeFilterType>('all');

  const participantMap = useMemo(() => {
    const map = new Map<string, RoomParticipant>();
    if (!room) return map as ReadonlyMap<string, RoomParticipant>;
    for (const p of room.participants) {
      map.set(p.peerId, p);
    }
    return map as ReadonlyMap<string, RoomParticipant>;
  }, [room]);

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

  if (!room) {
    return (
      <div className="niuu-flex niuu-h-full niuu-items-center niuu-justify-center niuu-font-mono niuu-text-sm niuu-text-text-muted">
        Chat {'\u2014'} requires live connection
      </div>
    );
  }

  return (
    <div className="niuu-flex niuu-h-full" data-testid="chat-tab">
      <MeshSidebar
        participants={participantMap}
        selectedPeerId={focusPeer}
        onSelectPeer={(id) => setFocusPeer(focusPeer === id ? null : id)}
      />
      <ChatStream groups={filteredGroups} room={room} />
      <MeshCascade events={room.meshEvents} filter={cascadeFilter} setFilter={setCascadeFilter} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffsTab
// ---------------------------------------------------------------------------

interface MockDiffFile {
  path: string;
  status: 'new' | 'mod' | 'del';
  ins: number;
  del: number;
}

interface DiffHunkLine {
  type: 'add' | 'remove' | 'ctx';
  content: string;
  oldLine?: number;
  newLine?: number;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffHunkLine[];
}

const MOCK_DIFF_FILES: MockDiffFile[] = [
  { path: 'src/auth/handler.ts', status: 'mod', ins: 42, del: 8 },
  { path: 'src/auth/jwt.ts', status: 'new', ins: 96, del: 0 },
  { path: 'src/auth/legacy.ts', status: 'del', ins: 0, del: 34 },
];

function buildMockHunks(file: MockDiffFile): DiffHunk[] {
  if (file.status === 'del') {
    return [
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 0,
        newCount: 0,
        lines: [
          { type: 'remove', content: 'export class LegacyAuth {', oldLine: 1 },
          { type: 'remove', content: '  // deprecated — use AuthHandler', oldLine: 2 },
          { type: 'remove', content: '}', oldLine: 3 },
        ],
      },
    ];
  }
  if (file.status === 'new') {
    return [
      {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 4,
        lines: [
          { type: 'add', content: 'import { verify } from "jsonwebtoken";', newLine: 1 },
          { type: 'add', content: '', newLine: 2 },
          { type: 'add', content: 'export function validateJwt(token: string) {', newLine: 3 },
          { type: 'add', content: '  return verify(token, process.env.JWT_SECRET!);', newLine: 4 },
        ],
      },
    ];
  }
  return [
    {
      oldStart: 10,
      oldCount: 4,
      newStart: 10,
      newCount: 6,
      lines: [
        { type: 'ctx', content: 'export class AuthHandler {', oldLine: 10, newLine: 10 },
        { type: 'remove', content: '  validate(token: string): boolean {', oldLine: 11 },
        {
          type: 'add',
          content: '  async validate(token: string): Promise<boolean> {',
          newLine: 11,
        },
        { type: 'add', content: '    const claims = await validateJwt(token);', newLine: 12 },
        { type: 'ctx', content: '    return !!claims;', oldLine: 12, newLine: 13 },
        { type: 'ctx', content: '  }', oldLine: 13, newLine: 14 },
      ],
    },
  ];
}

function diffStatusLetter(status: MockDiffFile['status']): string {
  return status === 'new' ? 'A' : status === 'mod' ? 'M' : 'D';
}

function diffStatusColor(status: MockDiffFile['status']): string {
  return status === 'new'
    ? 'niuu-text-state-ok'
    : status === 'mod'
      ? 'niuu-text-state-warn'
      : 'niuu-text-critical';
}

function DiffFileList({
  files,
  selectedPath,
  onSelect,
}: {
  files: MockDiffFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div
      className="niuu-flex niuu-h-full niuu-flex-col niuu-overflow-auto"
      data-testid="diff-file-list"
    >
      {files.map((f) => (
        <button
          key={f.path}
          onClick={() => onSelect(f.path)}
          className={cn(
            'niuu-flex niuu-items-center niuu-gap-2 niuu-px-3 niuu-py-1.5 niuu-text-left niuu-text-xs hover:niuu-bg-bg-elevated',
            selectedPath === f.path && 'niuu-bg-bg-elevated',
          )}
          data-testid={`diff-file-${f.status}`}
        >
          <span
            className={cn(
              'niuu-w-4 niuu-flex-shrink-0 niuu-font-mono niuu-font-medium',
              diffStatusColor(f.status),
            )}
          >
            {diffStatusLetter(f.status)}
          </span>
          <span className="niuu-min-w-0 niuu-flex-1 niuu-truncate niuu-font-mono niuu-text-text-secondary">
            {f.path}
          </span>
          <span className="niuu-flex-shrink-0 niuu-font-mono niuu-text-[10px]">
            {f.ins > 0 && <span className="niuu-text-state-ok">+{f.ins}</span>}
            {f.del > 0 && <span className="niuu-ml-1 niuu-text-critical">-{f.del}</span>}
          </span>
        </button>
      ))}
      {files.length === 0 && (
        <div className="niuu-p-3 niuu-font-mono niuu-text-xs niuu-text-text-muted">
          no uncommitted changes
        </div>
      )}
    </div>
  );
}

function DiffViewer({ file }: { file: MockDiffFile }) {
  const hunks = buildMockHunks(file);
  return (
    <div
      className="niuu-flex niuu-h-full niuu-flex-col niuu-overflow-auto"
      data-testid="diff-viewer"
    >
      <div className="niuu-flex niuu-flex-shrink-0 niuu-items-center niuu-gap-2 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2">
        <span
          className={cn(
            'niuu-font-mono niuu-font-medium niuu-text-xs',
            diffStatusColor(file.status),
          )}
        >
          {diffStatusLetter(file.status)}
        </span>
        <span className="niuu-font-mono niuu-text-sm niuu-text-text-primary">{file.path}</span>
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
          {file.ins > 0 && <span className="niuu-text-state-ok">+{file.ins}</span>}
          {file.del > 0 && <span className="niuu-ml-1 niuu-text-critical">-{file.del}</span>}
        </span>
      </div>
      <div className="niuu-flex-1 niuu-overflow-auto niuu-bg-bg-primary">
        {hunks.map((hunk, i) => (
          <div key={i} className="niuu-font-mono niuu-text-xs">
            <div className="niuu-bg-bg-tertiary niuu-px-4 niuu-py-0.5 niuu-text-text-muted">
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </div>
            {hunk.lines.map((line, j) => (
              <div
                key={j}
                className={cn(
                  'niuu-flex niuu-gap-2 niuu-px-4 niuu-py-px',
                  line.type === 'add' &&
                    'niuu-bg-[color-mix(in_srgb,var(--color-accent-emerald)_8%,transparent)]',
                  line.type === 'remove' &&
                    'niuu-bg-[color-mix(in_srgb,var(--color-critical)_8%,transparent)]',
                )}
              >
                <span className="niuu-w-8 niuu-flex-shrink-0 niuu-select-none niuu-text-right niuu-text-text-faint">
                  {line.oldLine ?? ''}
                </span>
                <span className="niuu-w-8 niuu-flex-shrink-0 niuu-select-none niuu-text-right niuu-text-text-faint">
                  {line.newLine ?? ''}
                </span>
                <span
                  className={cn(
                    'niuu-w-3 niuu-flex-shrink-0 niuu-select-none',
                    line.type === 'add' && 'niuu-text-state-ok',
                    line.type === 'remove' && 'niuu-text-critical',
                    line.type === 'ctx' && 'niuu-text-text-faint',
                  )}
                >
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                <span className="niuu-text-text-primary">{line.content}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffsTab() {
  const [selectedPath, setSelectedPath] = useState<string | null>(MOCK_DIFF_FILES[0]?.path ?? null);
  const selectedFile = MOCK_DIFF_FILES.find((f) => f.path === selectedPath) ?? null;

  return (
    <div className="niuu-grid niuu-h-full niuu-grid-cols-[220px_1fr]" data-testid="diffs-tab">
      <div className="niuu-overflow-hidden niuu-border-r niuu-border-border-subtle niuu-bg-bg-secondary">
        <DiffFileList
          files={MOCK_DIFF_FILES}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
        />
      </div>
      <div className="niuu-overflow-hidden">
        {selectedFile ? (
          <DiffViewer file={selectedFile} />
        ) : (
          <div className="niuu-flex niuu-h-full niuu-items-center niuu-justify-center niuu-font-mono niuu-text-sm niuu-text-text-muted">
            select a file
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChronicleTab
// ---------------------------------------------------------------------------

type ChronicleEventType = 'session' | 'git' | 'file' | 'terminal' | 'message' | 'error';

interface ChronicleEvent {
  id: string;
  type: ChronicleEventType;
  label: string;
  ts: number;
  hash?: string;
  ins?: number;
  del?: number;
  exit?: number | null;
}

const CHRONICLE_TYPE_COLORS: Record<ChronicleEventType, string> = {
  session: 'niuu-text-brand',
  git: 'niuu-text-brand',
  file: 'niuu-text-brand',
  terminal: 'niuu-text-state-warn',
  message: 'niuu-text-text-muted',
  error: 'niuu-text-critical',
};

const CHRONICLE_TYPE_LABELS: Record<ChronicleEventType, string> = {
  session: 'SESSION',
  git: 'GIT',
  file: 'FILE',
  terminal: 'TERM',
  message: 'MSG',
  error: 'ERR',
};

function buildMockChronicle(): ChronicleEvent[] {
  const now = Date.now();
  return [
    {
      id: 'c-1',
      type: 'session',
      label: 'session started · workspace cloned',
      ts: now - 3_600_000,
    },
    { id: 'c-2', type: 'message', label: 'user: implement the auth handler', ts: now - 3_500_000 },
    { id: 'c-3', type: 'terminal', label: 'npm install', ts: now - 3_480_000, exit: 0 },
    {
      id: 'c-4',
      type: 'file',
      label: 'src/auth/handler.ts · initial implementation',
      ts: now - 3_400_000,
      ins: 42,
      del: 0,
    },
    {
      id: 'c-5',
      type: 'file',
      label: 'src/auth/jwt.ts · add JWT validation',
      ts: now - 3_380_000,
      ins: 96,
      del: 0,
    },
    { id: 'c-6', type: 'terminal', label: 'npm test', ts: now - 3_360_000, exit: 0 },
    {
      id: 'c-7',
      type: 'git',
      label: 'feat(auth): add JWT validation handler',
      ts: now - 3_340_000,
      hash: 'a1b2c3d',
    },
    { id: 'c-8', type: 'message', label: 'user: run the tests', ts: now - 2_400_000 },
    { id: 'c-9', type: 'terminal', label: 'npm test -- --coverage', ts: now - 2_380_000, exit: 0 },
    {
      id: 'c-10',
      type: 'git',
      label: 'test(auth): add coverage for jwt handler',
      ts: now - 2_340_000,
      hash: 'e4f5a6b',
    },
  ];
}

function ChronicleEventRow({ event }: { event: ChronicleEvent }) {
  const colorClass = CHRONICLE_TYPE_COLORS[event.type];
  const typeLabel = CHRONICLE_TYPE_LABELS[event.type];

  return (
    <li
      className="niuu-flex niuu-items-start niuu-gap-3 niuu-py-1.5"
      data-testid={`chronicle-event-${event.type}`}
    >
      <span className="niuu-mt-0.5 niuu-w-10 niuu-flex-shrink-0 niuu-font-mono niuu-text-[10px] niuu-text-text-faint">
        {relTime(event.ts)}
      </span>
      <span
        className={cn(
          'niuu-w-14 niuu-flex-shrink-0 niuu-font-mono niuu-text-[10px] niuu-font-medium',
          colorClass,
        )}
      >
        {typeLabel}
      </span>
      <span className="niuu-flex niuu-min-w-0 niuu-flex-1 niuu-flex-wrap niuu-items-center niuu-gap-x-2 niuu-text-xs">
        {event.type === 'git' && event.hash ? (
          <>
            <span className="niuu-font-mono niuu-text-text-muted">{event.hash.slice(0, 7)}</span>
            <span className="niuu-text-text-primary">{event.label.replace(/^.*·\s*/, '')}</span>
          </>
        ) : event.type === 'terminal' ? (
          <>
            <span className="niuu-font-mono niuu-text-text-secondary">$ {event.label}</span>
            {event.exit !== undefined && event.exit !== null && (
              <span
                className={cn(
                  'niuu-font-mono niuu-text-[10px]',
                  event.exit === 0 ? 'niuu-text-state-ok' : 'niuu-text-critical',
                )}
              >
                exit {event.exit}
              </span>
            )}
            {event.exit === null && (
              <span className="niuu-font-mono niuu-text-[10px] niuu-text-state-warn">running…</span>
            )}
          </>
        ) : event.type === 'file' ? (
          (() => {
            const [filePath, desc] = event.label.split(' · ');
            return (
              <>
                <span className="niuu-font-mono niuu-text-text-secondary">{filePath}</span>
                {desc && <span className="niuu-text-text-muted">{desc}</span>}
                {(event.ins !== undefined || event.del !== undefined) && (
                  <span className="niuu-font-mono niuu-text-[10px]">
                    {event.ins !== undefined && (
                      <span className="niuu-text-state-ok">+{event.ins}</span>
                    )}
                    {event.del !== undefined && (
                      <span className="niuu-ml-1 niuu-text-critical">-{event.del}</span>
                    )}
                  </span>
                )}
              </>
            );
          })()
        ) : (
          <span className="niuu-text-text-secondary">{event.label}</span>
        )}
      </span>
    </li>
  );
}

function ChronicleTab() {
  const events = buildMockChronicle();
  const commitCount = events.filter((e) => e.type === 'git' && e.hash).length;
  const termCount = events.filter((e) => e.type === 'terminal').length;
  const msgCount = events.filter((e) => e.type === 'message').length;
  const fileCount = new Set(
    events.filter((e) => e.type === 'file').map((e) => e.label.split(' · ')[0] ?? ''),
  ).size;

  return (
    <div
      className="niuu-flex niuu-h-full niuu-flex-col niuu-overflow-auto niuu-p-4"
      data-testid="chronicle-tab"
    >
      {/* Summary stats */}
      <div className="niuu-mb-4 niuu-flex niuu-gap-6" data-testid="chronicle-summary">
        {[
          { label: 'commits', value: commitCount },
          { label: 'files touched', value: fileCount },
          { label: 'shell runs', value: termCount },
          { label: 'messages', value: msgCount },
        ].map(({ label, value }) => (
          <div key={label} className="niuu-flex niuu-flex-col niuu-items-center niuu-gap-0.5">
            <span className="niuu-font-mono niuu-text-sm niuu-font-medium niuu-text-text-primary">
              {value}
            </span>
            <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-faint">{label}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="niuu-relative">
        {/* Vertical spine */}
        <div className="niuu-absolute niuu-bottom-0 niuu-left-[5.5rem] niuu-top-0 niuu-w-px niuu-bg-border-subtle" />
        <ol className="niuu-flex niuu-flex-col niuu-gap-0" data-testid="chronicle-timeline">
          {events.map((event) => (
            <ChronicleEventRow key={event.id} event={event} />
          ))}
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LogsTab
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogLine {
  id: string;
  ts: string;
  level: LogLevel;
  src: string;
  msg: string;
}

const LOG_LEVEL_CLASSES: Record<LogLevel, string> = {
  debug: 'niuu-text-text-faint',
  info: 'niuu-text-text-secondary',
  warn: 'niuu-text-state-warn',
  error: 'niuu-text-critical',
};

const MOCK_LOGS: LogLine[] = [
  { id: 'l-1', ts: '10:00:01', level: 'info', src: 'skuld', msg: 'session starting' },
  {
    id: 'l-2',
    ts: '10:00:02',
    level: 'info',
    src: 'skuld',
    msg: 'workspace cloned: niuulabs/volundr',
  },
  {
    id: 'l-3',
    ts: '10:00:05',
    level: 'debug',
    src: 'ravn',
    msg: 'model loaded: claude-sonnet-4-6',
  },
  { id: 'l-4', ts: '10:00:06', level: 'info', src: 'ravn', msg: 'mesh room joined: room-ds-1' },
  {
    id: 'l-5',
    ts: '10:01:14',
    level: 'info',
    src: 'ravn',
    msg: 'tool: read_file src/auth/handler.ts',
  },
  { id: 'l-6', ts: '10:01:15', level: 'debug', src: 'ravn', msg: 'tool ok · 45ms · 2.1kb' },
  {
    id: 'l-7',
    ts: '10:02:30',
    level: 'info',
    src: 'ravn',
    msg: 'tool: write_file src/auth/jwt.ts',
  },
  { id: 'l-8', ts: '10:02:31', level: 'debug', src: 'ravn', msg: 'tool ok · 12ms' },
  {
    id: 'l-9',
    ts: '10:04:00',
    level: 'warn',
    src: 'skuld',
    msg: 'cpu approaching limit: 1.8/2.0c',
  },
  { id: 'l-10', ts: '10:05:22', level: 'info', src: 'ravn', msg: 'tool: run_command npm test' },
  { id: 'l-11', ts: '10:05:23', level: 'debug', src: 'ravn', msg: 'exit 0 · 1.2s' },
  {
    id: 'l-12',
    ts: '10:06:00',
    level: 'info',
    src: 'skuld',
    msg: 'commit: feat(auth): add JWT validation handler',
  },
];

function LogsTab() {
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');

  const filtered =
    levelFilter === 'all' ? MOCK_LOGS : MOCK_LOGS.filter((l) => l.level === levelFilter);

  return (
    <div className="niuu-flex niuu-h-full niuu-flex-col" data-testid="logs-tab">
      {/* Filter bar */}
      <div className="niuu-flex niuu-flex-shrink-0 niuu-items-center niuu-gap-1 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2">
        {(['all', 'error', 'warn', 'info', 'debug'] as const).map((lvl) => (
          <button
            key={lvl}
            onClick={() => setLevelFilter(lvl)}
            className={cn(
              'niuu-rounded niuu-px-2 niuu-py-0.5 niuu-font-mono niuu-text-xs',
              levelFilter === lvl
                ? 'niuu-bg-bg-elevated niuu-text-brand'
                : 'niuu-text-text-muted hover:niuu-text-text-secondary',
            )}
            data-testid={`log-filter-${lvl}`}
          >
            {lvl}
          </button>
        ))}
      </div>

      {/* Log body */}
      <div
        className="niuu-flex-1 niuu-overflow-auto niuu-bg-bg-primary niuu-px-4 niuu-py-2"
        data-testid="logs-body"
      >
        {filtered.map((line) => (
          <div
            key={line.id}
            className="niuu-flex niuu-gap-3 niuu-py-px niuu-font-mono niuu-text-xs"
            data-testid={`log-line-${line.level}`}
          >
            <span className="niuu-w-14 niuu-flex-shrink-0 niuu-text-text-faint">{line.ts}</span>
            <span
              className={cn(
                'niuu-w-10 niuu-flex-shrink-0 niuu-font-medium niuu-uppercase',
                LOG_LEVEL_CLASSES[line.level],
              )}
            >
              {line.level}
            </span>
            <span className="niuu-w-12 niuu-flex-shrink-0 niuu-text-text-faint">{line.src}</span>
            <span className="niuu-text-text-primary">{line.msg}</span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="niuu-py-4 niuu-text-center niuu-text-text-muted">no log entries</div>
        )}
      </div>
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
          {activeTab === 'diffs' && <DiffsTab />}
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
                    loading files{'\u2026'}
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
          {activeTab === 'chronicle' && <ChronicleTab />}
        </div>

        {/* Logs */}
        <div
          role="tabpanel"
          aria-labelledby="tab-logs"
          hidden={activeTab !== 'logs'}
          className="niuu-h-full"
        >
          {activeTab === 'logs' && <LogsTab />}
        </div>
      </div>
    </div>
  );
}
