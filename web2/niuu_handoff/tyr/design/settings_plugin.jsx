/* global React, PERSONAS, PERSONA_BY_ID, PersonaAvatar, Switch, RUNES */
// ─── Niuu Settings — cross-plugin aggregated settings module ─────
// Each module contributes a "settings section" via window.SETTINGS_REGISTRY.
// The Settings plugin renders the aggregated navigation and content.
//
// Design: a real plugin surface (lives on the rail, not inside Tyr). Gives us
// one place to configure the whole stack.

const { useState: setUS, useEffect: setUE, useMemo: setUM } = React;

// ────────────────────────────────────────────────────────────────
//  REGISTRY — modules append their settings sections here.
//  Shape: { id, moduleId, moduleRune, moduleName, label, render(ctx) }
// ────────────────────────────────────────────────────────────────
window.SETTINGS_REGISTRY = window.SETTINGS_REGISTRY || [];

// KV row — reusable
function KV({ label, children }) {
  return <div className="kv-row"><label>{label}</label><span>{children}</span></div>;
}

// ────────────────────────────────────────────────────────────────
//  BUILT-IN sections contributed by Niuu itself (workspace / appearance)
// ────────────────────────────────────────────────────────────────
const NIUU_SECTIONS = [
  {
    id:'workspace', moduleId:'niuu', moduleRune:'ᚾ', moduleName:'Niuu',
    label:'Workspace',
    render: () => (
      <div className="settings-sec">
        <h3>Workspace</h3>
        <p className="desc">The top-level bindings — who and where this Niuu instance runs.</p>
        <KV label="Workspace name"><span className="mono">niuulabs</span></KV>
        <KV label="Owner"><span className="mono">jonas@niuulabs.io</span></KV>
        <KV label="Realm"><span className="mono">midgard.niuu.internal</span></KV>
        <KV label="Shell version"><span className="mono">n.0.3</span></KV>
        <KV label="Registry version"><span className="mono">v7.2</span></KV>
      </div>
    ),
  },
  {
    id:'appearance', moduleId:'niuu', moduleRune:'ᚾ', moduleName:'Niuu',
    label:'Appearance',
    render: ({ tweaks, setTweak }) => (
      <div className="settings-sec">
        <h3>Appearance</h3>
        <p className="desc">Theme and density for the whole Niuu shell. Applies everywhere.</p>
        <div className="kv-row"><label>Theme</label>
          <div className="tweak-seg">
            {[{value:'ice',label:'ice'},{value:'spring',label:'spring'},{value:'',label:'amber'}].map(o=>(
              <button key={o.label} className={tweaks.theme===o.value?'on':''} onClick={()=>setTweak('theme', o.value)}>{o.label}</button>
            ))}
          </div>
        </div>
        <div className="kv-row"><label>Density</label>
          <div className="tweak-seg">
            {[{value:'comfortable',label:'comfortable'},{value:'compact',label:'compact'}].map(o=>(
              <button key={o.value} className={tweaks.density===o.value?'on':''} onClick={()=>setTweak('density', o.value)}>{o.label}</button>
            ))}
          </div>
        </div>
        <KV label="Dark mode"><span className="mono faint">always on</span></KV>
      </div>
    ),
  },
];

