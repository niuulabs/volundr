/* global React, RUNES, SAGAS */
const { useState: useS, useEffect: useE, useMemo: useM } = React;

const TABS = [
  { id:'dashboard', label:'Dashboard',   rune:'◈' },
  { id:'sagas',     label:'Sagas',       rune:'ᛃ' },
  { id:'workflows', label:'Workflows',   rune:'⚙' },
  { id:'plan',      label:'Plan',        rune:'◇' },
  { id:'dispatch',  label:'Dispatch',    rune:'⇥' },
];

const RAIL_MODULES = [
  { id:'observatory', rune:RUNES.observatory, name:'Flokk' },
  { id:'tyr',       rune:RUNES.tyr,          name:'Týr' },
  { id:'volundr',   rune:RUNES.volundr,      name:'Völundr' },
  { id:'ravn',      rune:RUNES.ravn,         name:'Ravn' },
  { id:'mimir',     rune:RUNES.mimir,        name:'Mímir' },
  { id:'bifrost',   rune:RUNES.bifrost,      name:'Bifröst' },
  { id:'valkyrie',  rune:RUNES.valkyrie,     name:'Valkyrie' },
];
const RAIL_SETTINGS = { id:'settings', rune:'⚙', name:'Settings' };

function Rail({ active, onSelect }) {
  return (
    <div className="rail">
      <div className="rail-brand" title="Niuu">ᚾ</div>
      {RAIL_MODULES.map(m => (
        <button key={m.id} className={`rail-item ${m.id===active?'active':''}`} title={m.name} onClick={()=>onSelect&&onSelect(m.id)}>
          {m.rune}
        </button>
      ))}
      <div className="rail-spacer"/>
      <button
        className={`rail-item rail-settings ${active===RAIL_SETTINGS.id?'active':''}`}
        title={RAIL_SETTINGS.name}
        onClick={()=>onSelect&&onSelect(RAIL_SETTINGS.id)}>
        {RAIL_SETTINGS.rune}
      </button>
      <div className="rail-foot" title="Niuu shell">n.0.3</div>
    </div>
  );
}

