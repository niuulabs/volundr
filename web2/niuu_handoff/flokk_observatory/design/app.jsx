/* global React, ReactDOM */
// ─── Flokk — main app + plugin definitions ─────────────────────

const { useState, useCallback, useMemo, useEffect } = React;
const { Shell, makePlaceholder } = window.FlokkShell;
const { Observatory, useMockFlokkState, REALMS, CLUSTERS } = window.FlokkObservatory;
const { DEFAULT_REGISTRY, DS_RUNES } = window.FlokkData;

// ───────── Shared bits ─────────

const ACTIVITY_COLOR = {
  idle:'var(--color-text-muted)', thinking:'var(--brand-300)', tooling:'var(--brand-400)',
  waiting:'var(--color-text-muted)', delegating:'var(--brand-200)', writing:'var(--brand-200)',
  reading:'var(--brand-300)',
};
function ActivityDot({a, pulse=true}) {
  return <span className={`sd ${pulse && a!=='idle'?'pulsing':''}`} style={{background:ACTIVITY_COLOR[a]||'var(--color-text-muted)', boxShadow: a!=='idle'? `0 0 8px ${ACTIVITY_COLOR[a]}`:'none'}}/>;
}

// ───────── Observatory plugin ─────────
// The plugin is a *descriptor*: `subnav` and `render` are React components that
// the Shell mounts. They share state via a single hook that lives in a wrapper
// component — NOT called from App's useMemo (which would break rules of hooks).

function ObservatoryView({ ctx, slot }) {
  // All three slots (content/subnav/topbar) share state through a module-level
  // store. The content slot owns the simulation; subnav/topbar subscribe and
  // read snapshots. Selection lives in the store to avoid re-publish loops.
  const store = getObservatoryStore();
  useObservatoryStore(store);

  if (slot === 'content') return <ObservatoryContent ctx={ctx} store={store} />;

  const view = store.read();
  // Guard against the brief window where content hasn't yet mounted + published
  // (e.g. when switching back to Observatory from another plugin, the subnav/topbar
  // slots may render before the content slot's effect runs).
  if (!view || !view.state) return slot === 'topbar' ? <TopbarStatsStub/> : <div/>;
  if (slot === 'topbar') return <ObservatoryTopbar state={view.state} />;
  if (slot === 'subnav') return <ObservatorySubnav state={view.state} filter={view.filter} setFilter={store.setFilter} selectedId={view.selectedId} setSelectedId={store.setSelected} />;
  return null;
}

function ObservatoryContent({ ctx, store }) {
  const [events, pushEvent] = useEventLog();
  const rawState = useMockFlokkState(pushEvent);
  // The state object is re-created each render; memoize by its constituent refs
  // so downstream effects don't fire on every tick. Otherwise publish→tick→render→publish infinite loop.
  const state = useMemo(
    () => rawState,
    [rawState.ravens, rawState.flocks, rawState.events, rawState.mimir, rawState.subMimirs]
  );
  const [hoveredId, setHoveredId] = useState(null);
  // selection + filter live in the store, not local state — avoids feedback loops
  const view = store.read() || {};
  const selectedId = view.selectedId || null;
  const filter = view.filter || 'all';

  // Publish state snapshot on every data change (not every render).
  useEffect(()=>{
    store.publish({ state, events });
  }, [state, events]);

  const selected = state.ravens.find(r=>r.id===selectedId);
  const selectedRealm = REALMS.find(z=>z.id===selectedId);
  const selectedCluster = CLUSTERS.find(c=>c.id===selectedId);
  return (
    <>
      <Observatory state={state}
        onHover={setHoveredId} hoveredId={hoveredId}
        onClick={r=>store.setSelected(r.id)} onSelect={store.setSelected}
        selectedId={selectedId}
        showMinimap={ctx.tweaks.minimap!==false} />
      {ctx.tweaks.legend!==false && <ConnectionLegend />}
      {ctx.tweaks.eventLog!==false && <EventLog events={events} state={state} />}
      {(selected || selectedRealm || selectedCluster) && (
        <EntityDrawer entity={selected} realm={selectedRealm} cluster={selectedCluster}
          state={state} onClose={()=>store.setSelected(null)} onSelect={store.setSelected} />
      )}
    </>
  );
}

