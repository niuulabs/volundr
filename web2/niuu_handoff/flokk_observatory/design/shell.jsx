/* global React */
// ─── Flokk Observatory shell — pluggable tabs & drawer ─────────

const { useState, useCallback, useMemo, useEffect } = React;

// ── Plugin registry ──────────────────────────────────────────
// In a real integration, TyrPlugin / VolundrPlugin / etc. would each
// export an object of this shape. Flokk imports them and passes them
// into <Shell>. Here we define ObservatoryPlugin + stubs for siblings.

function makePlaceholder(title, subtitle, description) {
  return function Placeholder() {
    return (
      <div style={{padding:'var(--space-6)', height:'100%', overflow:'auto'}}>
        <div style={{maxWidth:680}}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--color-text-muted)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8}}>{subtitle}</div>
          <h2 style={{margin:'0 0 var(--space-3)',fontSize:'var(--text-2xl)',fontWeight:600,letterSpacing:'-0.02em'}}>{title}</h2>
          <p style={{color:'var(--color-text-secondary)',fontSize:'var(--text-sm)',lineHeight:1.6}}>{description}</p>
          <div style={{marginTop:'var(--space-5)',padding:'var(--space-4)',border:'1px dashed var(--color-border-subtle)',borderRadius:'var(--radius-md)',fontFamily:'var(--font-mono)',fontSize:11,color:'var(--color-text-muted)'}}>
            <strong style={{color:'var(--brand-300)'}}>plugin stub</strong> · served by the shell's plugin registry.
            The real surface lives in the sibling plugin repo and is imported here once that package ships.
          </div>
        </div>
      </div>
    );
  };
}

// ── Shell ─────────────────────────────────────────────────────

function Shell({ plugins, registry, setRegistry }) {
  const [activeId, setActiveId] = useState(() => localStorage.getItem('flokk.active') || 'observatory');
  useEffect(()=>{ localStorage.setItem('flokk.active', activeId); }, [activeId]);
  const active = plugins.find(p=>p.id===activeId) || plugins[0];

  // Tweaks
  const [tweaks, setTweaks] = useState(() => window.TWEAKS || {});
  const [tweaksOn, setTweaksOn] = useState(false);
  useEffect(()=>{
    const onMsg = (e)=>{
      if (e.data?.type === '__activate_edit_mode') setTweaksOn(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOn(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({type:'__edit_mode_available'}, '*');
    return ()=>window.removeEventListener('message', onMsg);
  },[]);
  const setTweak = useCallback((key, value)=>{
    setTweaks(t=>{
      const next = {...t, [key]:value};
      window.parent.postMessage({type:'__edit_mode_set_keys', edits:{[key]:value}}, '*');
      return next;
    });
  },[]);

  const ctx = { registry, setRegistry, tweaks, setTweak };

  return (
    <div className="app">
      {/* Rail */}
      <aside className="rail">
        <div className="rail-brand" title="Flokk">{'ᚠ'}</div>
        {plugins.map(p=>(
          <button key={p.id}
            className={`rail-item ${activeId===p.id?'active':''}`}
            title={`${p.title} · ${p.subtitle}`}
            onClick={()=>setActiveId(p.id)}>
            {p.rune}
          </button>
        ))}
        <div className="rail-spacer" />
        <div className="rail-foot">v7.2</div>
      </aside>

      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">
            <span className="rune-mark">{active.rune}</span>
            <h1>{active.title}</h1>
            <span className="module-sub">{active.subtitle}</span>
          </div>
          {active.tabs && (
            <div className="tabs">
              {active.tabs.map(t=>(
                <button key={t.id} className={`tab ${active.activeTab===t.id?'active':''}`}
                  onClick={()=>active.onTab?.(t.id)}>
                  <span className="tab-rune">{t.rune}</span>{t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="topbar-right">
          {active.topbarRight?.(ctx)}
          <div className="live-badge"><span className="live-dot"/>LIVE</div>
          <div className="topbar-sep"/>
          <div className="topbar-meta"><span>◷</span> <strong>{new Date().toISOString().slice(11,19)}</strong>Z</div>
          <div className="topbar-sep"/>
          <div className="topbar-meta"><span className="kbd">⌘K</span></div>
        </div>
      </header>

      {/* Subnav (plugin-owned) — only render the column if the plugin supplies one */}
      {active.subnav && <nav className="subnav">{active.subnav(ctx)}</nav>}

      {/* Content */}
      <main className="content">
        {active.render(ctx)}
        {tweaksOn && <TweaksPanel tweaks={tweaks} setTweak={setTweak} />}
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-left">
          <code>plugin:{active.id}</code>
          <span className="sep">·</span>
          <span>niuu.world</span>
          <span className="sep">·</span>
          <span>registry v{registry.version}</span>
        </div>
        <div className="footer-right">
          <span>⊙ drag · scroll zoom · click to select</span>
          <span className="sep">·</span>
          <span>{plugins.length} plugins loaded</span>
        </div>
      </footer>
    </div>
  );
}

function TweaksPanel({ tweaks, setTweak }) {
  const Seg = ({keyName, options}) => (
    <div className="tweak-seg">
      {options.map(o=><button key={o.value} className={tweaks[keyName]===o.value?'on':''} onClick={()=>setTweak(keyName,o.value)}>{o.label}</button>)}
    </div>
  );
  const Switch = ({keyName}) => (
    <button className={`switch ${tweaks[keyName]?'on':''}`} onClick={()=>setTweak(keyName,!tweaks[keyName])} />
  );
  return (
    <div className="tweaks">
      <div className="tweaks-head"><h3>Tweaks</h3></div>
      <div className="tweak-row"><label>Event log</label><Switch keyName="eventLog"/></div>
      <div className="tweak-row"><label>Connection legend</label><Switch keyName="legend"/></div>
      <div className="tweak-row"><label>Minimap</label><Switch keyName="minimap"/></div>
      <div className="tweak-row"><label>Density</label>
        <Seg keyName="density" options={[{label:'cozy',value:'cozy'},{label:'normal',value:'normal'},{label:'dense',value:'dense'}]}/>
      </div>
    </div>
  );
}

window.FlokkShell = { Shell, makePlaceholder };