// ────────────────────────────────────────────────────────────────
//  Týr-contributed sections — exactly what used to be inside Týr.
// ────────────────────────────────────────────────────────────────
const TYR_SECTIONS = [
  {
    id:'tyr.general', moduleId:'tyr', moduleRune:RUNES.tyr, moduleName:'Týr',
    label:'General',
    render: () => (
      <div className="settings-sec">
        <h3>Týr · general</h3>
        <p className="desc">Core service bindings for the saga coordinator.</p>
        <KV label="Service URL"><span className="mono">https://tyr.niuu.internal</span></KV>
        <KV label="Event backbone"><span className="mono">sleipnir · nats</span></KV>
        <KV label="Knowledge store"><span className="mono">mímir · qdrant:/niuu</span></KV>
        <KV label="Default workflow"><span className="mono">tpl-ship v1.4.2</span></KV>
      </div>
    ),
  },
  {
    id:'tyr.dispatch', moduleId:'tyr', moduleRune:RUNES.tyr, moduleName:'Týr',
    label:'Dispatch rules',
    render: () => (
      <div className="settings-sec">
        <h3>Týr · dispatch rules</h3>
        <p className="desc">How the dispatcher promotes queued raids into running ones.</p>
        <div className="kv-row"><label>Confidence threshold</label><input className="input mono" defaultValue="0.70" style={{ width:120 }}/></div>
        <div className="kv-row"><label>Max concurrent raids</label><input className="input mono" defaultValue="5" style={{ width:120 }}/></div>
        <div className="kv-row"><label>Auto-continue phases</label><Switch on={true} onChange={()=>{}}/></div>
        <div className="kv-row"><label>Retry on fail</label><input className="input mono" defaultValue="2" style={{ width:120 }}/></div>
        <div className="kv-row"><label>Quiet hours</label><input className="input mono" defaultValue="22:00–07:00 UTC" style={{ width:200 }}/></div>
        <div className="kv-row"><label>Escalate after (review)</label><input className="input mono" defaultValue="30m" style={{ width:120 }}/></div>
      </div>
    ),
  },
  {
    id:'tyr.integrations', moduleId:'tyr', moduleRune:RUNES.tyr, moduleName:'Týr',
    label:'Integrations',
    render: () => (
      <div className="settings-sec">
        <h3>Týr · integrations</h3>
        <p className="desc">Trackers, repos, notifiers reachable by the saga coordinator.</p>
        {[
          { name:'Linear', letter:'L', status:'connected' },
          { name:'GitHub', letter:'G', status:'connected' },
          { name:'Jira', letter:'J', status:'disconnected' },
          { name:'Slack', letter:'S', status:'connected' },
          { name:'PagerDuty', letter:'P', status:'disconnected' },
        ].map(i => (
          <div key={i.name} className="integration-card" style={{ marginBottom:8 }}>
            <div className="logo">{i.letter}</div>
            <div>
              <div style={{ fontWeight:500, fontSize:13 }}>{i.name}</div>
              <div className="mono faint" style={{ fontSize:11, marginTop:2 }}>{i.status === 'connected' ? 'api key · ends ···g84' : 'not connected'}</div>
            </div>
            <button className={`btn ${i.status==='connected'?'ghost':'primary'} sm`}>{i.status==='connected'?'Disconnect':'Connect'}</button>
          </div>
        ))}
      </div>
    ),
  },
  {
    id:'tyr.personas', moduleId:'tyr', moduleRune:RUNES.tyr, moduleName:'Týr',
    label:'Persona overrides',
    render: () => (
      <div className="settings-sec">
        <h3>Týr · persona overrides</h3>
        <p className="desc">Workspace-level defaults applied to every workflow. Workflows can override further.</p>
        {PERSONAS.slice(0,6).map(p => (
          <div key={p.id} className="kv-row" style={{ gridTemplateColumns:'28px 1fr auto auto auto', alignItems:'center' }}>
            <PersonaAvatar personaId={p.id} size={24}/>
            <div>
              <div style={{ fontWeight:500, fontSize:13 }}>{p.name}</div>
              <div className="mono faint" style={{ fontSize:10, marginTop:2 }}>produces · {p.produces.join(', ')}</div>
            </div>
            <span className="chip">budget 40</span>
            <span className="chip">model · sonnet-4.5</span>
            <button className="btn sm ghost">Edit</button>
          </div>
        ))}
      </div>
    ),
  },
  {
    id:'tyr.gates', moduleId:'tyr', moduleRune:RUNES.tyr, moduleName:'Týr',
    label:'Gates & reviewers',
    render: () => (
      <div className="settings-sec">
        <h3>Týr · gates &amp; reviewers</h3>
        <p className="desc">Who can approve gates in workflows. Routing rules.</p>
        {['jonas@niuulabs.io','oskar@niuulabs.io','yngve@niuulabs.io'].map(who => (
          <KV key={who} label={who}><span className="mono">all gates · auto-forward after 30m</span></KV>
        ))}
      </div>
    ),
  },
  {
    id:'tyr.notifications', moduleId:'tyr', moduleRune:RUNES.tyr, moduleName:'Týr',
    label:'Notifications',
    render: () => (
      <div className="settings-sec">
        <h3>Týr · notifications</h3>
        <p className="desc">Where Týr sends alerts.</p>
        <KV label="Slack channel"><span className="mono">#niuu-ops</span></KV>
        <KV label="Email digest"><span className="mono">daily 08:00</span></KV>
        <div className="kv-row"><label>On escalation</label><Switch on={true} onChange={()=>{}}/></div>
        <div className="kv-row"><label>On saga complete</label><Switch on={false} onChange={()=>{}}/></div>
      </div>
    ),
  },
  {
    id:'tyr.advanced', moduleId:'tyr', moduleRune:RUNES.tyr, moduleName:'Týr',
    label:'Advanced',
    render: () => (
      <div className="settings-sec">
        <h3>Týr · advanced</h3>
        <p className="desc">Danger zone.</p>
        <div className="kv-row"><label>Flush queue</label><button className="btn danger sm">Flush</button></div>
        <div className="kv-row"><label>Reset dispatcher</label><button className="btn danger sm">Reset</button></div>
        <div className="kv-row"><label>Rebuild confidence scores</label><button className="btn sm">Rebuild</button></div>
      </div>
    ),
  },
];

