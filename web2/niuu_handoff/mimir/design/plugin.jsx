/* global React */
// ─── Mímir plugin — host wrapper for the Flokk shell ──────────────

const { useState:uMState, useEffect:uMEffect } = React;

function MimirPlugin_SubNav({ tab, setTab, active, ctx }) {
  const D = window.MIMIR_DATA;
  const pageCount = active==='all' ? D.PAGES.length : D.PAGES.filter(p=>p.mounts.includes(active)).length;
  const sourceCount = active==='all' ? D.SOURCES.length : D.SOURCES.filter(s=>s.mount===active).length;
  const lintCount = active==='all' ? D.LINT_ISSUES.length : D.LINT_ISSUES.filter(i=>i.mount===active).length;
  const ravnCount = active==='all' ? D.RAVNS.length : D.RAVNS.filter(r=>r.bindings.some(b=>b.mount===active)).length;

  const items = [
    { id:'home',   label:'Overview',   glyph:'◎', count:null },
    { id:'pages',  label:'Pages',      glyph:'❑', count:pageCount },
    { id:'search', label:'Search',     glyph:'⌕', count:null },
    { id:'graph',  label:'Graph',      glyph:'⌖', count:null },
    { id:'ravns',  label:'Wardens',    glyph:'ᚢ', count:ravnCount },
    { id:'ingest', label:'Ingest',     glyph:'↧', count:sourceCount },
    { id:'lint',   label:'Lint',       glyph:'⚠', count:lintCount },
    { id:'log',    label:'Log',        glyph:'≡', count:null },
  ];

  const setActive = (m) => ctx.setTweak('activeMount', m);

  return (
    <div className="mm-subnav">
      <div className="mm-subnav-block">
        <div className="mm-subnav-label">Mount focus</div>
        <div className="mm-mount-picker">
          <button className={`mm-mount-row ${active==='all'?'active':''}`} onClick={()=>setActive('all')}>
            <span className="mm-mount-name">All mounts</span>
            <span className="mm-mount-count">{D.MOUNTS.length}</span>
          </button>
          {D.MOUNTS.map(m => (
            <button key={m.name} className={`mm-mount-row ${active===m.name?'active':''}`} onClick={()=>setActive(m.name)}>
              <span className={`mm-mount-dot ${m.status!=='healthy'?m.status:''}`} />
              <span className="mm-mount-name">{m.name}</span>
              <span className="mm-mount-role">{m.role}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mm-subnav-block">
        <div className="mm-subnav-label">Navigation</div>
        {items.map(it => (
          <button key={it.id} className={`mm-subnav-btn ${tab===it.id?'active':''}`} onClick={()=>setTab(it.id)}>
            <span className="kbd-glyph" style={{width:14, textAlign:'center'}}>{it.glyph}</span>
            <span className="grow">{it.label}</span>
            {it.count !== null && <span className="count">{it.count}</span>}
          </button>
        ))}
      </div>
      <div className="mm-subnav-block">
        <div className="mm-subnav-label">Quick filters</div>
        <button className="mm-subnav-btn" onClick={()=>setTab('lint')}>
          <span className="kbd-glyph" style={{color:'var(--status-red)'}}>●</span>
          <span className="grow">Errors</span>
          <span className="count">{D.LINT_ISSUES.filter(i=>D.LINT_CHECKS[i.id].severity==='error').length}</span>
        </button>
        <button className="mm-subnav-btn">
          <span className="kbd-glyph" style={{color:'var(--status-amber)'}}>⚑</span>
          <span className="grow">Flagged pages</span>
          <span className="count">{D.PAGES.filter(p=>p.flagged).length}</span>
        </button>
        <button className="mm-subnav-btn">
          <span className="kbd-glyph" style={{color:'var(--color-text-faint)'}}>◇</span>
          <span className="grow">Low confidence</span>
          <span className="count">{D.PAGES.filter(p=>p.confidence==='low').length}</span>
        </button>
      </div>
      <div className="mm-subnav-block">
        <div className="mm-subnav-label">Wardens</div>
        {D.RAVNS.filter(r => active==='all' || r.bindings.some(b=>b.mount===active)).slice(0,6).map(r => (
          <button key={r.id} className="mm-subnav-btn" onClick={()=>ctx.setTweak('ravnId', r.id) || setTab('ravns')}>
            <span className="kbd-glyph" style={{color:'var(--brand-300)', fontFamily:'var(--font-mono)', fontWeight:600}}>{r.name.slice(0,2)}</span>
            <span className="grow">{r.name}</span>
            <span className={`mm-state-dot ${r.state}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function MimirPlugin_TopbarRight({ active, tab }) {
  const D = window.MIMIR_DATA;
  const pageCount = active==='all' ? D.PAGES.length : D.PAGES.filter(p=>p.mounts.includes(active)).length;
  const lintCount = active==='all' ? D.LINT_ISSUES.length : D.LINT_ISSUES.filter(i=>i.mount===active).length;
  const ravnCount = active==='all' ? D.RAVNS.length : D.RAVNS.filter(r=>r.bindings.some(b=>b.mount===active)).length;
  return (
    <div className="mm-topbar-stats">
      <span className="mm-topbar-stat"><span className="k">mount</span><strong>{active}</strong></span>
      <span className="mm-topbar-sep">·</span>
      <span className="mm-topbar-stat"><span className="k">pages</span><strong>{pageCount.toLocaleString()}</strong></span>
      <span className="mm-topbar-sep">·</span>
      <span className="mm-topbar-stat"><span className="k">wardens</span><strong>{ravnCount}</strong></span>
      <span className="mm-topbar-sep">·</span>
      <span className="mm-topbar-stat"><span className="k">lint</span><strong style={{color: lintCount ? 'var(--status-amber)' : 'inherit'}}>{lintCount}</strong></span>
    </div>
  );
}

function MimirPlugin_Render({ ctx }) {
  const D = window.MIMIR_DATA;
  const active = ctx.tweaks.activeMount || 'all';
  const tab = ctx.tweaks.tab || 'home';
  const pagePath = ctx.tweaks.pagePath || null;
  const ravnId = ctx.tweaks.ravnId || null;

  const setTab = (t) => ctx.setTweak('tab', t);
  const setActive = (m) => ctx.setTweak('activeMount', m);
  const onOpenPage = (path) => { ctx.setTweak('pagePath', path); ctx.setTweak('tab','pages'); };
  const onOpenRavn = (id) => { ctx.setTweak('ravnId', id); ctx.setTweak('tab','ravns'); };

  switch (tab) {
    case 'home':
      return <window.MimirHome active={active} setActive={setActive} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} density={ctx.tweaks.density} />;
    case 'pages':
      return <window.PagesView active={active} pagePath={pagePath} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} readerLayout={ctx.tweaks.readerLayout||'structured'} />;
    case 'search':
      return <window.MimirViews.SearchView active={active} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} />;
    case 'graph':
      return <window.MimirViews.GraphView active={active} onOpenPage={onOpenPage} />;
    case 'ravns':
      return <window.MimirViews.RavnsView active={active} ravnId={ravnId} setRavnId={(id)=>ctx.setTweak('ravnId', id)} onOpenPage={onOpenPage} />;
    case 'ingest':
      return <window.MimirViews.IngestView active={active} />;
    case 'lint':
      return <window.MimirViews.LintView active={active} onOpenPage={onOpenPage} />;
    case 'log':
      return <window.MimirViews.LogView active={active} onOpenPage={onOpenPage} />;
    default:
      return <window.MimirHome active={active} setActive={setActive} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} />;
  }
}

function MimirPlugin_Topbar({ ctx }) {
  const active = ctx.tweaks.activeMount || 'all';
  const tab = ctx.tweaks.tab || 'home';
  return <MimirPlugin_TopbarRight active={active} tab={tab} />;
}

function MimirPlugin_SubnavWrap({ ctx }) {
  const active = ctx.tweaks.activeMount || 'all';
  const tab = ctx.tweaks.tab || 'home';
  return <MimirPlugin_SubNav tab={tab} setTab={(t)=>ctx.setTweak('tab', t)} active={active} ctx={ctx} />;
}

// Plugin descriptor (matches Flokk contract)
window.MimirPlugin = {
  id: 'mimir',
  rune: 'ᛗ',
  title: 'Flokk · Mímir',
  subtitle: 'compounding knowledge · pages, ravens, lint',
  render: (ctx) => <MimirPlugin_Render ctx={ctx} />,
  subnav: (ctx) => <MimirPlugin_SubnavWrap ctx={ctx} />,
  topbarRight: (ctx) => <MimirPlugin_Topbar ctx={ctx} />,
};
