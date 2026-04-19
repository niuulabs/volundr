/* global React */
// ─── Völundr · Sessions ──────────────────────────────────────
// LEFT subnav is the pod list (handled by shell). This is the detail pane:
// chronicle tail · terminal · chat · diffs · files · logs — all tabbed.

const { useState: useSesS, useMemo: useSesM, useEffect: useSesE } = React;

// ─── peerColor ─────────────────────────────────────────────────
// All ravens share the brand ice-blue identity, but each is rendered
// with a slight lightness/chroma offset around --brand-500 so peers are
// visually distinguishable in the chat without turning into a Christmas
// tree. Human (peerId === 'human') stays on the neutral primary text so
// it reads as 'you' and never competes with the ravens.
//
// Offsets are deterministic per peerId via a tiny hash — colors stay
// stable across renders and sessions.
function peerHash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
function peerColor(peerId) {
  if (!peerId || peerId === 'human') return 'var(--color-text-primary)';
  // Brand anchor: oklch(0.78 0.12 230)  (≈ --brand-400 for ice theme)
  // We drift L in ±0.12 and C in ±0.03 so each raven sits in the same family.
  const h = peerHash(peerId);
  const dL = ((h & 0xff) / 255) * 0.24 - 0.12;       // -0.12 … +0.12
  const dC = (((h >> 8) & 0xff) / 255) * 0.06 - 0.03; // -0.03 … +0.03
  const L = Math.min(0.92, Math.max(0.58, 0.78 + dL)).toFixed(3);
  const C = Math.min(0.15, Math.max(0.06, 0.12 + dC)).toFixed(3);
  return `oklch(${L} ${C} 230)`;
}