// Placeholder sections for sibling plugins — stubbed until those modules arrive.
const STUB_SECTIONS = [
  { id:'observatory.registry', moduleId:'observatory', moduleRune:RUNES.observatory, moduleName:'Observatory',
    label:'Entity registry', stub:true,
    desc:'Edit entity-type colors, runes, and shapes. Contributed by the Observatory plugin.' },
  { id:'volundr.pods', moduleId:'volundr', moduleRune:RUNES.volundr, moduleName:'Völundr',
    label:'Session pods', stub:true,
    desc:'Pod templates, image pinning, cluster targeting. Contributed by Völundr.' },
  { id:'bifrost.routing', moduleId:'bifrost', moduleRune:RUNES.bifrost, moduleName:'Bifröst',
    label:'Model routing', stub:true,
    desc:'Per-persona model defaults, routing rules, fallback chains. Contributed by Bifröst.' },
  { id:'mimir.index', moduleId:'mimir', moduleRune:RUNES.mimir, moduleName:'Mímir',
    label:'Index & chronicles', stub:true,
    desc:'Embedding model, chronicle retention, dedupe windows. Contributed by Mímir.' },
  { id:'valkyrie.guardrails', moduleId:'valkyrie', moduleRune:RUNES.valkyrie, moduleName:'Valkyrie',
    label:'Guardrails', stub:true,
    desc:'Autonomous actions, quotas, escalation policies. Contributed by Valkyrie.' },
].map(s => ({
  ...s,
  render: () => (
    <div className="settings-sec">
      <h3>{s.moduleName} · {s.label.toLowerCase()}</h3>
      <p className="desc">{s.desc}</p>
      <div className="stub-card">
        <div className="eyebrow">STUB</div>
        <p className="muted" style={{ margin:0, fontSize:12, marginTop:4 }}>
          The <code>{s.moduleId}</code> plugin registers this section via <code>SETTINGS_REGISTRY.push(...)</code> once it ships. Its UI mounts here.
        </p>
      </div>
    </div>
  ),
}));

// Register built-in sections (only once — guard against re-exec of this file)
if (!window.SETTINGS_REGISTERED) {
  window.SETTINGS_REGISTRY.push(...NIUU_SECTIONS, ...TYR_SECTIONS, ...STUB_SECTIONS);
  window.SETTINGS_REGISTERED = true;
}

// ────────────────────────────────────────────────────────────────
//  Settings plugin surface
// ────────────────────────────────────────────────────────────────
function SettingsRail({ sections, activeId, setActiveId }) {
  // group by module, preserving insertion order
  const groups = [];
  const seen = new Map();
  sections.forEach(s => {
    if (!seen.has(s.moduleId)) {
      seen.set(s.moduleId, { moduleId:s.moduleId, moduleName:s.moduleName, moduleRune:s.moduleRune, items:[] });
      groups.push(seen.get(s.moduleId));
    }
    seen.get(s.moduleId).items.push(s);
  });
  return (
    <div className="subnav">
      <div className="subnav-section">
        <div className="subnav-label">
          <span>Settings</span>
          <span className="mono faint">{sections.length}</span>
        </div>
        <div className="subnav-hint">Aggregated from {groups.length} modules. Each section is contributed by a plugin.</div>
      </div>
      <div className="subnav-section scroll">
        {groups.map(g => (
          <React.Fragment key={g.moduleId}>
            <div className="subnav-label">
              <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span className="settings-mod-rune">{g.moduleRune}</span>{g.moduleName}
              </span>
              <span className="mono faint">{g.items.length}</span>
            </div>
            {g.items.map(s => (
              <div key={s.id}
                   className={`subnav-row ${activeId===s.id?'active':''} ${s.stub?'muted':''}`}
                   onClick={()=>setActiveId(s.id)}>
                <span className="subnav-rune">◇</span>
                <span className="subnav-name">{s.label}</span>
                {s.stub && <span className="subnav-count">stub</span>}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function SettingsPluginView({ sections, activeId, ctx }) {
  const active = sections.find(s => s.id === activeId) || sections[0];
  return (
    <div className="settings-page">
      <div className="settings-page-head">
        <div>
          <div className="eyebrow">{active.moduleName.toUpperCase()} · {active.moduleId}</div>
          <h2>{active.label}</h2>
        </div>
        <div className="mono faint" style={{ fontSize:11 }}>{active.id}</div>
      </div>
      <div className="settings-page-body">
        {active.render(ctx)}
      </div>
    </div>
  );
}

// Settings topbar — a simplified top bar used when the rail's Settings item is active.
function SettingsTopbar() {
  const [clock, setClock] = setUS(new Date());
  setUE(()=>{ const t = setInterval(()=>setClock(new Date()), 1000); return ()=>clearInterval(t); },[]);
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-title">
          <span className="rune-mark">⚙</span>
          <h1>Settings</h1>
          <span className="module-sub">niuu · aggregated</span>
        </div>
      </div>
      <div className="topbar-right">
        <span className="topbar-meta">cross-plugin</span>
        <span className="topbar-sep"/>
        <span className="topbar-meta">{clock.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false})} UTC</span>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsRail, SettingsPluginView, SettingsTopbar });
