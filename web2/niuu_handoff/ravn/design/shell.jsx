/* global React, RAVN_DATA */
// ─── Ravn shell — Niuu plugin surface (tabs, topbar, subnav, footer) ──

const { useState: useSh, useEffect: useShE } = React;

const RAVN_TABS = [
  { id:'overview',  label:'Overview',   hint:'fleet health' },
  { id:'ravens',    label:'Ravens',     hint:'directory · triggers · activity' },
  { id:'personas',  label:'Personas',   hint:'catalog · editor · event wiring' },
  { id:'sessions',  label:'Sessions',   hint:'live threads' },
  { id:'budget',    label:'Budget',     hint:'spend · caps · projection' },
];

function RavnShell() {
  const [activeTab, setActiveTab] = useSh(() => localStorage.getItem('ravn.tab') || 'overview');
  useShE(()=>{ localStorage.setItem('ravn.tab', activeTab); }, [activeTab]);

  // Selected raven persists across tabs for detail linking
  const [selectedRavnId, setSelectedRavnId] = useSh(() => localStorage.getItem('ravn.selected') || 'muninn');
  useShE(()=>{ localStorage.setItem('ravn.selected', selectedRavnId); }, [selectedRavnId]);

  const [selectedPersona, setSelectedPersona] = useSh(() => localStorage.getItem('ravn.persona') || 'reviewer');
  useShE(()=>{ localStorage.setItem('ravn.persona', selectedPersona); }, [selectedPersona]);

  const [selectedSessionId, setSelectedSessionId] = useSh(() => localStorage.getItem('ravn.session') || 's-419');
  useShE(()=>{ localStorage.setItem('ravn.session', selectedSessionId); }, [selectedSessionId]);

  // Tweaks
  const [tweaks, setTweaks] = useSh(() => window.TWEAKS || {});
  const [tweaksOn, setTweaksOn] = useSh(false);
  useShE(()=>{
    const onMsg = (e)=>{
      if (e.data?.type === '__activate_edit_mode') setTweaksOn(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOn(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({type:'__edit_mode_available'}, '*');
    return ()=>window.removeEventListener('message', onMsg);
  },[]);
  const setTweak = (key, value)=>{
    setTweaks(t=>{
      const next = {...t, [key]:value};
      window.parent.postMessage({type:'__edit_mode_set_keys', edits:{[key]:value}}, '*');
      return next;
    });
  };

  // ── module rail (niuu) ──
  const MODULES = [
    { id:'observatory', rune:'ᚠ', label:'Flokk',  active:false },
    { id:'tyr',         rune:'ᛃ', label:'Týr',    active:false },
    { id:'ravn',        rune:'ᚱ', label:'Ravn',   active:true  },
    { id:'volundr',     rune:'ᚲ', label:'Völundr',active:false },
    { id:'mimir',       rune:'ᛗ', label:'Mímir',  active:false },
    { id:'bifrost',     rune:'ᚨ', label:'Bifröst',active:false },
  ];

  // ── count chips for topbar ──
  const { RAVENS, SESSIONS, TRIGGERS, LOG } = window.RAVN_DATA;
  const activeRavens = RAVENS.filter(r=>r.state==='active').length;
  const failedRavens = RAVENS.filter(r=>r.state==='failed').length;
  const openSessions = SESSIONS.filter(s=>s.state==='active').length;

  const selectedRavn = window.RAVN_DATA.RAVEN_BY_ID[selectedRavnId];

  const ctx = {
    activeTab, setTab: setActiveTab,
    selectedRavnId, selectRaven: setSelectedRavnId, selectedRavn,
    selectedPersona, selectPersona: setSelectedPersona,
    selectedSessionId, selectSession: setSelectedSessionId,
    tweaks, setTweak,
  };

  return (
    <div className="app" data-tab={activeTab}>
      {/* ─── RAIL (niuu modules) ─── */}
      <aside className="rail">
        <div className="rail-brand" title="Niuu">ᚾ</div>
        {MODULES.map(m => (
          <button key={m.id} className={`rail-item ${m.active?'active':''}`} title={m.label}>
            {m.rune}
          </button>
        ))}
        <div className="rail-spacer"/>
        <button className="rail-item" title="Settings">⚙</button>
        <div className="rail-foot">v7.2</div>
      </aside>

      {/* ─── TOPBAR ─── */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">
            <h1>Ravn</h1>
            <span className="module-sub">individual agents · personas · sessions</span>
          </div>
          <nav className="tabs">
            {RAVN_TABS.map(t => (
              <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`}
                onClick={()=>setActiveTab(t.id)} title={t.hint}>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="topbar-right">
          <TopbarChip kind="ok" icon="●" label={`${activeRavens} active`}/>
          {failedRavens > 0 && <TopbarChip kind="err" icon="●" label={`${failedRavens} failed`}/>}
          <TopbarChip kind="dim" icon="◷" label={`${openSessions} sessions`}/>
          <div className="topbar-sep"/>
          <div className="live-badge"><span className="live-dot"/>LIVE</div>
          <div className="topbar-sep"/>
          <div className="topbar-meta"><span>◷</span> <strong>{new Date().toISOString().slice(11,19)}</strong>Z</div>
          <div className="topbar-sep"/>
          <div className="topbar-meta"><span className="kbd">⌘K</span></div>
        </div>
      </header>

      {/* ─── SUBNAV (per-tab) ─── */}
      <Subnav ctx={ctx} />

      {/* ─── CONTENT ─── */}
      <main className="content">
        <PageRouter ctx={ctx}/>
        {tweaksOn && <TweaksPanel tweaks={tweaks} setTweak={setTweak}/>}
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="footer">
        <div className="footer-left">
          <code>tab:{activeTab}</code>
          <span className="sep">·</span>
          <code>raven:{selectedRavnId}</code>
          <span className="sep">·</span>
          <span>niuu.world</span>
        </div>
        <div className="footer-right">
          <span>{RAVENS.length} ravens</span>
          <span className="sep">·</span>
          <span>{TRIGGERS.filter(t=>t.enabled).length} triggers live</span>
          <span className="sep">·</span>
          <span>{LOG.length} log entries</span>
        </div>
      </footer>
    </div>
  );
}

function TopbarChip({ kind, icon, label }) {
  return <span className={`topbar-chip ${kind}`}><span className="chip-dot">{icon}</span>{label}</span>;
}

// ─── SUBNAV ─── per-tab navigation column
function Subnav({ ctx }) {
  const { activeTab, selectedRavnId, selectRaven, selectedPersona, selectPersona, selectedSessionId, selectSession } = ctx;
  const { RAVENS, PERSONAS, SESSIONS, TRIGGERS } = window.RAVN_DATA;

  if (activeTab === 'ravens') {
    // Ravens tab has its own consolidated fleet list in-page — no subnav.
    return null;
  }

  if (activeTab === 'personas') {
    const byRole = {};
    for (const p of PERSONAS) (byRole[p.role]=byRole[p.role]||[]).push(p);
    const roles = Object.keys(byRole).sort();
    return (
      <nav className="subnav">
        <div className="subnav-section">
          <div className="subnav-head">Personas <span className="mono dim">{PERSONAS.length}</span></div>
          <div className="subnav-hint">cognitive templates</div>
        </div>
        {roles.map(role => (
          <div key={role} className="subnav-group">
            <div className="subnav-group-head">
              <span>{role}</span>
              <span className="mono dim">{byRole[role].length}</span>
            </div>
            {byRole[role].map(p => (
              <button key={p.name}
                className={`subnav-item ${selectedPersona===p.name?'active':''}`}
                onClick={()=>selectPersona(p.name)}>
                <window.PersonaAvatar name={p.name} size={18}/>
                <span className="mono">{p.name}</span>
                {!p.builtin && <span className="badge-tiny">usr</span>}
                {p.hasOverride && <span className="badge-tiny warn">ovr</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
    );
  }

  if (activeTab === 'sessions') {
    const active = SESSIONS.filter(s=>s.state==='active');
    const other = SESSIONS.filter(s=>s.state!=='active');
    return (
      <nav className="subnav">
        <div className="subnav-section">
          <div className="subnav-head">Sessions</div>
          <div className="subnav-hint">{active.length} active · {other.length} closed</div>
        </div>
        <div className="subnav-group">
          <div className="subnav-group-head"><span>active</span><span className="mono dim">{active.length}</span></div>
          {active.map(s => (
            <button key={s.id}
              className={`subnav-item sn-session ${selectedSessionId===s.id?'active':''}`}
              onClick={()=>selectSession(s.id)}>
              <window.PersonaAvatar name={window.RAVN_DATA.RAVEN_BY_ID[s.ravnId]?.persona} size={18}/>
              <div className="sn-s-body">
                <div className="sn-s-title">{s.title}</div>
                <div className="sn-s-meta mono">{s.ravnId} · {s.messageCount}m · ${s.costUsd.toFixed(2)}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="subnav-group">
          <div className="subnav-group-head"><span>closed</span><span className="mono dim">{other.length}</span></div>
          {other.map(s => (
            <button key={s.id}
              className={`subnav-item sn-session ${selectedSessionId===s.id?'active':''}`}
              onClick={()=>selectSession(s.id)}>
              <span style={{opacity:0.5}}><window.PersonaAvatar name={window.RAVN_DATA.RAVEN_BY_ID[s.ravnId]?.persona} size={18}/></span>
              <div className="sn-s-body">
                <div className="sn-s-title" style={{opacity:0.7}}>{s.title}</div>
                <div className="sn-s-meta mono">{s.state} · {s.ravnId}</div>
              </div>
            </button>
          ))}
        </div>
      </nav>
    );
  }

  return null; // no subnav for overview / budget
}

// ─── PAGE ROUTER ───
function PageRouter({ ctx }) {
  switch (ctx.activeTab) {
    case 'overview':  return <window.OverviewView  setTab={ctx.setTab} selectRaven={ctx.selectRaven}/>;
    case 'ravens':    return <window.RavensView    ctx={ctx}/>;
    case 'personas':  return <window.PersonasView  ctx={ctx}/>;
    case 'sessions':  return <window.SessionsView  ctx={ctx}/>;
    case 'budget':    return <window.BudgetView    ctx={ctx}/>;
    default:          return null;
  }
}

// ─── TWEAKS PANEL ───
function TweaksPanel({ tweaks, setTweak }) {
  const Switch = ({keyName}) => (
    <button className={`switch ${tweaks[keyName]?'on':''}`} onClick={()=>setTweak(keyName,!tweaks[keyName])} />
  );
  const SegT = ({keyName, options}) => (
    <div className="tweak-seg">
      {options.map(o=><button key={o.value} className={tweaks[keyName]===o.value?'on':''} onClick={()=>setTweak(keyName,o.value)}>{o.label}</button>)}
    </div>
  );
  return (
    <div className="tweaks">
      <div className="tweaks-head"><h3>Tweaks</h3></div>
      <div className="tweak-row"><label>Density</label>
        <SegT keyName="density" options={[{label:'cozy',value:'cozy'},{label:'normal',value:'normal'},{label:'dense',value:'dense'}]}/>
      </div>
      <div className="tweak-row"><label>Ravens layout</label>
        <SegT keyName="ravensLayout" options={[{label:'table',value:'table'},{label:'cards',value:'cards'},{label:'split',value:'split'}]}/>
      </div>
      <div className="tweak-row"><label>Show budget bars</label><Switch keyName="showBudget"/></div>
      <div className="tweak-row"><label>Show subscription chips</label><Switch keyName="showSubs"/></div>
    </div>
  );
}

window.RavnShell = RavnShell;