function SessionsView({ ctx }) {
  const { selectedSession: s } = ctx;
  const [tab, setTab] = useSesS(() => localStorage.getItem('vol.ses.tab') || 'chat');
  useSesE(()=>localStorage.setItem('vol.ses.tab', tab), [tab]);

  if (!s) return <div className="v-page v-empty">no session selected</div>;

  return (
    <div className="v-page v-page-sessions">
      {/* ═══ HEADER ═══ */}
      <SessionHeader s={s} ctx={ctx}/>

      {/* ═══ TABS ═══ */}
      <div className="v-ses-tabs">
        {[
          { id:'chat',      label:'Chat',      icon: Icon.chat,      count: s.msgs },
          { id:'terminal',  label:'Terminal',  icon: Icon.term },
          { id:'diffs',     label:'Diffs',     icon: Icon.diff,      count: (s.diffStats||[]).length || (s.files?.added||0)+(s.files?.modified||0)+(s.files?.deleted||0) },
          { id:'files',     label:'Files',     icon: Icon.file },
          { id:'chronicle', label:'Chronicle', icon: Icon.chronicle, count: (s.chronicle||[]).length },
          { id:'logs',      label:'Logs',      icon: Icon.code },
        ].map(t => (
          <button key={t.id} className={`v-ses-tab ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
            <t.icon/> {t.label}
            {t.count!=null && t.count>0 && <span className="v-ses-tab-count mono">{t.count}</span>}
          </button>
        ))}
        <div className="v-ses-tabs-spacer"/>
        <SessionActions s={s}/>
      </div>

      {/* ═══ BODY ═══ */}
      <div className="v-ses-body">
        {tab === 'chat'      && <ChatTab s={s}/>}
        {tab === 'terminal'  && <TerminalTab s={s}/>}
        {tab === 'diffs'     && <DiffsTab s={s}/>}
        {tab === 'files'     && <FilesTab s={s}/>}
        {tab === 'chronicle' && <ChronicleTab s={s}/>}
        {tab === 'logs'      && <LogsTab s={s}/>}
      </div>
    </div>
  );
}

// ── HEADER ──
// Single compact line: status + name + context chips + stats. Primary
// actions (stop/archive/delete/res) live on the tabs row to save vertical
// space. Resources meters expand into a detail row on toggle.
function SessionHeader({ s, ctx }) {
  const [showRes, setShowRes] = useSesS(() => localStorage.getItem('vol.ses.res') === '1');
  useSesE(() => localStorage.setItem('vol.ses.res', showRes ? '1' : '0'), [showRes]);

  return (
    <header className="v-ses-head v-ses-head-compact">
      <div className="v-ses-head-oneline">
        <StatusPill status={s.status==='active' && s.activity==='idle' ? 'idle' : s.status} activity={s.activity} dotOnly/>
        <h1 className="v-ses-name mono">{s.name}</h1>
        <span className="v-ses-id mono faint">{s.id}</span>
        {s.issue && <a className="v-ses-issue mono" href="#">{s.issue}</a>}
        <span className="v-ses-divider"/>
        <SourceLabel source={s.source}/>
        <span className="v-ses-divider"/>
        <ClusterChip id={s.cluster}/>
        <div className="v-ses-spacer"/>
        <div className="v-ses-stats">
          <Stat label="uptime" value={s.duration} mono/>
          <Stat label="msgs"   value={s.msgs} mono/>
          <Stat label="tokens" value={window.VOL_ATOMS.tokens(s.tokensIn+s.tokensOut)} mono/>
          <Stat label="cost"   value={window.VOL_ATOMS.money(s.costCents)} mono/>
        </div>
      </div>

      {/* Resources row (collapsed by default) */}
      {showRes && s.cpu && (
        <div className="v-ses-meters">
          <MiniMeter label="cpu" used={s.cpu.used} limit={s.cpu.limit} unit="c"/>
          <MiniMeter label="mem" used={s.mem.used} limit={s.mem.limit} unit="g"/>
          {s.gpu && <MiniMeter label="gpu" used={s.gpu.used} limit={100} unit="%" gpu={s.gpu.kind}/>}
          <MiniMeter label="disk" used={s.diskMiB} limit={10240} unit="Mi"/>
          <div className="v-ses-meter-sep"/>
          <div className="v-ses-commitline">
            <span className="mono faint">files</span>
            <span className="mono"><span className="v-df-add">+{s.files.added}</span> <span className="v-df-mod">~{s.files.modified}</span> <span className="v-df-del">-{s.files.deleted}</span></span>
            <span className="mono faint"> · </span>
            <span className="mono faint">commits</span>
            <span className="mono">{s.commits}</span>
          </div>
        </div>
      )}
    </header>
  );
}

// Exposed so the tabs row can render the toggle + action buttons.
function SessionActions({ s }) {
  const [showRes, setShowRes] = useSesS(() => localStorage.getItem('vol.ses.res') === '1');
  useSesE(() => localStorage.setItem('vol.ses.res', showRes ? '1' : '0'), [showRes]);
  return (
    <div className="v-ses-actions">
      <button className={`v-btn v-btn-sm v-btn-ghost v-ses-res-toggle ${showRes?'active':''}`} onClick={()=>setShowRes(v=>!v)} title="resources">
        <Icon.cpu/> {showRes ? 'hide' : 'res'}
      </button>
      {s.status === 'active'
        ? <IconBtn title="stop"><Icon.stop/></IconBtn>
        : s.status === 'stopped'
        ? <IconBtn title="resume"><Icon.play/></IconBtn>
        : null}
      <IconBtn title="archive"><Icon.archive/></IconBtn>
      <IconBtn title="delete" danger><Icon.trash/></IconBtn>
    </div>
  );
}

function Stat({ label, value, mono }) {
  return (
    <div className="v-stat">
      <div className="v-stat-label">{label}</div>
      <div className={`v-stat-value ${mono?'mono':''}`}>{value}</div>
    </div>
  );
}

function MiniMeter({ label, used, limit, unit, gpu }) {
  const pct = Math.min(1, used/limit);
  const color = pct > 0.85 ? 'var(--color-critical)' : pct > 0.6 ? 'var(--brand-400)' : 'var(--brand-500)';
  return (
    <div className="v-ses-meter">
      <span className="v-ses-meter-label mono">{label}</span>
      <div className="v-ses-meter-bar"><div className="v-meter-fill" style={{width:`${(pct*100).toFixed(0)}%`,background:color}}/></div>
      <span className="v-ses-meter-num mono dim">{typeof used==='number' && used<10 ? used.toFixed(1) : used}<span className="op">/</span>{limit}{unit}</span>
      {gpu && <span className="v-ses-meter-kind mono dim">{gpu}</span>}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ═══ TAB: CHAT  (Skuld room · multi-agent mesh) ══════════
//
// Three-column layout mirrors the real Skuld broker shape:
//
//   ┌──────────────┬──────────────────────────────┬──────────────────┐
//   │ participants │ chat stream                  │ mesh cascade     │
//   │ (peer rail)  │ (ravn↔ravn + outcome cards)  │ (outcomes +      │
//   │              │                              │  delegations +   │
//   │              │                              │  notifications)  │
//   └──────────────┴──────────────────────────────┴──────────────────┘
//
// Every participant in a Skuld room is a `ParticipantMeta`:
//   peerId · persona · displayName · color · status ·
//   subscribesTo[] · emits[] · tools[]
//
// Every chat turn may carry an `---outcome---` block (parsed server-side
// into a parallel MeshOutcomeEvent) that we render inline as a verdict
// card. Delegations + notifications also flow through the cascade panel.
//
// This is the crown-jewel surface of Völundr: everything else (terminal,
// diffs, files, logs) is plumbing — this tab is where the mesh is visible.
function ChatTab({ s }) {
  const room = useSesM(() => mockRoom(s), [s.id]);
  const turns = useSesM(() => mockChat(s, room), [s.id, room]);
  const grouped = groupTurns(turns);
  const [focusPeer, setFocusPeer] = useSesS(null); // null = all peers
  const [cascadeFilter, setCascadeFilter] = useSesS('all'); // all | outcome | mesh_message | notification
  const [peerCollapsed, setPeerCollapsed] = useSesS(() => localStorage.getItem('vol.ses.peerCol') === '1');
  const [cascadeCollapsed, setCascadeCollapsed] = useSesS(() => localStorage.getItem('vol.ses.cascadeCol') === '1');
  useSesE(()=>localStorage.setItem('vol.ses.peerCol', peerCollapsed ? '1':'0'), [peerCollapsed]);
  useSesE(()=>localStorage.setItem('vol.ses.cascadeCol', cascadeCollapsed ? '1':'0'), [cascadeCollapsed]);

  const filteredGroups = useSesM(() => {
    if (!focusPeer) return grouped;
    return grouped
      .map(g => {
        if (g.kind === 'toolrun') {
          const t = g.turns.filter(x => x.peerId === focusPeer);
          return t.length ? { kind:'toolrun', turns:t } : null;
        }
        return g.turn.peerId === focusPeer ? g : null;
      })
      .filter(Boolean);
  }, [grouped, focusPeer]);

  const cls = `v-chat-room ${peerCollapsed?'peer-collapsed':''} ${cascadeCollapsed?'cascade-collapsed':''}`;
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredGroups.length]);
  return (
    <div className={cls}>
      <PeerRail room={room} focusPeer={focusPeer} setFocusPeer={setFocusPeer}
                collapsed={peerCollapsed} onToggleCollapsed={()=>setPeerCollapsed(v=>!v)}/>
      <div className="v-chat">
        <div className="v-chat-scroll" ref={scrollRef}>
          {filteredGroups.map((g, i) =>
            g.kind === 'toolrun' ? <ToolRun key={i} turns={g.turns} room={room}/>
            : g.kind === 'thinking' ? <ChatTurn key={i} t={g.turn} room={room} foldable/>
            : <ChatTurn key={i} t={g.turn} room={room}/>
          )}
          {filteredGroups.length === 0 && (
            <div className="v-empty mono dim">no messages from this participant yet</div>
          )}
        </div>
        <ChatInput s={s} room={room}/>
      </div>
      <MeshCascade room={room} events={room.meshEvents} filter={cascadeFilter} setFilter={setCascadeFilter}
                   collapsed={cascadeCollapsed} onToggleCollapsed={()=>setCascadeCollapsed(v=>!v)}/>
    </div>
  );
}

// ── PEER RAIL ──
// Left column: every participant in the Skuld room. For this session's
// focus ravn, expand subscribesTo / emits / tools inline — this is the
// mesh contract surface, otherwise hidden behind opaque event types.
function PeerRail({ room, focusPeer, setFocusPeer, collapsed, onToggleCollapsed }) {
  if (collapsed) {
    return (
      <div className="v-peer-rail v-peer-rail-collapsed">
        <button className="v-rail-collapse" onClick={onToggleCollapsed} title="expand participants">
          <Icon.chev/>
        </button>
        <div className="v-peer-rail-mini">
          {room.participants.map(p => (
            <button key={p.peerId}
                    className={`v-peer-mini ${focusPeer === p.peerId ? 'active':''}`}
                    onClick={() => setFocusPeer(focusPeer === p.peerId ? null : p.peerId)}
                    title={`${p.displayName} · ${p.persona} · ${p.status}`}>
              <span className="v-peer-avatar v-peer-avatar-sm" style={{'--peer':peerColor(p.peerId)}}>
                <span className="v-peer-avatar-glyph mono">{p.glyph}</span>
                <span className={`v-peer-avatar-ring v-peer-status-${p.status}`}/>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="v-peer-rail">
      <div className="v-peer-rail-head">
        <span className="eyebrow">participants</span>
        <span className="mono faint v-peer-count">{room.participants.length}</span>
        <div className="v-peer-rail-spacer"/>
        <button className="v-rail-collapse" onClick={onToggleCollapsed} title="collapse participants">
          <Icon.chevLeft/>
        </button>
      </div>
      <div className="v-peer-rail-list">
        {room.participants.map(p => (
          <PeerCard key={p.peerId} p={p}
                    active={focusPeer === p.peerId}
                    onToggle={() => setFocusPeer(focusPeer === p.peerId ? null : p.peerId)}/>
        ))}
      </div>
      <div className="v-peer-rail-foot mono faint">
        <span>room · </span><span>{room.roomId}</span>
      </div>
    </div>
  );
}

function PeerCard({ p, active, onToggle }) {
  const [open, setOpen] = useSesS(p.expanded ?? false);
  return (
    <div className={`v-peer-card ${active?'active':''} ${open?'open':''}`}>
      <div className="v-peer-card-main">
        <button className="v-peer-card-focus" onClick={onToggle} title={active?'show all':'filter chat to this participant'}>
          <span className="v-peer-avatar" style={{'--peer':peerColor(p.peerId)}}>
            <span className="v-peer-avatar-glyph mono">{p.glyph}</span>
            <span className={`v-peer-avatar-ring v-peer-status-${p.status}`}/>
          </span>
          <span className="v-peer-info">
            <span className="v-peer-name mono">{p.displayName}</span>
            <span className="v-peer-meta mono faint">
              <span className="v-peer-persona">{p.persona}</span>
              <span className="dotsep">·</span>
              <span className={`v-peer-status-text v-peer-status-${p.status}`}>{peerStatusLabel(p.status)}</span>
            </span>
          </span>
        </button>
        <button className="v-peer-card-expand" onClick={()=>setOpen(v=>!v)} title="show subscriptions · tools">
          {open ? <Icon.chevDown/> : <Icon.chev/>}
        </button>
      </div>
      {open && (
        <div className="v-peer-card-body">
          {p.subscribesTo?.length > 0 && (
            <div className="v-peer-kv">
              <span className="v-peer-kv-label eyebrow">subscribes</span>
              <div className="v-peer-kv-vals">
                {p.subscribesTo.map(sub => <span key={sub} className="v-peer-topic mono">↓ {sub}</span>)}
              </div>
            </div>
          )}
          {p.emits?.length > 0 && (
            <div className="v-peer-kv">
              <span className="v-peer-kv-label eyebrow">emits</span>
              <div className="v-peer-kv-vals">
                {p.emits.map(em => <span key={em} className="v-peer-topic v-peer-topic-emit mono">↑ {em}</span>)}
              </div>
            </div>
          )}
          {p.tools?.length > 0 && (
            <div className="v-peer-kv">
              <span className="v-peer-kv-label eyebrow">tools</span>
              <div className="v-peer-kv-vals">
                {p.tools.map(t => <span key={t} className="v-peer-tool mono">{t}</span>)}
              </div>
            </div>
          )}
          {p.gateway && (
            <div className="v-peer-kv">
              <span className="v-peer-kv-label eyebrow">gateway</span>
              <div className="v-peer-kv-vals">{renderGateway(p.gateway)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function peerStatusLabel(status) {
  return { idle:'idle', busy:'busy', thinking:'thinking', tool_executing:'tool', offline:'offline' }[status] || status;
}

// Format `bifrost://anthropic/claude-sonnet` → three breadcrumb segments.
// Matches the visual idiom of the other kv pills instead of dumping a URI.
function renderGateway(uri) {
  if (!uri) return null;
  const m = uri.match(/^([a-z0-9+.-]+):\/\/([^/]+)(?:\/(.+))?$/i);
  if (!m) return <span className="mono faint">{uri}</span>;
  const [, proto, vendor, model] = m;
  return (
    <div className="v-peer-gateway">
      <span className="v-peer-gw-seg v-peer-gw-proto mono">{proto}</span>
      <span className="v-peer-gw-sep">›</span>
      <span className="v-peer-gw-seg v-peer-gw-vendor mono">{vendor}</span>
      {model && <>
        <span className="v-peer-gw-sep">›</span>
        <span className="v-peer-gw-seg v-peer-gw-model mono">{model}</span>
      </>}
    </div>
  );
}

// ── MESH CASCADE ──
// Right column: outcome events, peer↔peer delegations, help-needed notifications.
// Read-only — this is the *event bus projection*, not a chat you type into.
function MeshCascade({ room, events, filter, setFilter, collapsed, onToggleCollapsed }) {
  if (collapsed) {
    const counts = {
      outcome: events.filter(e => e.type === 'outcome').length,
      mesh_message: events.filter(e => e.type === 'mesh_message').length,
      notification: events.filter(e => e.type === 'notification').length,
    };
    return (
      <div className="v-cascade v-cascade-collapsed">
        <button className="v-rail-collapse" onClick={onToggleCollapsed} title="expand outcomes">
          <Icon.chevLeft/>
        </button>
        <div className="v-cascade-mini mono faint">
          <div className="v-cascade-mini-row"><span>out</span><span className="mono">{counts.outcome}</span></div>
          <div className="v-cascade-mini-row"><span>msg</span><span className="mono">{counts.mesh_message}</span></div>
          <div className="v-cascade-mini-row"><span>ntf</span><span className="mono">{counts.notification}</span></div>
        </div>
      </div>
    );
  }
  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter);
  return (
    <div className="v-cascade">
      <div className="v-cascade-head">
        <span className="eyebrow">mesh cascade</span>
        <span className="mono faint v-cascade-count">{filtered.length}</span>
        <div className="v-peer-rail-spacer"/>
        <button className="v-rail-collapse" onClick={onToggleCollapsed} title="collapse outcomes">
          <Icon.chev/>
        </button>
      </div>
      <div className="v-cascade-filter mono">
        {[
          { id:'all',           label:'all' },
          { id:'outcome',       label:'outcomes' },
          { id:'mesh_message',  label:'delegations' },
          { id:'notification',  label:'notifs' },
        ].map(f => (
          <button key={f.id} className={`v-cascade-filter-btn ${filter===f.id?'active':''}`} onClick={()=>setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="v-cascade-scroll">
        {filtered.map(e => <CascadeEvent key={e.id} e={e} room={room}/>)}
        {filtered.length === 0 && <div className="v-empty mono dim tiny">no events</div>}
      </div>
    </div>
  );
}

function CascadeEvent({ e, room }) {
  const p = room.byId[e.participantId];
  const ts = new Date(e.timestamp);
  const tsLabel = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}:${String(ts.getSeconds()).padStart(2,'0')}`;

  if (e.type === 'outcome') {
    const verdictClass = { pass:'ok', verified:'ok', fail:'err', needs_changes:'warn', blocked:'err', conditional:'warn' }[e.verdict] || 'muted';
    return (
      <div className={`v-casc v-casc-outcome v-casc-${verdictClass}`}>
        <div className="v-casc-head">
          <span className="v-casc-kind mono">outcome</span>
          <span className="v-casc-time mono faint">{tsLabel}</span>
        </div>
        <div className="v-casc-body">
          <div className="v-casc-by">
            <span className="v-peer-dot-sm" style={{background:peerColor(p?.peerId)}}/>
            <span className="mono">{p?.displayName}</span>
            <span className="mono faint"> · </span>
            <span className="mono faint">{e.eventType}</span>
          </div>
          <div className={`v-casc-verdict v-casc-verdict-${verdictClass} mono`}>{e.verdict?.replace('_',' ')}</div>
          <div className="v-casc-summary">{e.summary}</div>
        </div>
      </div>
    );
  }
  if (e.type === 'mesh_message') {
    return (
      <div className="v-casc v-casc-msg">
        <div className="v-casc-head">
          <span className="v-casc-kind mono">{e.direction === 'delegate' ? 'delegate →' : '← receive'}</span>
          <span className="v-casc-time mono faint">{tsLabel}</span>
        </div>
        <div className="v-casc-body">
          <div className="v-casc-by">
            <span className="v-peer-dot-sm" style={{background:peerColor(p?.peerId)}}/>
            <span className="mono">{e.fromPersona}</span>
            <span className="mono faint"> · {e.eventType}</span>
          </div>
          <div className="v-casc-summary faint">{e.preview}</div>
        </div>
      </div>
    );
  }
  // notification
  const urgencyLabel = e.urgency >= 3 ? 'urgent' : e.urgency >= 2 ? 'help' : 'note';
  return (
    <div className={`v-casc v-casc-notif v-casc-urg-${e.urgency}`}>
      <div className="v-casc-head">
        <span className="v-casc-kind mono">{urgencyLabel}</span>
        <span className="v-casc-time mono faint">{tsLabel}</span>
      </div>
      <div className="v-casc-body">
        <div className="v-casc-by">
          <span className="v-peer-dot-sm" style={{background:peerColor(p?.peerId)}}/>
          <span className="mono">{p?.displayName}</span>
          <span className="mono faint"> · {e.notificationType}</span>
        </div>
        <div className="v-casc-summary">{e.summary}</div>
        {e.recommendation && <div className="v-casc-reco mono faint">→ {e.recommendation}</div>}
      </div>
    </div>
  );
}

function groupTurns(turns) {
  const out = [];
  let bucket = null;
  for (const t of turns) {
    if (t.role === 'tool') {
      // Bucket consecutive tool calls from the same peer; reset on peer change.
      if (!bucket || bucket.peerId !== t.peerId) {
        bucket = { kind:'toolrun', peerId:t.peerId, turns:[] };
        out.push(bucket);
      }
      bucket.turns.push(t);
    } else {
      bucket = null;
      if (t.role === 'thinking') out.push({ kind:'thinking', turn:t });
      else out.push({ kind:'single', turn:t });
    }
  }
  return out;
}

// Run of consecutive tool calls — summarised by default, expandable.
function ToolRun({ turns, room }) {
  const [open, setOpen] = useSesS(false);
  const errCount = turns.filter(t => t.status === 'err').length;
  const runCount = turns.filter(t => t.status === 'run').length;
  const okCount  = turns.filter(t => t.status === 'ok').length;
  const headline = turns[turns.length - 1];
  const p = room?.byId?.[turns[0]?.peerId];

  return (
    <div className={`v-toolrun ${open?'open':''}`} style={p?{'--peer':peerColor(p.peerId)}:undefined}>
      <button className="v-toolrun-head" onClick={()=>setOpen(v=>!v)}>
        <span className="v-toolrun-chev">{open ? <Icon.chevDown/> : <Icon.chev/>}</span>
        {p && (
          <span className="v-toolrun-peer mono" style={{color:peerColor(p.peerId)}}>
            <span className="v-toolrun-peer-glyph">{p.glyph}</span>
            <span className="v-toolrun-peer-name">{p.displayName}</span>
          </span>
        )}
        <span className="v-toolrun-count mono">{turns.length} {turns.length===1?'call':'calls'}</span>
        <span className="v-toolrun-dot"/>
        <span className="v-toolrun-tail mono">
          <span className="v-tool-name">{headline.tool}</span>
          <span className="v-tool-args faint">{truncate(headline.args, 48)}</span>
        </span>
        <div className="v-toolrun-summary mono">
          {okCount  > 0 && <span className="v-toolrun-tag ok">{okCount} ok</span>}
          {runCount > 0 && <span className="v-toolrun-tag run">{runCount} running</span>}
          {errCount > 0 && <span className="v-toolrun-tag err">{errCount} err</span>}
        </div>
      </button>
      {open && (
        <div className="v-toolrun-body">
          {turns.map((t, i) => <ChatTurn key={i} t={t} room={room}/>)}
        </div>
      )}
    </div>
  );
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n-1) + '…' : s;
}

function ChatTurn({ t, room, foldable }) {
  const p = room?.byId?.[t.peerId];
  if (t.role === 'user') {
    return (
      <div className="v-turn v-turn-user">
        <div className="v-turn-avatar mono">you</div>
        <div className="v-turn-body">
          {t.directedTo?.length > 0 && (
            <div className="v-turn-directed mono faint">
              <span className="eyebrow">directed →</span>
              {t.directedTo.map(id => {
                const tp = room?.byId?.[id];
                return <span key={id} className="v-turn-directed-chip" style={{'--peer':peerColor(tp?.peerId)}}>{tp?.displayName || id}</span>;
              })}
            </div>
          )}
          <div className="v-turn-msg">{t.content}</div>
        </div>
      </div>
    );
  }
  if (t.role === 'thinking') {
    return <ThinkingBlock t={t} p={p} foldable={foldable}/>;
  }
  if (t.role === 'tool') {
    return (
      <div className={`v-turn v-turn-tool v-turn-tool-${t.tool}`} style={p?{'--peer':peerColor(p.peerId)}:undefined}>
        <div className="v-tool-head">
          {p && <span className="v-tool-peer mono" style={{color:peerColor(p.peerId)}}>{p.glyph}</span>}
          <span className="v-tool-name mono">{t.tool}</span>
          <span className="v-tool-args mono faint">{t.args}</span>
          {t.status === 'ok'   && <span className="v-tool-status ok">ok</span>}
          {t.status === 'err'  && <span className="v-tool-status err">err</span>}
          {t.status === 'run'  && <span className="v-tool-status run">running</span>}
          <span className="mono faint v-tool-dur">{t.dur}</span>
        </div>
        {t.output && <pre className="v-tool-out mono">{t.output}</pre>}
      </div>
    );
  }
  // assistant turn — peer-attributed
  return (
    <div className="v-turn v-turn-assistant" style={p?{'--peer':peerColor(p.peerId)}:undefined}>
      <div className="v-turn-avatar v-peer-avatar" style={{'--peer':peerColor(p?.peerId) || 'var(--brand-500)'}}>
        <span className="v-peer-avatar-glyph mono">{p?.glyph || t.cli?.[0] || 'c'}</span>
      </div>
      <div className="v-turn-body">
        <div className="v-turn-meta mono faint">
          <span className="v-turn-who" style={{color:peerColor(p?.peerId)}}>{p?.displayName || t.cli}</span>
          <span className="dotsep">·</span>
          <span>{p?.persona || t.cli}</span>
          <span className="dotsep">·</span>
          <span>{t.tokens}t</span>
          <span className="dotsep">·</span>
          <span>{t.ms}ms</span>
        </div>
        <div className="v-turn-msg">{t.content}</div>
        {t.outcome && <OutcomeCard o={t.outcome} p={p}/>}
        {t.delegation && <DelegationInline d={t.delegation} room={room}/>}
      </div>
    </div>
  );
}

// Inline outcome card — this is the rendered `---outcome---` block that
// the agent emitted in its own message. Server also forwards a parallel
// MeshOutcomeEvent into the cascade, so readers see it in both places.
function OutcomeCard({ o, p }) {
  const verdictClass = { pass:'ok', verified:'ok', fail:'err', needs_changes:'warn', blocked:'err', conditional:'warn' }[o.verdict] || 'muted';
  return (
    <div className={`v-outcard v-outcard-${verdictClass}`}>
      <div className="v-outcard-head">
        <span className="v-outcard-badge mono">---outcome---</span>
        <span className={`v-outcard-verdict v-outcard-verdict-${verdictClass} mono`}>{o.verdict?.replace('_',' ')}</span>
        <span className="mono faint">{o.eventType}</span>
      </div>
      <div className="v-outcard-summary">{o.summary}</div>
      {o.fields && (
        <div className="v-outcard-fields">
          {Object.entries(o.fields).map(([k,v]) => (
            <div key={k} className="v-outcard-field">
              <span className="v-outcard-fk mono faint">{k}</span>
              <span className="v-outcard-fv mono">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
      {o.findings?.length > 0 && (
        <div className="v-outcard-findings">
          {o.findings.map((f, i) => (
            <div key={i} className={`v-outcard-finding v-outcard-finding-${f.severity}`}>
              <span className={`v-outcard-sev mono v-outcard-sev-${f.severity}`}>{f.severity}</span>
              <span className="v-outcard-floc mono faint">{f.loc}</span>
              <span className="v-outcard-fmsg">{f.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline delegation — assistant turn emits `code.changed` etc that routes
// to another peer's subscription. Show as a small chip pointing to the
// receiver.
function DelegationInline({ d, room }) {
  const to = room?.byId?.[d.toPeerId];
  return (
    <div className="v-turn-delegate">
      <span className="eyebrow">delegates</span>
      <span className="mono">{d.eventType}</span>
      <span className="mono faint">→</span>
      <span className="v-turn-delegate-to mono" style={{'--peer':to?.color}}>{to?.displayName || d.toPeerId}</span>
    </div>
  );
}

// Thinking block — collapsed by default, shows single-line summary on the
// collapsed state so the reasoning stays present without dominating.
function ThinkingBlock({ t, p }) {
  const [open, setOpen] = useSesS(false);
  const firstLine = (t.content || '').split('\n')[0];
  return (
    <div className={`v-turn v-turn-thinking ${open?'open':''}`} style={p?{'--peer':peerColor(p.peerId)}:undefined}>
      <button className="v-think-head" onClick={()=>setOpen(v=>!v)}>
        <span className="v-think-chev">{open ? <Icon.chevDown/> : <Icon.chev/>}</span>
        {p && <span className="v-think-peer mono" style={{color:peerColor(p.peerId)}}>{p.glyph}</span>}
        <span className="v-think-label mono">thinking</span>
        <span className="v-think-dur mono faint">{t.ms}ms</span>
        {!open && <span className="v-think-preview faint">{truncate(firstLine, 96)}</span>}
      </button>
      {open && <div className="v-turn-thought mono">{t.content}</div>}
    </div>
  );
}

function ChatInput({ s, room }) {
  const [directed, setDirected] = useSesS([]);
  const toggle = (id) => setDirected(d => d.includes(id) ? d.filter(x=>x!==id) : [...d, id]);
  if (s.status !== 'active') {
    return (
      <div className="v-chat-input v-chat-input-disabled">
        <span className="mono dim">pod {s.status} — resume to send a message</span>
      </div>
    );
  }
  return (
    <div className="v-chat-input">
      {room?.participants && (
        <div className="v-chat-directed mono faint">
          <span className="eyebrow">direct to</span>
          {room.participants.filter(p => p.persona !== 'human').map(p => (
            <button key={p.peerId}
                    className={`v-chat-directed-chip ${directed.includes(p.peerId)?'active':''}`}
                    style={{'--peer':peerColor(p.peerId)}}
                    onClick={() => toggle(p.peerId)}>
              <span className="v-peer-dot-sm" style={{background:peerColor(p.peerId)}}/>
              <span>{p.displayName}</span>
            </button>
          ))}
          {directed.length === 0 && <span className="dim tiny">(broadcast · all participants receive)</span>}
        </div>
      )}
      <textarea placeholder={directed.length ? `message ${directed.length} participant${directed.length>1?'s':''}…  (⌘↵ send)` : `broadcast to room…  (⌘↵ send · / commands · @ mention files)`} rows={2}/>
      <div className="v-chat-input-foot">
        <div className="v-chat-tools">
          <button className="v-chat-tool mono" title="mention a file">@</button>
          <button className="v-chat-tool mono" title="slash command">/</button>
          <button className="v-chat-tool mono" title="attach">📎</button>
          <span className="v-chat-tool-sep"/>
          <span className="mono dim">permission:</span>
          <select className="v-chat-perm mono">
            <option>restricted</option><option>normal</option><option>yolo</option>
          </select>
        </div>
        <button className="v-btn v-btn-primary v-btn-sm">send <span className="v-kbd">⌘↵</span></button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ═══ TAB: TERMINAL ═══════════════════════════════════════
function TerminalTab({ s }) {
  const [activeShell, setActiveShell] = useSesS('main');
  const shells = [
    { id:'main',  label:'main',  restricted:false },
    { id:'tests', label:'tests', restricted:false },
    { id:'view',  label:'view',  restricted:true },
  ];
  return (
    <div className="v-term-wrap">
      <div className="v-term-tabs">
        {shells.map(sh => (
          <button key={sh.id} className={`v-term-tab ${activeShell===sh.id?'active':''}`} onClick={()=>setActiveShell(sh.id)}>
            <Icon.term/>
            <span className="mono">{sh.label}</span>
            {sh.restricted && <span className="v-term-lock mono" title="read-only shell">ro</span>}
          </button>
        ))}
        <button className="v-term-tab-add mono" title="new shell"><Icon.plus/></button>
        <div className="v-term-tab-spacer"/>
        <span className="mono dim tiny">volundr-sh@{s.id}</span>
      </div>
      <div className="v-term">
        <TerminalContent shell={activeShell} s={s}/>
      </div>
    </div>
  );
}

function TerminalContent({ shell, s }) {
  const lines = mockTerminal(s, shell);
  return (
    <pre className="v-term-lines mono">
      {lines.map((l,i) => (
        <div key={i} className={`v-term-line ${l.type||''}`}>
          {l.prompt && <span className="v-term-prompt">{l.prompt}</span>}
          {l.text}
        </div>
      ))}
      <div className="v-term-cursor-line">
        <span className="v-term-prompt">workspace $</span><span className="v-term-cursor"/>
      </div>
    </pre>
  );
}

// ════════════════════════════════════════════════════════
// ═══ TAB: DIFFS ═══════════════════════════════════════════
function DiffsTab({ s }) {
  const [base, setBase] = useSesS('last-commit');
  const [file, setFile] = useSesS(() => (s.diffStats?.[0]?.path) || null);
  const stats = s.diffStats || [];
  const sel = stats.find(f => f.path === file) || stats[0];

  return (
    <div className="v-diffs">
      <div className="v-diffs-left">
        <div className="v-diffs-base">
          <Segment value={base} onChange={setBase} options={[
            { value:'last-commit',   label:'last commit' },
            { value:'default-branch', label:'vs main' },
          ]}/>
        </div>
        <div className="v-diffs-filelist">
          {stats.map(f => (
            <button key={f.path} className={`v-diff-file ${file===f.path?'active':''}`} onClick={()=>setFile(f.path)}>
              <span className={`v-diff-status v-diff-${f.status}`}>{f.status==='new'?'A':f.status==='mod'?'M':f.status==='del'?'D':'?'}</span>
              <span className="mono v-diff-path">{f.path}</span>
              <span className="mono tiny">
                {f.ins ? <span className="v-df-add">+{f.ins}</span> : null}
                {f.del ? <span className="v-df-del"> -{f.del}</span> : null}
              </span>
            </button>
          ))}
          {stats.length === 0 && <div className="v-empty mono dim">no uncommitted changes</div>}
        </div>
      </div>
      <div className="v-diffs-right">
        {sel ? <DiffView file={sel}/> : <div className="v-empty mono dim">select a file</div>}
      </div>
    </div>
  );
}

function DiffView({ file }) {
  const hunks = mockDiff(file);
  return (
    <div className="v-diffview">
      <div className="v-diffview-head">
        <span className={`v-diff-status v-diff-${file.status}`}>{file.status==='new'?'A':file.status==='mod'?'M':'D'}</span>
        <span className="mono">{file.path}</span>
        <span className="mono dim">· +{file.ins} −{file.del}</span>
        <div className="v-diffview-actions">
          <button className="v-btn v-btn-sm v-btn-ghost mono">revert</button>
          <button className="v-btn v-btn-sm v-btn-ghost mono">stage</button>
        </div>
      </div>
      <div className="v-diff-body">
        {hunks.map((h, i) => (
          <div key={i} className="v-diff-hunk">
            <div className="v-diff-hunk-head mono">@@ -{h.oldStart},{h.oldCount} +{h.newStart},{h.newCount} @@ {h.label}</div>
            {h.lines.map((l, j) => (
              <div key={j} className={`v-diff-line v-diff-line-${l.type}`}>
                <span className="v-diff-ln mono">{l.oldLine || ''}</span>
                <span className="v-diff-ln mono">{l.newLine || ''}</span>
                <span className="v-diff-mark mono">{l.type==='add'?'+':l.type==='remove'?'−':' '}</span>
                <span className="v-diff-code mono">{l.content}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ═══ TAB: FILES ═══════════════════════════════════════════
function FilesTab({ s }) {
  const tree = mockTree(s);
  return (
    <div className="v-files">
      <div className="v-files-left">
        <div className="v-files-head">
          <span className="mono dim">workspace · /workspace</span>
          <IconBtn title="refresh"><Icon.refresh/></IconBtn>
        </div>
        <div className="v-files-tree mono">
          {tree.map((n, i) => <FileNode key={i} n={n}/>)}
        </div>
      </div>
      <div className="v-files-right">
        <div className="v-files-preview">
          <div className="v-files-preview-head mono">
            <Icon.file/> <span>observatory.jsx</span>
            <span className="dim">· 12.4 KiB · modified 22m ago</span>
          </div>
          <pre className="v-files-preview-code mono">{`/* global React */
// ─── Observatory canvas · quadtree cull patch ─────
function buildQuadtree(entities) {
  const root = new QuadNode(-INF, -INF, INF, INF);
  for (const e of entities) root.insert(e);
  return root;
}

function visible(tree, viewBox, zoom) {
  const bucket = [];
  tree.query(viewBox, bucket);
  // cull below zoom-dependent size threshold
  return bucket.filter(e => e.r * zoom > 0.6);
}
...`}</pre>
        </div>
      </div>
    </div>
  );
}

function FileNode({ n, depth=0 }) {
  const [open, setOpen] = useSesS(n.open ?? (depth < 1));
  if (n.kind === 'dir') {
    return (
      <div>
        <div className="v-file-row" style={{paddingLeft: 8 + depth*12}} onClick={()=>setOpen(!open)}>
          <span className="v-file-chev">{open ? <Icon.chevDown/> : <Icon.chev/>}</span>
          <span className="v-file-dir">{n.name}/</span>
        </div>
        {open && n.children?.map((c, i) => <FileNode key={i} n={c} depth={depth+1}/>)}
      </div>
    );
  }
  return (
    <div className={`v-file-row v-file-leaf ${n.active?'active':''}`} style={{paddingLeft: 8 + depth*12}}>
      <span className={`v-file-status v-file-${n.status||'none'}`}/>
      <span>{n.name}</span>
      {n.size && <span className="v-file-size dim">{n.size}</span>}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ═══ TAB: CHRONICLE ═════════════════════════════════════
// Commit-anchored chapters. Events are grouped by the commit they preceded;
// each commit forms a "chapter" with its own header. Events before the first
// commit become the "prologue"; events after the last commit become the
// "tail". The spine is commits — because in an engineering session, commits
// ARE the narrative.
function ChronicleTab({ s }) {
  const events = s.chronicle || mockChronicle(s);
  const chapters = useSesM(() => buildChapters(events), [events]);
  const totalSpan = events.length ? events[events.length-1].t - events[0].t : 0;
  const commitCount = chapters.filter(c => c.kind === 'commit').length;
  const fileCount   = new Set(events.filter(e=>e.type==='file').map(e=>e.label.split(' ')[0])).size;
  const termCount   = events.filter(e=>e.type==='terminal').length;
  const msgCount    = events.filter(e=>e.type==='message').length;
  return (
    <div className="v-chron2">
      <div className="v-chron2-summary">
        <div className="v-chron2-stat">
          <div className="v-chron2-stat-v mono">{commitCount}</div>
          <div className="v-chron2-stat-l mono tiny faint">commits</div>
        </div>
        <div className="v-chron2-stat">
          <div className="v-chron2-stat-v mono">{fileCount}</div>
          <div className="v-chron2-stat-l mono tiny faint">files touched</div>
        </div>
        <div className="v-chron2-stat">
          <div className="v-chron2-stat-v mono">{termCount}</div>
          <div className="v-chron2-stat-l mono tiny faint">shell runs</div>
        </div>
        <div className="v-chron2-stat">
          <div className="v-chron2-stat-v mono">{msgCount}</div>
          <div className="v-chron2-stat-l mono tiny faint">messages</div>
        </div>
        <div className="v-chron2-stat">
          <div className="v-chron2-stat-v mono">{fmtSpan(totalSpan)}</div>
          <div className="v-chron2-stat-l mono tiny faint">total span</div>
        </div>
      </div>
      <ol className="v-chron2-chapters">
        {chapters.map((c, i) => <Chapter key={i} chapter={c} index={i} total={chapters.length}/>)}
      </ol>
    </div>
  );
}

// Walk events and partition into chapters. Each chapter groups events UP TO
// and including a commit (the commit "caps" the chapter). Trailing events
// after the last commit become a single "tail" chapter.
function buildChapters(events) {
  const chapters = [];
  let cur = [];
  for (const e of events) {
    cur.push(e);
    if (e.type === 'git' && e.hash) {
      chapters.push({ kind:'commit', commit: e, events: cur });
      cur = [];
    }
  }
  // Remaining events after last commit
  if (cur.length) chapters.push({ kind:'tail', commit: null, events: cur });
  // The very first chapter often starts with session/clone setup — relabel.
  if (chapters[0] && chapters[0].kind === 'commit' && chapters[0].events[0]?.type === 'session') {
    chapters[0].hasPrologue = true;
  }
  return chapters;
}

function Chapter({ chapter, index, total }) {
  const [open, setOpen] = useSesS(true);
  const { commit, events, kind } = chapter;
  const body = events.filter(e => e !== commit); // events that led here
  const start = events[0].t;
  const end   = events[events.length-1].t;
  const span  = end - start;
  const isCommit = kind === 'commit';
  const isLast = index === total - 1;

  return (
    <li className={`v-chron2-chapter ${isCommit?'is-commit':'is-tail'} ${open?'open':''} ${isLast?'is-last':''}`}>
      <div className="v-chron2-spine">
        <div className="v-chron2-spine-dot"/>
        {!isLast && <div className="v-chron2-spine-line"/>}
      </div>
      <div className="v-chron2-chapter-body">
        <button className="v-chron2-chapter-head" onClick={()=>setOpen(v=>!v)}>
          <span className="v-chron2-chev">{open ? <Icon.chevDown/> : <Icon.chev/>}</span>
          <span className="v-chron2-chapter-num mono tiny faint">
            {isCommit ? `ch. ${String(index+1).padStart(2,'0')}` : `tail`}
          </span>
          {isCommit ? (
            <>
              <span className="v-chron2-hash mono">{commit.hash.slice(0,7)}</span>
              <span className="v-chron2-title">{stripCommitPrefix(commit.label)}</span>
            </>
          ) : (
            <span className="v-chron2-title dim">in progress — {events.length} event{events.length===1?'':'s'} since last commit</span>
          )}
          <span className="v-chron2-head-spacer"/>
          <span className="v-chron2-meta mono tiny faint">
            {window.VOL_ATOMS.relTime(end).replace(' ago',' ago')}
            <span className="dotsep">·</span>
            {fmtSpan(span)}
            <span className="dotsep">·</span>
            {events.length} event{events.length===1?'':'s'}
          </span>
        </button>
        {open && (
          <div className="v-chron2-chapter-inner">
            {body.length > 0 && (
              <ol className="v-chron2-events">
                {body.map((e, i) => <ChronEvent key={i} e={e}/>)}
              </ol>
            )}
            {isCommit && body.length === 0 && (
              <div className="v-chron2-bare mono tiny dim">— direct commit · no preceding events —</div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// A single event inside a chapter. Compact row: time · type badge · body.
function ChronEvent({ e }) {
  const typeMeta = EVENT_META[e.type] || { icon: Icon.chronicle, color:'var(--color-text-muted)', label:e.type };
  const relT = window.VOL_ATOMS.relTime(e.t).replace(' ago','');
  return (
    <li className={`v-chron2-event v-chron2-event-${e.type}`}>
      <span className="v-chron2-event-time mono tiny faint">{relT}</span>
      <span className="v-chron2-event-kind mono tiny" style={{color:typeMeta.color}}>
        <span className="v-chron2-event-icon"><typeMeta.icon/></span>
        <span className="v-chron2-event-label">{typeMeta.label}</span>
      </span>
      <span className="v-chron2-event-body">
        {renderEventBody(e)}
      </span>
    </li>
  );
}

// Per-type body rendering — each kind gets its own idiom so the view reads
// like a narrative rather than a homogenous log.
function renderEventBody(e) {
  if (e.type === 'file') {
    // e.label like "observatory.jsx · added quadtree cull"
    const [path, ...rest] = e.label.split(' · ');
    const note = rest.join(' · ');
    return (
      <>
        <span className="v-chron2-path mono">{path}</span>
        {note && <span className="v-chron2-note"> {note}</span>}
        {(e.ins!=null || e.del!=null) && (
          <span className="v-chron2-diff mono tiny">
            {e.ins!=null && <span className="v-df-add">+{e.ins}</span>}
            {e.del!=null && <span className="v-df-del">−{e.del}</span>}
          </span>
        )}
      </>
    );
  }
  if (e.type === 'terminal') {
    return (
      <>
        <span className="v-chron2-cmd mono">$ {e.label}</span>
        {e.exit != null && (
          <span className={`v-chron2-exit mono tiny ${e.exit===0?'ok':'err'}`}>
            exit {e.exit}
          </span>
        )}
        {e.exit === null && <span className="v-chron2-exit mono tiny running">running…</span>}
      </>
    );
  }
  if (e.type === 'message') {
    // e.label like "user: the drag lags on 400-entity graphs"
    const m = e.label.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      const [_, who, body] = m;
      return (
        <>
          <span className="v-chron2-who mono tiny">{who}</span>
          <span className="v-chron2-msg">{truncate(body, 140)}</span>
          {e.tokens && <span className="mono tiny faint"> · {e.tokens}t</span>}
        </>
      );
    }
    return <span>{e.label}</span>;
  }
  if (e.type === 'session') {
    return <span className="v-chron2-session mono tiny">{e.label}</span>;
  }
  if (e.type === 'git' && !e.hash) {
    return <span>{e.label}</span>;
  }
  return <span>{e.label}</span>;
}

function stripCommitPrefix(label) {
  // Incoming "commit · perf: quadtree cull @ 60fps" → "perf: quadtree cull @ 60fps"
  return label.replace(/^commit\s*·\s*/i, '').replace(/^commit\s+/i, '');
}

function fmtSpan(ms) {
  if (ms < 60_000) return `${Math.round(ms/1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms/60_000)}m`;
  const h = Math.floor(ms/3600_000);
  const m = Math.round((ms % 3600_000) / 60_000);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const EVENT_META = {
  session:  { icon: Icon.spark, color:'var(--brand-300)',       label:'SESSION' },
  git:      { icon: Icon.git,   color:'var(--brand-400)',       label:'GIT'     },
  file:     { icon: Icon.file,  color:'var(--brand-400)',       label:'FILE'    },
  message:  { icon: Icon.chat,  color:'var(--color-text-muted)',label:'MSG'     },
  terminal: { icon: Icon.term,  color:'var(--brand-500)',       label:'TERM'    },
  error:    { icon: Icon.x,     color:'var(--color-critical)',  label:'ERR'     },
};

// ════════════════════════════════════════════════════════
// ═══ TAB: LOGS ═══════════════════════════════════════════
function LogsTab({ s }) {
  const logs = mockLogs(s);
  return (
    <div className="v-logs">
      <div className="v-logs-filters">
        <Segment value="all" onChange={()=>{}} options={[
          { value:'all',   label:'all',   count:logs.length },
          { value:'error', label:'error' },
          { value:'warn',  label:'warn' },
          { value:'info',  label:'info' },
          { value:'debug', label:'debug' },
        ]}/>
        <div className="v-logs-search">
          <Icon.search/>
          <input className="mono" placeholder="filter…"/>
        </div>
      </div>
      <div className="v-logs-body mono">
        {logs.map((l,i) => (
          <div key={i} className={`v-log-row v-log-${l.level}`}>
            <span className="v-log-t dim">{l.t}</span>
            <span className="v-log-lvl">{l.level}</span>
            <span className="v-log-src dim">{l.src}</span>
            <span className="v-log-msg">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// ═══ MOCKS ══════════════════════════════════════════════

// ── mockRoom: Skuld room participants + mesh events ──
// Mirrors the real `ParticipantMeta` + `MeshEvent` shapes from
// useSkuldChat.ts so the UI maps 1:1 onto the transport.
function mockRoom(s) {
  if (s.name.includes('observatory-canvas-perf')) {
    const participants = [
      { peerId:'human',    persona:'human',    displayName:'mk',        glyph:'m', color:'var(--color-text-primary)', status:'idle',
        subscribesTo:[], emits:[], tools:[] },
      { peerId:'ravn-author',   persona:'author',    displayName:'Huginn',   glyph:'ᚺ', color:'var(--brand-400)', status:'tool_executing',
        subscribesTo:['user.request','review.needs_changes','verify.failed'],
        emits:['code.changed','plan.drafted','outcome'],
        tools:['read','grep','write','apply_patch','run','git.commit','git.push'],
        gateway:'bifrost://anthropic/claude-sonnet' },
      { peerId:'ravn-reviewer', persona:'reviewer',  displayName:'Muninn',   glyph:'ᛗ', color:'var(--brand-400)', status:'thinking',
        subscribesTo:['code.changed','pr.opened'],
        emits:['review.passed','review.needs_changes','review.failed','outcome'],
        tools:['read','grep','diff'],
        gateway:'bifrost://anthropic/claude-opus' },
      { peerId:'ravn-verifier', persona:'verifier',  displayName:'Heimdallr', glyph:'ᚾ', color:'var(--brand-400)', status:'idle',
        subscribesTo:['code.changed','test.needed'],
        emits:['verify.passed','verify.failed','verify.conditional','outcome','notification'],
        tools:['run','browser','screenshot','read'],
        gateway:'bifrost://openai/gpt-5' },
      { peerId:'ravn-security', persona:'security',  displayName:'Forseti',  glyph:'ᚠ', color:'var(--brand-400)', status:'idle',
        subscribesTo:['code.changed','pr.opened'],
        emits:['security.approved','security.changes_requested','outcome','notification'],
        tools:['read','grep','sast'],
        gateway:'bifrost://anthropic/claude-sonnet' },
      { peerId:'ravn-docs',     persona:'documenter', displayName:'Bragi',   glyph:'ᛒ', color:'var(--brand-400)', status:'idle',
        subscribesTo:['code.changed'],
        emits:['docs.drafted','outcome'],
        tools:['read','write'],
        gateway:'bifrost://anthropic/claude-haiku' },
    ];
    const byId = Object.fromEntries(participants.map(p => [p.peerId, p]));
    const t0 = Date.now() - 90*60*1000;
    const meshEvents = [
      { id:'me-1', type:'mesh_message', timestamp:t0+2*60*1000, participantId:'ravn-author',
        fromPersona:'author', eventType:'plan.drafted', direction:'delegate', preview:'quadtree cull + rAF throttle — implementing now' },
      { id:'me-2', type:'mesh_message', timestamp:t0+9*60*1000, participantId:'ravn-author',
        fromPersona:'author', eventType:'code.changed', direction:'delegate', preview:'observatory.jsx · canvas/quadtree.js · +310 −42 · 3 files' },
      { id:'me-3', type:'outcome', timestamp:t0+12*60*1000, participantId:'ravn-verifier',
        persona:'verifier', eventType:'verify.passed',
        verdict:'verified', summary:'jest observatory.perf — frame time 18ms → 6ms, 58/59 passing',
        fields:{ checks_passed:58, checks_failed:1, frame_time:'6ms' } },
      { id:'me-4', type:'outcome', timestamp:t0+14*60*1000, participantId:'ravn-reviewer',
        persona:'reviewer', eventType:'review.needs_changes',
        verdict:'needs_changes', summary:'2 majors · quadtree leaks on entity delete · a11y regression on pan',
        fields:{ findings_count:4, critical_count:0, major_count:2 } },
      { id:'me-5', type:'mesh_message', timestamp:t0+15*60*1000, participantId:'ravn-author',
        fromPersona:'reviewer', eventType:'review.needs_changes', direction:'receive', preview:'→ back to author for 2 fixes' },
      { id:'me-6', type:'notification', timestamp:t0+18*60*1000, participantId:'ravn-verifier',
        notificationType:'help_needed', persona:'verifier', urgency:2,
        reason:'a11y test flapping between runs',
        summary:'observatory.a11y.test.jsx · 1 failing, 2 retries recovered',
        recommendation:'human to confirm aria-live pan announcement is in-spec' },
      { id:'me-7', type:'outcome', timestamp:t0+22*60*1000, participantId:'ravn-security',
        persona:'security', eventType:'security.approved',
        verdict:'pass', summary:'no new sinks · no dep changes · diff within allow-list',
        fields:{ sast_findings:0, deps_changed:0 } },
      { id:'me-8', type:'mesh_message', timestamp:t0+40*60*1000, participantId:'ravn-author',
        fromPersona:'author', eventType:'code.changed', direction:'delegate', preview:'fix: quadtree dispose on entity remove · +34 −18' },
      { id:'me-9', type:'outcome', timestamp:t0+46*60*1000, participantId:'ravn-reviewer',
        persona:'reviewer', eventType:'review.passed',
        verdict:'pass', summary:'ship it · quadtree dispose verified · a11y deferred to separate issue',
        fields:{ findings_count:0, lgtm:true } },
    ];
    return { roomId:'raid-obs-q1', participants, byId, meshEvents };
  }
  // Default minimal room
  const participants = [
    { peerId:'human',  persona:'human',   displayName:'mk',      glyph:'m', color:'var(--color-text-primary)', status:'idle',
      subscribesTo:[], emits:[], tools:[] },
    { peerId:'ravn-author', persona:'author', displayName:'Huginn', glyph:'ᚺ', color:'var(--brand-400)', status: s.activity === 'tool_executing' ? 'tool_executing' : s.activity === 'active' ? 'thinking' : 'idle',
      subscribesTo:['user.request'], emits:['code.changed','outcome'],
      tools:['read','grep','write','run'],
      gateway:`bifrost://anthropic/${s.model||'claude-sonnet'}` },
  ];
  const byId = Object.fromEntries(participants.map(p => [p.peerId, p]));
  return { roomId:`room-${s.id}`, participants, byId, meshEvents:[] };
}

function mockChat(s, room) {
  // Tailor a short realistic chat to the session
  if (s.name.includes('observatory-canvas-perf')) {
    return [
      { role:'user', peerId:'human', content:'the drag lags on 400-entity graphs. can you find the hot path and fix it?' },
      { role:'thinking', peerId:'ravn-author', ms:1850, content:'Looking at observatory.jsx render loop. The full-entity redraw on every pointermove is O(n). A quadtree + viewport cull would cut it to O(k) where k = visible. Let me check current draw path.' },
      { role:'tool', peerId:'ravn-author', tool:'read', args:'observatory.jsx', status:'ok', dur:'180ms', output:'...' },
      { role:'tool', peerId:'ravn-author', tool:'grep', args:'requestAnimationFrame|onPointerMove', status:'ok', dur:'40ms',
        output:'observatory.jsx:412 onPointerMove(e){ this.pan(e.dx, e.dy); this.render(); }\nobservatory.jsx:498 render(){ for (const e of this.entities) this.drawEntity(e); }' },
      { role:'assistant', peerId:'ravn-author', cli:'claude', tokens:420, ms:2340,
        content:'Two issues. (1) render() scans all 400 entities each pointermove. (2) no rAF throttle. Plan: add a Quadtree in canvas/quadtree.js, use it in render() to only draw what\'s in the viewBox, and throttle pan with rAF. Implementing now.' },
      { role:'tool', peerId:'ravn-author', tool:'write', args:'canvas/quadtree.js · new · 96 lines', status:'ok', dur:'40ms' },
      { role:'tool', peerId:'ravn-author', tool:'apply_patch', args:'observatory.jsx · 2 hunks · +214 −12', status:'ok', dur:'120ms' },
      { role:'tool', peerId:'ravn-author', tool:'run', args:'npm test observatory.perf.test.jsx', status:'ok', dur:'8.4s',
        output:'PASS observatory.perf.test.jsx\n  ✓ renders 400-entity graph under 16ms per frame (12ms)\n  ✓ drag remains above 55fps for 5s (4.2s)' },
      { role:'assistant', peerId:'ravn-author', cli:'claude', tokens:180, ms:1180,
        content:'Frame time dropped 18ms → 6ms. Emitting code.changed for review + verify.',
        delegation:{ eventType:'code.changed', toPeerId:'ravn-reviewer' } },
      // Verifier turn — runs own checks + emits outcome
      { role:'assistant', peerId:'ravn-verifier', cli:'gpt-5', tokens:240, ms:3200,
        content:'Running jest + browser smoke-test on the diff. Full perf battery (13 suites, 58 tests) completed in 4.2s. 1 failure in observatory.a11y.test.jsx — aria-live not updated during pan. Filing as a separate finding.',
        outcome:{
          verdict:'verified', eventType:'verify.passed',
          summary:'perf objectives met · frame time 18ms → 6ms · 58/59 passing',
          fields:{ checks_passed:58, checks_failed:1, frame_time_ms:6, target_ms:16 },
          findings:[
            { severity:'minor', loc:'observatory.a11y.test.jsx:34', msg:'aria-live pan announcement not verified — may be pre-existing' },
          ],
        } },
      // Reviewer turn — emits a `---outcome---` block with needs_changes
      { role:'thinking', peerId:'ravn-reviewer', ms:2400, content:'Reading the diff end-to-end. Quadtree is good, but I see an edge case: if an entity is removed from the graph at runtime, the quadtree reference persists → memory leak. Also checking whether pan throttle respects prefers-reduced-motion.' },
      { role:'assistant', peerId:'ravn-reviewer', cli:'claude', tokens:560, ms:4100,
        content:'Good direction, 2 majors before this lands.\n\n1. **canvas/quadtree.js:48** — `insert()` adds to the tree but there\'s no `remove()`. Entity deletion leaves dangling refs. Add a remove path or rebuild on entity-set change.\n2. **observatory.jsx:412** — rAF pan ignores `prefers-reduced-motion`. Honor the media query or at least disable the throttle when it\'s set.\n\nMinors below. Once 1+2 land, I\'ll re-review.',
        outcome:{
          verdict:'needs_changes', eventType:'review.needs_changes',
          summary:'2 majors, 2 minors · memory leak on entity delete · reduced-motion',
          fields:{ findings_count:4, critical_count:0, major_count:2, minor_count:2 },
          findings:[
            { severity:'major', loc:'canvas/quadtree.js:48', msg:'insert() has no paired remove() — dangling refs on entity delete' },
            { severity:'major', loc:'observatory.jsx:412', msg:'rAF pan ignores prefers-reduced-motion' },
            { severity:'minor', loc:'canvas/quadtree.js:12', msg:'INF should be Number.POSITIVE_INFINITY for clarity' },
            { severity:'minor', loc:'observatory.jsx:498', msg:'_drawnCount is only used in dev overlay — wrap in __DEV__' },
          ],
        } },
      // Security approves in parallel
      { role:'assistant', peerId:'ravn-security', cli:'claude', tokens:120, ms:1600,
        content:'No new sinks, no dependency changes, diff is within the allow-list for the repo. Approving.',
        outcome:{
          verdict:'pass', eventType:'security.approved',
          summary:'no new sinks · no dep changes · diff within allow-list',
          fields:{ sast_findings:0, deps_changed:0, scope:'frontend-only' },
        } },
      { role:'user', peerId:'human', content:'good catches. @author — fix both majors and re-run. ship when reviewer re-approves.',
        directedTo:['ravn-author'] },
      // Author responds to needs_changes
      { role:'tool', peerId:'ravn-author', tool:'apply_patch', args:'canvas/quadtree.js · add remove() · +34 −4', status:'ok', dur:'180ms' },
      { role:'tool', peerId:'ravn-author', tool:'apply_patch', args:'observatory.jsx · reduced-motion guard · +12 −2', status:'ok', dur:'90ms' },
      { role:'tool', peerId:'ravn-author', tool:'run', args:'npm test -- canvas/quadtree observatory', status:'ok', dur:'6.1s',
        output:'PASS canvas/quadtree.test.jsx (15 passing)\nPASS observatory.perf.test.jsx (2 passing)\nPASS observatory.a11y.test.jsx · reduced-motion fix verified' },
      { role:'tool', peerId:'ravn-author', tool:'git.commit', args:'fix: quadtree dispose + reduced-motion', status:'ok', dur:'90ms',
        output:'[obs-perf a019be2] fix: quadtree dispose + reduced-motion\n 2 files changed, 46 insertions(+), 6 deletions(-)' },
      { role:'assistant', peerId:'ravn-author', cli:'claude', tokens:90, ms:640,
        content:'Both fixes landed. Handing back for re-review.',
        delegation:{ eventType:'code.changed', toPeerId:'ravn-reviewer' } },
      // Reviewer LGTMs
      { role:'assistant', peerId:'ravn-reviewer', cli:'claude', tokens:80, ms:820,
        content:'Ship it. Both fixes verified, quadtree dispose has a test, reduced-motion test is green.',
        outcome:{
          verdict:'pass', eventType:'review.passed',
          summary:'LGTM · both fixes landed · reduced-motion verified',
          fields:{ findings_count:0, lgtm:true },
        } },
      { role:'tool', peerId:'ravn-author', tool:'git.push', args:'origin obs-perf', status:'ok', dur:'1.4s' },
      { role:'tool', peerId:'ravn-author', tool:'github.pr.open', args:'niuu/volundr #248', status:'ok', dur:'820ms',
        output:'opened PR #248: obs: canvas panning/zoom perf' },
      { role:'assistant', peerId:'ravn-author', cli:'claude', tokens:60, ms:420,
        content:'PR #248 is up. Verifier is watching CI — will post an outcome when it lands.' },
      { role:'tool', peerId:'ravn-verifier', tool:'ci.watch', args:'gh pr view 248 --json statusCheckRollup', status:'run', dur:'22m elapsed',
        output:'queued: 4 checks\nrunning: lint, unit, e2e, typecheck\nreceived: lint ✓ (42s) · typecheck ✓ (12s)' },
    ];
  }
  if (s.name.includes('mimir-bge-reindex')) {
    return [
      { role:'user', peerId:'human', content:'reindex all mimir docs with bge-large-en-v1.5. use the H100.' },
      { role:'tool', peerId:'ravn-author', tool:'read', args:'mimir/config/embeddings.yaml', status:'ok', dur:'40ms' },
      { role:'assistant', peerId:'ravn-author', cli:'claude', tokens:180, ms:890, content:'Switching model to bge-large-en-v1.5 and queuing a full reindex of 48k docs. Batch 64, should take ~22m on H100.' },
      { role:'tool', peerId:'ravn-author', tool:'run', args:'python mimir/index.py --model bge-large-en-v1.5 --batch 64', status:'run', dur:'12m elapsed',
        output:'[00:00] loaded model bge-large-en-v1.5 (3.1GiB VRAM)\n[00:02] streaming 48127 docs from pgvector\n[01:14] batch 100/1500  · 20.1 docs/s · eta 20m\n[04:22] batch 400/1500  · 19.8 docs/s · eta 16m\n[12:08] batch 1000/1500 · 20.3 docs/s · eta 8m\n[14:36] batch 1200/1500 · 20.5 docs/s · eta 4m' },
    ];
  }
  return [
    { role:'user', peerId:'human', content:'...' },
    { role:'assistant', peerId:'ravn-author', cli:s.cli, tokens:120, ms:800, content:s.preview || 'working on it.' },
  ];
}

function mockTerminal(s, shell) {
  if (shell === 'tests') {
    return [
      { prompt:'workspace $', text:'npm test -- --watch' },
      { type:'muted', text:'> niuu-volundr@7.2 test\n> jest --watch\n' },
      { type:'muted', text:'PASS  canvas/quadtree.test.jsx' },
      { type:'ok',    text:'  ✓ builds tree with 1000 points (4ms)' },
      { type:'ok',    text:'  ✓ queries viewport rectangle (2ms)' },
      { type:'ok',    text:'  ✓ returns empty for disjoint region (1ms)' },
      { type:'muted', text:'PASS  observatory.perf.test.jsx' },
      { type:'ok',    text:'  ✓ renders 400-entity graph under 16ms per frame (12ms)' },
      { type:'ok',    text:'  ✓ drag remains above 55fps for 5s (4.2s)' },
      { type:'err',   text:'FAIL  observatory.a11y.test.jsx' },
      { type:'err',   text:'  ✗ canvas announces pan to screen-readers (36ms)' },
      { type:'muted', text:'    Expected aria-live region to update on pan.' },
      { type:'muted', text:'\nTest Suites: 1 failed, 12 passed, 13 total' },
      { type:'muted', text:'Tests:       1 failed, 58 passed, 59 total' },
      { type:'muted', text:'\nWatching for changes...' },
    ];
  }
  if (shell === 'view') {
    return [
      { prompt:'workspace (ro) $', text:'ls -la' },
      { type:'muted', text:'total 168' },
      { type:'muted', text:'drwxr-xr-x  7 dev dev  224 Mar  3 20:12 .' },
      { type:'muted', text:'drwxr-xr-x  3 dev dev   96 Mar  3 18:44 ..' },
      { type:'muted', text:'-rw-r--r--  1 dev dev  482 Mar  3 20:08 .gitignore' },
      { type:'muted', text:'-rw-r--r--  1 dev dev 2.3k Mar  3 20:08 package.json' },
      { type:'muted', text:'drwxr-xr-x 12 dev dev  384 Mar  3 20:12 src/' },
      { prompt:'workspace (ro) $', text:'git status --short' },
      { type:'ok',    text:' M observatory.jsx' },
      { type:'ok',    text:' M canvas/quadtree.js' },
      { type:'ok',    text:'?? canvas/quadtree.test.jsx' },
    ];
  }
  return [
    { prompt:'workspace $', text:'git log --oneline -5' },
    { type:'muted', text:'a019be2 perf: throttle pan to rAF' },
    { type:'muted', text:'f2b9c1a perf: quadtree cull @ 60fps' },
    { type:'muted', text:'c44001d chore: add perf test harness' },
    { type:'muted', text:'7b2adb0 obs: viewport-box math' },
    { type:'muted', text:'1e7bc22 obs: initial canvas skeleton' },
    { prompt:'workspace $', text:'git diff --stat HEAD~1' },
    { type:'ok',    text:' observatory.jsx    | 248 +++++++++++++++++++++----' },
    { type:'ok',    text:' canvas/quadtree.js |  96 ++++++++++' },
    { type:'ok',    text:' styles.css         |  10 +--' },
    { type:'muted', text:' 3 files changed, 340 insertions(+), 14 deletions(-)' },
  ];
}

function mockDiff(file) {
  if (file.path === 'observatory.jsx') {
    return [
      { oldStart: 405, oldCount: 12, newStart: 405, newCount: 18, label:'onPointerMove · drag hot path', lines: [
        { type:'context', content:'  onPointerMove(e) {', oldLine: 405, newLine: 405 },
        { type:'context', content:'    if (!this.panning) return;', oldLine: 406, newLine: 406 },
        { type:'remove',  content:'    this.pan(e.dx, e.dy);', oldLine: 407 },
        { type:'remove',  content:'    this.render();', oldLine: 408 },
        { type:'add',     content:'    this._pendingPan = { dx: e.dx, dy: e.dy };', newLine: 407 },
        { type:'add',     content:'    if (this._rafHandle) return;', newLine: 408 },
        { type:'add',     content:'    this._rafHandle = requestAnimationFrame(() => {', newLine: 409 },
        { type:'add',     content:'      this.pan(this._pendingPan.dx, this._pendingPan.dy);', newLine: 410 },
        { type:'add',     content:'      this.render();', newLine: 411 },
        { type:'add',     content:'      this._rafHandle = null;', newLine: 412 },
        { type:'add',     content:'    });', newLine: 413 },
        { type:'context', content:'  }', oldLine: 409, newLine: 414 },
      ]},
      { oldStart: 498, oldCount: 5, newStart: 505, newCount: 10, label:'render · quadtree cull', lines: [
        { type:'context', content:'  render() {', oldLine: 498, newLine: 505 },
        { type:'remove',  content:'    for (const e of this.entities) this.drawEntity(e);', oldLine: 499 },
        { type:'add',     content:'    const vb = this.viewBox();', newLine: 506 },
        { type:'add',     content:'    const visible = this.quadtree.visible(vb, this.zoom);', newLine: 507 },
        { type:'add',     content:'    for (const e of visible) this.drawEntity(e);', newLine: 508 },
        { type:'add',     content:'    this._drawnCount = visible.length;', newLine: 509 },
        { type:'context', content:'  }', oldLine: 500, newLine: 510 },
      ]},
    ];
  }
  return [
    { oldStart: 1, oldCount: 0, newStart: 1, newCount: 6, label:'new file', lines: [
      { type:'add', content:'// quadtree.js — spatial index for canvas entities', newLine:1 },
      { type:'add', content:'export class QuadNode {', newLine:2 },
      { type:'add', content:'  constructor(x0, y0, x1, y1) {', newLine:3 },
      { type:'add', content:'    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;', newLine:4 },
      { type:'add', content:'    this.children = null; this.points = [];', newLine:5 },
      { type:'add', content:'  }', newLine:6 },
    ]},
  ];
}

function mockTree(s) {
  return [
    { kind:'dir', name:'src', open:true, children: [
      { kind:'dir', name:'canvas', open:true, children: [
        { kind:'file', name:'quadtree.js', status:'new', size:'2.3k' },
        { kind:'file', name:'quadtree.test.jsx', status:'new', size:'3.1k' },
        { kind:'file', name:'viewport.js', status:'none', size:'1.1k' },
      ]},
      { kind:'file', name:'observatory.jsx', status:'mod', size:'12.4k', active:true },
      { kind:'file', name:'observatory.perf.test.jsx', status:'new', size:'4.8k' },
      { kind:'file', name:'shell.jsx', status:'none', size:'5.2k' },
      { kind:'file', name:'styles.css', status:'mod', size:'14.6k' },
      { kind:'file', name:'data.jsx', status:'none', size:'8.4k' },
    ]},
    { kind:'dir', name:'fonts', children: [
      { kind:'file', name:'InterVariable.woff2', status:'none' },
      { kind:'file', name:'JetBrainsMonoNL-Regular.woff2', status:'none' },
    ]},
    { kind:'file', name:'package.json', status:'none', size:'2.3k' },
    { kind:'file', name:'tokens.css', status:'none', size:'3.8k' },
    { kind:'file', name:'Flokk Observatory.html', status:'none', size:'1.8k' },
  ];
}

function mockChronicle(s) {
  // Fallback — only used when session has no explicit chronicle
  return [
    { t: s.created, type:'session', label:`pod scheduled on ${window.VOL_DATA.CLUSTER_BY_ID[s.cluster]?.name}` },
    { t: s.created + 40*1000, type:'git', label:`cloned ${s.source.type==='git'?s.source.repo:s.source.path}`, action:'clone' },
    { t: s.lastActive, type:'message', label:s.preview || 'active', tokens: s.tokensOut },
  ];
}

function mockLogs(s) {
  const base = s.created;
  const fmt = (t) => new Date(t).toISOString().replace('T',' ').slice(11,19);
  return [
    { t: fmt(base),              level:'info',  src:'scheduler',   msg:`pod ${s.id} assigned to node ${window.VOL_DATA.CLUSTER_BY_ID[s.cluster]?.name}-03` },
    { t: fmt(base+2000),         level:'info',  src:'kubelet',     msg:'pulling image ghcr.io/niuu/forge:7.2' },
    { t: fmt(base+18000),        level:'info',  src:'kubelet',     msg:'image pulled (2.3GiB · 16s)' },
    { t: fmt(base+19500),        level:'info',  src:'credentials', msg:`mounted anthropic-key (scope=global)` },
    { t: fmt(base+20000),        level:'info',  src:'workspace',   msg:'cloning niuu/volundr branch obs-perf' },
    { t: fmt(base+42000),        level:'info',  src:'workspace',   msg:'clone complete · 1412 objects · 9.2MiB' },
    { t: fmt(base+44000),        level:'info',  src:'mcp:filesystem', msg:'ready on :3847' },
    { t: fmt(base+46000),        level:'info',  src:'mcp:git',     msg:'ready on :3848' },
    { t: fmt(base+50000),        level:'info',  src:'cli:claude',  msg:'ready · model=sonnet-primary · ctx=200k' },
    { t: fmt(s.lastActive-120000), level:'debug', src:'cli:claude', msg:'tool read(observatory.jsx) · 82,400 → 81,200 t remaining' },
    { t: fmt(s.lastActive-100000), level:'debug', src:'cli:claude', msg:'tool apply_patch observatory.jsx · 2 hunks accepted' },
    { t: fmt(s.lastActive-80000),  level:'info',  src:'git',        msg:'commit f2b9c1a: perf: quadtree cull @ 60fps' },
    { t: fmt(s.lastActive-60000),  level:'info',  src:'git',        msg:'push origin obs-perf · 2 commits' },
    { t: fmt(s.lastActive-40000),  level:'info',  src:'github',     msg:'opened PR #248: obs: canvas panning/zoom perf' },
    { t: fmt(s.lastActive-20000),  level:'warn',  src:'cli:claude', msg:'rate-limit soft warning: 95 req/min (threshold 100)' },
    { t: fmt(s.lastActive),        level:'info',  src:'cli:claude', msg:'spawning sub-process · npm test --watch' },
  ];
}

window.SessionsView = SessionsView;