// Tiny subscription store so subnav/topbar can re-render when content state changes.
let _obsStore = null;
function getObservatoryStore() {
  if (_obsStore) return _obsStore;
  const subscribers = new Set();
  let latest = { state:null, events:[], selectedId:null, filter:'all' };
  let scheduled = false;
  const notify = () => {
    scheduled = false;
    subscribers.forEach(fn => fn());
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(notify);
  };
  _obsStore = {
    publish(partial) {
      const next = {...latest, ...partial};
      // Only notify if reference actually changed for a key
      if (partial.state !== latest.state || partial.events !== latest.events) {
        latest = next;
        schedule();
      } else {
        latest = next;
      }
    },
    setSelected(id) {
      if (latest.selectedId === id) return;
      latest = {...latest, selectedId: id};
      schedule();
    },
    setFilter(f) {
      if (latest.filter === f) return;
      latest = {...latest, filter: f};
      schedule();
    },
    read() { return latest; },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
  return _obsStore;
}

function useObservatoryStore(store) {
  const [,setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick(t => t + 1)), [store]);
}

function ObservatoryTopbar({ state }) {
  const ravn = state.ravens.filter(r=>r.kind==='ravn_long' || r.kind==='ravn_raid').length;
  const raids = state.flocks.filter(f=>f.kind==='raid').length;
  return (
    <div className="stats">
      <div className="stat"><span className="stat-label">realms</span><strong>{REALMS.length}</strong></div>
      <div className="stat emph accent"><span className="stat-label">ravens</span><strong>{ravn}</strong></div>
      <div className="stat accent"><span className="stat-label">raids</span><strong>{raids}</strong></div>
    </div>
  );
}
function TopbarStatsStub() { return <div className="stats"><div className="stat"><span className="stat-label">booting…</span></div></div>; }

const ObservatoryPluginDescriptor = {
  id:'observatory', rune:DS_RUNES.flokk, title:'Flokk · Observatory', subtitle:'live topology & entity registry',
  render: (ctx) => <ObservatoryView ctx={ctx} slot="content" />,
  subnav: (ctx) => <ObservatoryView ctx={ctx} slot="subnav" />,
  topbarRight: (ctx) => <ObservatoryView ctx={ctx} slot="topbar" />,
};

function useEventLog() {
  const [events, setEvents] = useState([]);
  const push = useCallback((ev)=>{
    setEvents(prev => {
      const decorated = decorateEvent(ev);
      const next = [...prev, decorated];
      return next.slice(-80);
    });
  }, []);
  return [events, push];
}

function decorateEvent(ev) {
  const time = new Date().toISOString().slice(11,19);
  if (ev.type === 'raid-form') return { id: ev.id, time, type: 'RAID', subject: ev.raidId, body: <><span className="ev-mono">tyr</span> dispatched raid · “{ev.purpose}”</> };
  const kinds = {
    ravn:    { type:'RAVN',    subjects:['Huginn','Muninn','Thrymr','Gunnr','Hlokk','Skogul','Vidofnir','Rata','Dain'], msgs:['thought handoff','tool call complete','delegated to Reviewer','read mimir/page','token budget ok'] },
    tyr:     { type:'TYR',     subjects:['tyr','tyr/prod'], msgs:['saga advanced','raid state → working','dispatch queued','raid dissolved','coord elected'] },
    mimir:   { type:'MIMIR',   subjects:['mimir','mimir/code','mimir/ops','mimir/lore'], msgs:['page written','page indexed','embedding updated','query resolved'] },
    bifrost: { type:'BIFROST', subjects:['bifrost','bifrost/edge'], msgs:['claude 4.5 sonnet · 842 tok','cache hit · 0.3ms','gpt-4o · 1204 tok','local vllm · 240 tok'] },
  };
  const k = kinds[ev.type] || kinds.ravn;
  const subject = k.subjects[Math.floor(Math.random()*k.subjects.length)];
  const msg = k.msgs[Math.floor(Math.random()*k.msgs.length)];
  return { id:ev.id, time, type:k.type, subject, body: msg };
}

