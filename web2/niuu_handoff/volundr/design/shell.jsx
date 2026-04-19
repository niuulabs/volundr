/* global React */
// ─── Völundr shell — Niuu plugin surface ─────────────────────
// Amber theme (default). Tabs: Forge · Sessions · Templates · Credentials · Clusters.

const { useState: useSh, useEffect: useShE, useCallback: useShC } = React;

const VOL_TABS = [
  { id:'forge',       label:'Forge',       hint:'live fleet at a glance' },
  { id:'sessions',    label:'Sessions',    hint:'pods · filters · detail' },
  { id:'templates',   label:'Templates',   hint:'workspace + runtime presets' },
  { id:'credentials', label:'Credentials', hint:'secrets injected into pods' },
  { id:'clusters',    label:'Clusters',    hint:'forges available to spawn into' },
];

function VolundrShell() {
  const [activeTab, setActiveTab] = useSh(() => localStorage.getItem('vol.tab') || 'forge');
  useShE(()=>{ localStorage.setItem('vol.tab', activeTab); }, [activeTab]);

  const [selectedSessionId, setSelectedSessionId] = useSh(() => localStorage.getItem('vol.session') || 's-4912');
  useShE(()=>{ localStorage.setItem('vol.session', selectedSessionId); }, [selectedSessionId]);

  const [selectedTemplate, setSelectedTemplate] = useSh(() => localStorage.getItem('vol.tmpl') || 'niuu-platform');
  useShE(()=>{ localStorage.setItem('vol.tmpl', selectedTemplate); }, [selectedTemplate]);

  const [selectedCluster, setSelectedCluster] = useSh(() => localStorage.getItem('vol.cluster') || 'valaskjalf');
  useShE(()=>{ localStorage.setItem('vol.cluster', selectedCluster); }, [selectedCluster]);

  const [showLaunch, setShowLaunch] = useSh(false);
  const [sessionFilter, setSessionFilter] = useSh({ status:'active', cluster:'all', cli:'all', q:'' });
  const [subnavCollapsed, setSubnavCollapsed] = useSh(() => localStorage.getItem('vol.subnavCol') === '1');
  useShE(()=>{ localStorage.setItem('vol.subnavCol', subnavCollapsed ? '1':'0'); }, [subnavCollapsed]);

  // Tweaks protocol
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
  const setTweak = useShC((key, value)=>{
    setTweaks(t=>{
      const next = {...t, [key]:value};
      window.parent.postMessage({type:'__edit_mode_set_keys', edits:{[key]:value}}, '*');
      return next;
    });
  },[]);

  // ── TICK ── re-render every 5s for live clocks/reltimes
  const [, tick] = useSh(0);
  useShE(()=>{ const i = setInterval(()=>tick(x=>x+1), 5000); return ()=>clearInterval(i); },[]);

  const selectedSession = window.VOL_DATA.SESSION_BY_ID[selectedSessionId] || window.VOL_DATA.SESSIONS[0];
  const stats = window.VOL_DATA.computeStats(window.VOL_DATA.SESSIONS);

  const ctx = {
    activeTab, setTab: setActiveTab,
    selectedSessionId, selectSession: setSelectedSessionId, selectedSession,
    selectedTemplate, selectTemplate: setSelectedTemplate,
    selectedCluster,  selectCluster:  setSelectedCluster,
    sessionFilter, setSessionFilter,
    showLaunch, setShowLaunch,
    tweaks, setTweak, stats,
    subnavCollapsed, setSubnavCollapsed,
  };

  return (
    <div className={`app ${subnavCollapsed?'subnav-collapsed':''}`} data-tab={activeTab} data-screen-label={`01 ${activeTab}`}>
      {/* ─── RAIL ─── */}
      <aside className="rail">
        <div className="rail-brand" title="Flokk">{'ᚠ'}</div>
        <button className="rail-item" title="Observatory">ᛞ</button>
        <button className="rail-item" title="Týr">ᛃ</button>
        <button className="rail-item" title="Bifröst">ᚨ</button>
        <button className="rail-item" title="Mímir">ᛗ</button>
        <button className="rail-item" title="Ravn">ᚱ</button>
        <button className="rail-item active" title="Völundr · session forge">ᚲ</button>
        <button className="rail-item" title="Valkyrie">ᛒ</button>
        <div className="rail-spacer"/>
        <button className="rail-item" title="Settings" style={{fontSize:14}}>⚙</button>
        <div className="rail-foot">v7.2</div>
      </aside>

      {/* ─── TOPBAR ─── */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">
            <h1>Völundr</h1>
            <span className="module-sub">session forge · remote dev pods</span>
          </div>
          <nav className="tabs">
            {VOL_TABS.map(t => (
              <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`}
                onClick={()=>setActiveTab(t.id)} title={t.hint}>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="topbar-right">
          <TopbarStats stats={stats}/>
          <div className="topbar-sep"/>
          <div className="live-badge"><span className="live-dot"/>LIVE</div>
          <div className="topbar-sep"/>
          <div className="topbar-meta"><span>◷</span> <strong>{new Date().toISOString().slice(11,19)}</strong>Z</div>
          <div className="topbar-sep"/>
          <button className="v-btn v-btn-primary"
                  onClick={()=>setShowLaunch(true)}>
            <Icon.plus/>&nbsp;forge
          </button>
        </div>
      </header>

      {/* ─── SUBNAV (per-tab) ─── */}
      <Subnav ctx={ctx}/>
      {ctx.activeTab !== 'forge' && (
        <button className={`subnav-collapse ${subnavCollapsed?'out':''}`}
                onClick={()=>setSubnavCollapsed(v=>!v)}
                title={subnavCollapsed?'expand sidebar':'collapse sidebar'}>
          {subnavCollapsed ? <Icon.chev/> : <Icon.chevLeft/>}
        </button>
      )}

      {/* ─── CONTENT ─── */}
      <main className="content">
        <PageRouter ctx={ctx}/>
        {tweaksOn && <TweaksPanel tweaks={tweaks} setTweak={setTweak}/>}
      </main>

      {/* ─── LAUNCH OVERLAY ─── */}
      {showLaunch && <window.LaunchWizard ctx={ctx} onClose={()=>setShowLaunch(false)}/>}

      {/* ─── FOOTER ─── */}
      <footer className="footer">
        <div className="footer-left">
          <code>tab:{activeTab}</code>
          <span className="sep">·</span>
          <code>session:{selectedSessionId}</code>
          <span className="sep">·</span>
          <code>cluster:{selectedCluster}</code>
        </div>
        <div className="footer-right">
          <span>{stats.active} active</span>
          <span className="sep">·</span>
          <span>{window.VOL_ATOMS.tokens(stats.tokens)} tokens</span>
          <span className="sep">·</span>
          <span>{window.VOL_ATOMS.money(stats.costDollars * 100)} today</span>
        </div>
      </footer>
    </div>
  );
}

// ── Topbar stats pills ─
function TopbarStats({ stats }) {
  return (
    <>
      <span className="topbar-chip ok"><span className="chip-dot">●</span>{stats.active} active</span>
      {stats.booting > 0 && <span className="topbar-chip warn"><span className="chip-dot">●</span>{stats.booting} booting</span>}
      {stats.error > 0 && <span className="topbar-chip err"><span className="chip-dot">●</span>{stats.error} error</span>}
    </>
  );
}

// ── SUBNAV ─
function Subnav({ ctx }) {
  const { activeTab, selectedSessionId, selectSession, selectedTemplate, selectTemplate,
          selectedCluster, selectCluster, sessionFilter, setSessionFilter } = ctx;
  const { SESSIONS, TEMPLATES, CLUSTERS, CREDENTIALS } = window.VOL_DATA;

  if (activeTab === 'forge') return null;

  if (activeTab === 'sessions') {
    const byStatus = { active:[], idle:[], stopped:[], error:[], booting:[] };
    for (const s of SESSIONS) {
      const k = s.activity === 'idle' && s.status==='active' ? 'idle' : s.status;
      (byStatus[k] = byStatus[k] || []).push(s);
    }
    const groups = [
      { key:'active',  label:'active',  items:byStatus.active || [] },
      { key:'idle',    label:'idle',    items:byStatus.idle || [] },
      { key:'booting', label:'booting', items:byStatus.booting || [] },
      { key:'error',   label:'error',   items:byStatus.error || [] },
      { key:'stopped', label:'stopped', items:byStatus.stopped || [] },
    ].filter(g => g.items.length);
    return (
      <nav className="subnav">
        <div className="subnav-section">
          <div className="subnav-head">Pods <span className="mono dim">{SESSIONS.length}</span></div>
          <div className="subnav-hint">filter in header · click to open</div>
          <div className="v-sn-search">
            <Icon.search/>
            <input type="text" placeholder="filter by name / branch / issue"
                   value={sessionFilter.q}
                   onChange={e=>setSessionFilter({...sessionFilter, q:e.target.value})}/>
          </div>
        </div>
        {groups.map(g => (
          <div key={g.key} className="subnav-group">
            <div className="subnav-group-head"><span>{g.label}</span><span className="mono dim">{g.items.length}</span></div>
            {g.items.map(s => (
              <button key={s.id}
                      className={`subnav-item sn-sess ${selectedSessionId===s.id?'active':''}`}
                      onClick={()=>selectSession(s.id)}>
                <StatusDot status={s.status==='active' && s.activity==='idle' ? 'idle' : s.status}/>
                <div className="sn-sess-body">
                  <div className="sn-sess-name">{s.name}</div>
                  <div className="sn-sess-meta mono dim">{s.id}<span className="op"> · </span>{window.VOL_ATOMS.relTime(s.lastActive)}</div>
                </div>
                <CliBadge cli={s.cli} compact/>
              </button>
            ))}
          </div>
        ))}
      </nav>
    );
  }

  if (activeTab === 'templates') {
    return (
      <nav className="subnav">
        <div className="subnav-section">
          <div className="subnav-head">Templates <span className="mono dim">{TEMPLATES.length}</span></div>
          <div className="subnav-hint">workspace + runtime bundles</div>
        </div>
        <div className="subnav-group">
          <div className="subnav-group-head"><span>built-in</span><span className="mono dim">{TEMPLATES.length}</span></div>
          {TEMPLATES.map(t => (
            <button key={t.name}
                    className={`subnav-item ${selectedTemplate===t.name?'active':''}`}
                    onClick={()=>selectTemplate(t.name)}>
              <CliBadge cli={t.cli} compact/>
              <span className="mono">{t.name}</span>
              {t.default && <span className="v-badge-tiny">default</span>}
            </button>
          ))}
        </div>
      </nav>
    );
  }

  if (activeTab === 'credentials') {
    const byType = {};
    for (const c of CREDENTIALS) (byType[c.type] = byType[c.type] || []).push(c);
    return (
      <nav className="subnav">
        <div className="subnav-section">
          <div className="subnav-head">Credentials <span className="mono dim">{CREDENTIALS.length}</span></div>
          <div className="subnav-hint">mounted into pods on boot</div>
        </div>
        {Object.entries(byType).map(([type, items]) => (
          <div key={type} className="subnav-group">
            <div className="subnav-group-head"><span>{type.replace('_',' ')}</span><span className="mono dim">{items.length}</span></div>
            {items.map(c => (
              <div key={c.id} className="subnav-item">
                <span className="v-cred-dot"/>
                <span className="mono">{c.name}</span>
                <span className="v-ct mono dim">{c.keys.length}k</span>
              </div>
            ))}
          </div>
        ))}
      </nav>
    );
  }

  if (activeTab === 'clusters') {
    const byRealm = {};
    for (const c of CLUSTERS) (byRealm[c.realm] = byRealm[c.realm] || []).push(c);
    return (
      <nav className="subnav">
        <div className="subnav-section">
          <div className="subnav-head">Clusters <span className="mono dim">{CLUSTERS.length}</span></div>
          <div className="subnav-hint">by realm</div>
        </div>
        {Object.entries(byRealm).map(([realm, items]) => (
          <div key={realm} className="subnav-group">
            <div className="subnav-group-head"><span>{realm}</span><span className="mono dim">{items.length}</span></div>
            {items.map(c => (
              <button key={c.id}
                      className={`subnav-item ${selectedCluster===c.id?'active':''}`}
                      onClick={()=>selectCluster(c.id)}>
                <StatusDot status={c.status==='healthy'?'active':c.status==='warning'?'booting':'error'}/>
                <span className="mono">{c.name}</span>
                <span className="v-ct mono dim">{c.sessions}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    );
  }

  return null;
}

// ── PAGE ROUTER ─
function PageRouter({ ctx }) {
  switch (ctx.activeTab) {
    case 'forge':       return <window.ForgeView       ctx={ctx}/>;
    case 'sessions':    return <window.SessionsView    ctx={ctx}/>;
    case 'templates':   return <window.TemplatesView   ctx={ctx}/>;
    case 'credentials': return <window.CredentialsView ctx={ctx}/>;
    case 'clusters':    return <window.ClustersView    ctx={ctx}/>;
    default:            return null;
  }
}

// ── TWEAKS ─
function TweaksPanel({ tweaks, setTweak }) {
  const Switch = ({ keyName }) => (
    <button className={`v-switch ${tweaks[keyName]?'on':''}`} onClick={()=>setTweak(keyName, !tweaks[keyName])}>
      <span className="v-switch-knob"/><span className="mono">{String(!!tweaks[keyName])}</span>
    </button>
  );
  const Seg = ({ keyName, options }) => (
    <div className="v-seg-tiny">
      {options.map(o => (
        <button key={o.value} className={`v-seg-tiny-opt ${tweaks[keyName]===o.value?'active':''}`}
                onClick={()=>setTweak(keyName, o.value)}>{o.label}</button>
      ))}
    </div>
  );
  return (
    <aside className="tweaks">
      <div className="tweaks-head">
        <h4>Tweaks</h4>
        <span className="mono dim">niuu · volundr</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row"><label>Sessions layout</label>
          <Seg keyName="sessionsLayout" options={[{label:'table',value:'table'},{label:'cards',value:'cards'}]}/>
        </div>
        <div className="tweak-row"><label>Density</label>
          <Seg keyName="density" options={[{label:'cozy',value:'cozy'},{label:'normal',value:'normal'},{label:'dense',value:'dense'}]}/>
        </div>
        <div className="tweak-row"><label>Show meters</label><Switch keyName="showMeters"/></div>
        <div className="tweak-row"><label>Show idle pods</label><Switch keyName="showIdle"/></div>
      </div>
    </aside>
  );
}

window.VolundrShell = VolundrShell;