function Topbar({ activeTab, setTab, onToggleTweaks }) {
  const [clock, setClock] = useS(new Date());
  useE(() => { const t = setInterval(()=>setClock(new Date()), 1000); return ()=>clearInterval(t); }, []);
  const tabCounts = useM(() => {
    const activeSagas = SAGAS.filter(s => s.status !== 'complete').length;
    const queued = window.QUEUE.filter(q => q.ready).length;
    return { sagas: activeSagas, workflows: window.TEMPLATES.length, dispatch: queued };
  }, []);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-title">
          <span className="rune-mark">{RUNES.tyr}</span>
          <h1>Týr</h1>
          <span className="module-sub">saga coordinator</span>
        </div>
        <div className="tabs">
          {TABS.map(t => {
            let count = null;
            if (t.id==='sagas') count = tabCounts.sagas;
            else if (t.id==='workflows') count = tabCounts.workflows;
            else if (t.id==='dispatch') count = tabCounts.dispatch;
            return (
              <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
                <span className="tab-rune">{t.rune}</span>
                {t.label}
                {count != null && <span className="tab-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="topbar-right">
        <span className="live-badge"><span className="live-dot"/> live</span>
        <span className="topbar-sep"/>
        <span className="topbar-meta">dispatcher <strong>on</strong></span>
        <span className="topbar-meta">threshold <strong>0.70</strong></span>
        <span className="topbar-meta">concurrent <strong>3/5</strong></span>
        <span className="topbar-sep"/>
        <span className="topbar-meta">{clock.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false})} UTC</span>
        <button className="btn ghost sm" onClick={onToggleTweaks} title="Toggle Tweaks">◎</button>
      </div>
    </div>
  );
}

function Subnav({ activeTab, sel, setSel, activeSagaId, setActiveSagaId, templates, activeTemplateId, setActiveTemplateId, setTab }) {
  if (activeTab === 'sagas') {
    const grouped = { active: [], review: [], complete: [], failed: [] };
    SAGAS.forEach(s => {
      if (s.status === 'running') grouped.active.push(s);
      else if (s.status === 'review') grouped.review.push(s);
      else if (s.status === 'complete') grouped.complete.push(s);
      else if (s.status === 'failed') grouped.failed.push(s);
      else grouped.active.push(s);
    });
    const Group = ({ title, items, dot }) => items.length ? (
      <>
        <div className="subnav-label">
          <span>{title}</span><span className="mono faint">{items.length}</span>
        </div>
        {items.map(s => (
          <div key={s.id} className={`subnav-row ${activeSagaId===s.id?'active':''}`} onClick={()=>setActiveSagaId(s.id)}>
            <span className="subnav-dot" style={{ background: dot }}/>
            <span className="subnav-name">{s.identifier} · {s.name}</span>
          </div>
        ))}
      </>
    ) : null;
    return (
      <div className="subnav">
        <div className="subnav-section">
          <input className="input" placeholder="Filter sagas…"/>
        </div>
        <div className="subnav-section scroll">
          <Group title="Active"   items={grouped.active}   dot="#bae6fd"/>
          <Group title="In review" items={grouped.review}  dot="#93c5fd"/>
          <Group title="Complete" items={grouped.complete} dot="#10b981"/>
          <Group title="Failed"   items={grouped.failed}   dot="#ef4444"/>
        </div>
      </div>
    );
  }

  if (activeTab === 'workflows') {
    return (
      <div className="subnav">
        <div className="subnav-section">
          <div className="subnav-label"><span>Templates</span><button className="btn sm" onClick={()=>setActiveTemplateId('new')}>+ new</button></div>
          <div className="subnav-hint">Reusable saga pipelines. Versioned, used by dispatch.</div>
        </div>
        <div className="subnav-section scroll">
          {templates.map(t => (
            <div key={t.id} className={`subnav-row ${activeTemplateId===t.id?'active':''}`} onClick={()=>setActiveTemplateId(t.id)}>
              <span className="subnav-rune">ᛃ</span>
              <span className="subnav-name">{t.name}</span>
              <span className="subnav-count">v{t.version}</span>
            </div>
          ))}
          <div className="subnav-label" style={{ marginTop:16 }}><span>Working copy</span></div>
          <div className={`subnav-row ${activeTemplateId==='draft'?'active':''}`} onClick={()=>setActiveTemplateId('draft')}>
            <span className="subnav-rune">◇</span>
            <span className="subnav-name">Current draft</span>
            <span className="subnav-count">unsaved</span>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'plan') {
    return (
      <div className="subnav">
        <div className="subnav-section">
          <div className="subnav-label"><span>Source</span></div>
          <div className="subnav-hint">Starting a new saga from…</div>
        </div>
        <div className="subnav-section">
          <div className="subnav-row active">
            <span className="subnav-rune">◇</span>
            <span className="subnav-name">Linear issue</span>
          </div>
          <div className="subnav-row">
            <span className="subnav-rune">◇</span>
            <span className="subnav-name">Freeform brief</span>
          </div>
          <div className="subnav-row muted">
            <span className="subnav-rune">◇</span>
            <span className="subnav-name">Jira issue</span>
          </div>
          <div className="subnav-row muted">
            <span className="subnav-rune">◇</span>
            <span className="subnav-name">Repo inspection</span>
          </div>
        </div>
        <div className="subnav-section scroll">
          <div className="subnav-label"><span>Apply workflow</span></div>
          <div className="subnav-hint">Pre-select a pipeline template…</div>
          {window.TEMPLATES.map(t => (
            <div key={t.id} className="subnav-row">
              <span className="subnav-rune">ᛃ</span>
              <span className="subnav-name">{t.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function Footer({ activeTab, activeSaga }) {
  return (
    <div className="footer">
      <div className="footer-left">
        <span>niuu · <code>tyr</code></span>
        <span className="sep">│</span>
        <span>page: <code>{activeTab}</code></span>
        {activeSaga && <><span className="sep">│</span><span>saga: <code>{activeSaga.identifier}</code></span></>}
      </div>
      <div className="footer-right">
        <span>api <code style={{ color:'#bae6fd' }}>● connected</code></span>
        <span className="sep">│</span>
        <span>sleipnir <code style={{ color:'#bae6fd' }}>● 12.1k evt/s</code></span>
        <span className="sep">│</span>
        <span>mímir <code style={{ color:'#bae6fd' }}>● idx 2.3M</code></span>
      </div>
    </div>
  );
}

Object.assign(window, { Rail, Topbar, Subnav, Footer, TABS });