function EventLog({ events, state }) {
  const ref = React.useRef(null);
  useEffect(()=>{
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length]);
  const rate = events.length >= 2 ? Math.round(events.length / 4) : 0;
  return (
    <div className="eventlog" style={{pointerEvents:'none'}}>
      <div className="eventlog-inner" style={{pointerEvents:'auto'}}>
        <div className="eventlog-head">
          <span>event stream</span>
          <span className="eventlog-head-right">
            <span>{rate}/s</span>
            <span style={{color:'var(--color-text-faint)'}}>·</span>
            <span>tailing last {events.length}</span>
          </span>
        </div>
        <div className="eventlog-body" ref={ref}>
          {events.slice(-30).map(e=>(
            <div key={e.id} className="eventlog-row">
              <span className="ev-time">{e.time}</span>
              <span className="ev-type">{e.type}</span>
              <span className="ev-subject">{e.subject}</span>
              <span className="ev-body">{e.body}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectionLegend() {
  const Swatch = ({kind}) => {
    const props = { width:36, height:14, viewBox:'0 0 36 14' };
    switch(kind) {
      case 'solid': return <svg {...props}><line x1="2" y1="7" x2="34" y2="7" stroke="rgba(147,197,253,0.8)" strokeWidth="1.4" /></svg>;
      case 'dashed-anim': return <svg {...props}><line x1="2" y1="7" x2="34" y2="7" stroke="rgba(125,211,252,0.9)" strokeWidth="1.4" strokeDasharray="3 3" /></svg>;
      case 'dashed-long': return <svg {...props}><line x1="2" y1="7" x2="34" y2="7" stroke="rgba(147,197,253,0.7)" strokeWidth="1.2" strokeDasharray="6 4" /></svg>;
      case 'soft': return <svg {...props}><line x1="2" y1="7" x2="34" y2="7" stroke="rgba(224,242,254,0.55)" strokeWidth="0.9" /></svg>;
      case 'raid': return <svg {...props}><circle cx="8" cy="7" r="3" fill="rgba(125,211,252,0.9)"/><circle cx="28" cy="7" r="3" fill="rgba(125,211,252,0.9)"/><line x1="11" y1="7" x2="25" y2="7" stroke="rgba(125,211,252,0.6)" strokeWidth="1"/></svg>;
    }
  };
  return (
    <div className="overlay-topleft" style={{gap:'var(--space-3)'}}>
      <div className="panel legend">
        <div className="panel-title">
          <span>connections</span>
          <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--color-text-faint)',textTransform:'none',letterSpacing:0}}>5 kinds</span>
        </div>
        <div className="legend-body">
          <div className="legend-row"><span className="legend-swatch"><Swatch kind="solid"/></span>Týr → Völundr</div>
          <div className="legend-row"><span className="legend-swatch"><Swatch kind="dashed-anim"/></span>Týr ⇝ raid coord</div>
          <div className="legend-row"><span className="legend-swatch"><Swatch kind="dashed-long"/></span>Bifröst → ext. model</div>
          <div className="legend-row"><span className="legend-swatch"><Swatch kind="soft"/></span>ravn → Mímir</div>
          <div className="legend-row"><span className="legend-swatch"><Swatch kind="raid"/></span>raid cohesion</div>
        </div>
      </div>
    </div>
  );
}

function ObservatorySubnav({ state, filter, setFilter, selectedId, setSelectedId }) {
  const counts = useMemo(()=>({
    realms: REALMS.length,
    clusters: CLUSTERS.length,
    agents: state.ravens.filter(r=>['ravn_long','ravn_raid','valkyrie'].includes(r.kind)).length,
    raids: state.flocks.filter(f=>f.kind==='raid').length,
    services: state.ravens.filter(r=>r.kind==='service').length,
    devices: state.ravens.filter(r=>['printer','vaettir','beacon'].includes(r.kind)).length,
  }),[state]);

  const dot = (c) => <span className="subnav-dot" style={{background:c, boxShadow:`0 0 6px ${c}`}}/>;

  return (
    <>
      <div className="subnav-section">
        <div className="subnav-label">Filter <span style={{fontFamily:'var(--font-mono)',fontWeight:400,textTransform:'none',letterSpacing:0,color:'var(--color-text-faint)'}}>·</span></div>
        {[
          ['all','All entities',counts.realms+counts.clusters+counts.agents+counts.services+counts.devices,'var(--brand-300)'],
          ['agents','Agents',counts.agents,'var(--brand-200)'],
          ['raids','Raids',counts.raids,'var(--brand-500)'],
          ['services','Services',counts.services,'var(--brand-300)'],
          ['devices','Devices',counts.devices,'var(--color-text-muted)'],
        ].map(([id,label,count,c])=>(
          <div key={id} className={`subnav-row ${filter===id?'':''}`} onClick={()=>setFilter(id)}
            style={{background: filter===id? 'color-mix(in srgb, var(--color-brand) 10%, transparent)':undefined}}>
            {dot(c)}<span className="subnav-name">{label}</span><span className="subnav-count">{count}</span>
          </div>
        ))}
      </div>
      <div className="subnav-section">
        <div className="subnav-label">Realms <span className="subnav-count">{REALMS.length}</span></div>
        {REALMS.map(z=>(
          <div key={z.id}
            className={`subnav-row`}
            onClick={()=>setSelectedId(z.id)}
            style={{background:selectedId===z.id?'color-mix(in srgb, var(--color-brand) 10%, transparent)':undefined}}>
            {dot('var(--brand-300)')}
            <span className="subnav-name">{z.label}</span>
            <span className="subnav-count">vlan {z.vlan}</span>
          </div>
        ))}
      </div>
      <div className="subnav-section">
        <div className="subnav-label">Clusters <span className="subnav-count">{CLUSTERS.length}</span></div>
        {CLUSTERS.map(c=>(
          <div key={c.id} className="subnav-row" onClick={()=>setSelectedId(c.id)}
            style={{background:selectedId===c.id?'color-mix(in srgb, var(--color-brand) 10%, transparent)':undefined}}>
            {dot('var(--brand-500)')}
            <span className="subnav-name">{c.label}</span>
            <span className="subnav-count">⎔</span>
          </div>
        ))}
        <div className="subnav-label" style={{marginTop:'var(--space-3)'}}>Active raids <span className="subnav-count">{state.flocks.filter(f=>f.kind==='raid').length}</span></div>
        {state.flocks.filter(f=>f.kind==='raid').slice(0,6).map(f=>(
          <div key={f.id} className="subnav-row">
            {dot(f.state==='forming'?'var(--brand-200)':f.state==='working'?'var(--brand-500)':'var(--color-text-muted)')}
            <span className="subnav-name" style={{fontFamily:'var(--font-mono)',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.purpose}</span>
            <span className="subnav-count">{f.state.slice(0,4)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ───────── Entity drawer ─────────

function EntityDrawer({ entity, realm, cluster, state, onClose, onSelect }) {
  // Hooks must be called unconditionally — stash the seed BEFORE any early return.
  const sparkValues = useMemo(()=>{
    if (!entity) return [];
    const seed = entity.id.charCodeAt(0)+entity.id.charCodeAt(entity.id.length-1);
    return Array.from({length:24},(_,i)=>30+Math.sin(i*0.7+seed)*15+(Math.sin(i*1.3+seed*3)*10+10));
  },[entity?.id]);

  if (realm) return <RealmDrawer realm={realm} state={state} onClose={onClose} onSelect={onSelect} />;
  if (cluster) return <ClusterDrawer cluster={cluster} state={state} onClose={onClose} onSelect={onSelect} />;
  if (!entity) return null;

  const kindMeta = DEFAULT_REGISTRY.types.find(t=>t.id===entity.kind);
  const rune = entity.rune || kindMeta?.rune || '◇';

  return (
    <div className="drawer">
      <div className="drawer-head">
        <button className="drawer-close" onClick={onClose}>×</button>
        <div className="drawer-eyebrow">
          <span className="drawer-rune" style={{fontFamily:'var(--font-mono)',fontSize:16,fontWeight:700}}>{rune}</span>
          <span>{kindMeta?.label || entity.kind} · entity</span>
        </div>
        <h3 className="drawer-title">{entity.name}<span className="id-chip">{entity.id}</span></h3>
        <div className="drawer-sub">{kindMeta?.description?.split('.')[0]}.</div>
      </div>
      <div className="drawer-body">
        <div className="status-row">
          <ActivityDot a={entity.activity}/>
          <span style={{color:'var(--color-text-primary)'}}>{(entity.activity||'idle').toUpperCase()}</span>
          <span style={{flex:1}}/>
          <span style={{color:'var(--color-text-muted)'}}>last tick · {new Date().toISOString().slice(14,19)}</span>
        </div>

        <div className="section-head">Identity</div>
        <dl className="prop-grid">
          <dt>id</dt><dd>{entity.id}</dd>
          <dt>kind</dt><dd>{entity.kind}</dd>
          <dt>realm</dt><dd>{entity.zone||'—'}</dd>
          {entity.cluster && <><dt>cluster</dt><dd>{entity.cluster}</dd></>}
          {entity.hostId && <><dt>host</dt><dd><a style={{color:'var(--brand-300)',cursor:'pointer'}} onClick={()=>onSelect(entity.hostId)}>{entity.hostId}</a></dd></>}
          {entity.flockId && entity.flockId!=='long' && <><dt>flock</dt><dd>{entity.flockId}</dd></>}
        </dl>

        {['tyr','bifrost','volundr','ravn_long','valkyrie','host','printer','vaettir','service','model'].includes(entity.kind) && (
          <>
            <div className="section-head">Properties</div>
            <dl className="prop-grid">
              {entity.kind==='tyr' && <>
                <dt>mode</dt><dd><span className="badge" style={{color:entity.mode==='active'?'var(--brand-200)':'var(--color-text-muted)',borderColor:entity.mode==='active'?'color-mix(in srgb, var(--color-brand) 40%, transparent)':'var(--color-border-subtle)'}}>{entity.mode}</span></dd>
                <dt>active sagas</dt><dd>{entity.activeSagas}</dd>
                <dt>pending raids</dt><dd>{entity.pendingRaids}</dd>
              </>}
              {entity.kind==='bifrost' && <>
                <dt>providers</dt><dd>{entity.providers?.join(', ')}</dd>
                <dt>req/min</dt><dd>{entity.reqPerMin}</dd>
                <dt>cache hit</dt><dd>{Math.round(entity.cacheHitRate*100)}%</dd>
              </>}
              {entity.kind==='volundr' && <>
                <dt>sessions</dt><dd>{entity.activeSessions} / {entity.maxSessions}</dd>
              </>}
              {entity.kind==='ravn_long' && <>
                {entity.persona && <><dt>persona</dt><dd>{entity.persona}</dd></>}
                {entity.specialty && <><dt>specialty</dt><dd className="plain">{entity.specialty}</dd></>}
                <dt>tokens</dt><dd>{entity.tokens?.toLocaleString?.() ?? entity.tokens}</dd>
              </>}
              {entity.kind==='valkyrie' && <>
                <dt>specialty</dt><dd className="plain">{entity.specialty}</dd>
                <dt>autonomy</dt><dd><span className="badge" style={{color: entity.autonomy==='full'?'var(--brand-200)':entity.autonomy==='notify'?'var(--color-text-secondary)':'var(--color-critical-fg)', borderColor:'color-mix(in srgb, currentColor 30%, transparent)'}}>{entity.autonomy}</span></dd>
              </>}
              {entity.kind==='host' && <>
                <dt>hardware</dt><dd className="plain">{entity.hw}</dd>
                <dt>os</dt><dd>{entity.os}</dd>
                {entity.cores && <><dt>cores</dt><dd>{entity.cores}</dd></>}
                {entity.ram && <><dt>ram</dt><dd>{entity.ram}</dd></>}
                {entity.gpu && <><dt>gpu</dt><dd>{entity.gpu}</dd></>}
              </>}
              {entity.kind==='printer' && <>
                <dt>model</dt><dd className="plain">{entity.model}</dd>
              </>}
              {entity.kind==='vaettir' && <>
                <dt>sensors</dt><dd>{entity.sensors?.join(', ')}</dd>
              </>}
              {entity.kind==='service' && <>
                <dt>type</dt><dd>{entity.svcType}</dd>
              </>}
              {entity.kind==='model' && <>
                <dt>provider</dt><dd>{entity.provider}</dd>
                <dt>location</dt><dd>{entity.location}</dd>
              </>}
            </dl>
          </>
        )}

        {entity.role==='coord' && entity.confidence && (
          <>
            <div className="section-head">Coordinator</div>
            <dl className="prop-grid">
              <dt>confidence</dt>
              <dd className="conf-bar">
                <span className="conf-track"><span className="conf-fill" style={{width:`${entity.confidence*100}%`, background: entity.confidence>0.8?'var(--brand-300)':'var(--brand-500)'}}/></span>
                <span>{Math.round(entity.confidence*100)}%</span>
              </dd>
            </dl>
          </>
        )}

        {['ravn_long','bifrost'].includes(entity.kind) && (
          <>
            <div className="section-head">Token throughput · 24 ticks</div>
            <svg className="sparkline" viewBox="0 0 240 32" preserveAspectRatio="none">
              <polyline points={sparkValues.map((v,i)=>`${i*10},${32-v*0.5}`).join(' ')} fill="none" stroke="var(--brand-300)" strokeWidth="1.2"/>
              <polyline points={`0,32 ${sparkValues.map((v,i)=>`${i*10},${32-v*0.5}`).join(' ')} 240,32`} fill="color-mix(in srgb, var(--brand-300) 15%, transparent)" stroke="none"/>
            </svg>
          </>
        )}

        <div className="section-head">Actions</div>
        <div className="btn-row">
          <button className="btn primary">Open chat</button>
          <button className="btn">Inspect in registry</button>
          <button className="btn ghost">Quarantine</button>
        </div>
      </div>
    </div>
  );
}

function RealmDrawer({ realm, state, onClose, onSelect }) {
  const residents = state.ravens.filter(r=>r.zone===realm.id);
  return (
    <div className="drawer">
      <div className="drawer-head">
        <button className="drawer-close" onClick={onClose}>×</button>
        <div className="drawer-eyebrow"><span className="drawer-rune">ᛞ</span>Realm · VLAN zone</div>
        <h3 className="drawer-title">{realm.label}<span className="id-chip">vlan {realm.vlan}</span></h3>
        <div className="drawer-sub">{realm.dns}</div>
      </div>
      <div className="drawer-body">
        <div className="section-head">About</div>
        <p style={{fontSize:13,color:'var(--color-text-secondary)',margin:'0 0 var(--space-3)'}}>{realm.purpose}</p>
        <dl className="prop-grid">
          <dt>vlan</dt><dd>{realm.vlan}</dd>
          <dt>dns</dt><dd>{realm.dns}</dd>
          <dt>residents</dt><dd>{residents.length}</dd>
        </dl>
        <div className="section-head">Residents</div>
        <div style={{display:'flex',flexDirection:'column',gap:2}}>
          {residents.slice(0,20).map(r=>(
            <div key={r.id} className="subnav-row" onClick={()=>onSelect(r.id)}>
              <ActivityDot a={r.activity}/>
              <span className="subnav-name">{r.name}</span>
              <span className="subnav-count">{r.kind}</span>
            </div>
          ))}
          {residents.length>20 && <div style={{fontSize:11,color:'var(--color-text-muted)',padding:'6px 8px'}}>+{residents.length-20} more</div>}
        </div>
      </div>
    </div>
  );
}

function ClusterDrawer({ cluster, state, onClose, onSelect }) {
  const members = state.ravens.filter(r=>r.cluster===cluster.id);
  return (
    <div className="drawer">
      <div className="drawer-head">
        <button className="drawer-close" onClick={onClose}>×</button>
        <div className="drawer-eyebrow"><span className="drawer-rune">ᚲ</span>Cluster · k8s</div>
        <h3 className="drawer-title">{cluster.label}<span className="id-chip">{cluster.id}</span></h3>
        <div className="drawer-sub">inside realm · {cluster.realm}</div>
      </div>
      <div className="drawer-body">
        <div className="section-head">About</div>
        <p style={{fontSize:13,color:'var(--color-text-secondary)',margin:'0 0 var(--space-3)'}}>{cluster.purpose}</p>
        <dl className="prop-grid">
          <dt>realm</dt><dd>{cluster.realm}</dd>
          <dt>members</dt><dd>{members.length}</dd>
        </dl>
        <div className="section-head">Members</div>
        <div style={{display:'flex',flexDirection:'column',gap:2}}>
          {members.map(r=>(
            <div key={r.id} className="subnav-row" onClick={()=>onSelect(r.id)}>
              <ActivityDot a={r.activity}/>
              <span className="subnav-name">{r.name}</span>
              <span className="subnav-count">{r.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────── Registry plugin ─────────

function RegistryPlugin({ registry, setRegistry }) {
  return {
    id:'registry', rune:'ᛞ', title:'Registry', subtitle:'type definitions · SDD §4.1',
    render: (ctx) => <window.RegistryView registry={registry} setRegistry={setRegistry} />,
    subnav: null,
    topbarRight: () => (
      <div className="stats">
        <div className="stat"><span className="stat-label">types</span><strong>{registry.types.length}</strong></div>
        <div className="stat emph accent"><span className="stat-label">rev</span><strong>{registry.version}</strong></div>
      </div>
    ),
  };
}

// ───────── Root ─────────

function App() {
  const [registry, setRegistry] = useState(DEFAULT_REGISTRY);

  const plugins = useMemo(()=>[
    ObservatoryPluginDescriptor,
    { id:'tyr',       rune: DS_RUNES.tyr,       title:'Týr',       subtitle:'saga & raid orchestration',     render: makePlaceholder('Týr plugin', 'saga orchestration', 'The Týr UI handles raid dispatch, saga state machines, and coord elections. It lives in its own plugin package and renders into this slot when imported.')() },
    { id:'bifrost',   rune: DS_RUNES.bifrost,   title:'Bifröst',   subtitle:'LLM gateway',                  render: makePlaceholder('Bifröst plugin', 'llm gateway', 'Route inspector, provider fan-out, cache analytics, and cost ledger. This tab is served by @niuu/bifrost-plugin.')() },
    { id:'volundr',   rune: DS_RUNES.volundr,   title:'Völundr',   subtitle:'session forge',                render: makePlaceholder('Völundr plugin', 'dev pod forge', 'Forge, attach to, and tear down remote dev sessions. Lives at @niuu/volundr-plugin.')() },
    { id:'mimir',     rune: DS_RUNES.mimir,     title:'Mímir',     subtitle:'knowledge well',               render: makePlaceholder('Mímir plugin', 'knowledge well', 'Page browser, embedding search, and sub-mímir management.')() },
    { id:'valkyrie',  rune: DS_RUNES.valkyrie,  title:'Valkyrie',  subtitle:'guardian agents',              render: makePlaceholder('Valkyrie plugin', 'guardian agents', 'Per-cluster autonomous agent console — policy, autonomy band, recent actions.')() },
    RegistryPlugin({ registry, setRegistry }),
  ], [registry]);

  return <Shell plugins={plugins} registry={registry} setRegistry={setRegistry} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
