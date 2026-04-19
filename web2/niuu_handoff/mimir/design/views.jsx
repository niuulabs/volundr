/* global React */
// ─── Mímir — Search, Ravns, Lint, Ingest, Graph, Log ───────────────

const { useState:uSS, useMemo:uSM, useEffect:uSE, useRef:uSR } = React;

// ─────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────

function SearchView({ active, onOpenPage, onOpenRavn }) {
  const D = window.MIMIR_DATA;
  const [q, setQ] = uSS('compounding knowledge');
  const [mode, setMode] = uSS('hybrid');  // fts | semantic | hybrid

  const results = uSM(()=>{
    const lower = q.toLowerCase();
    const pool = active==='all' ? D.PAGES : D.PAGES.filter(p=>p.mounts.includes(active));
    if (!q.trim()) return [];
    return pool.map(p => {
      const fields = `${p.title} ${p.summary} ${p.path} ${(p.related||[]).join(' ')}`.toLowerCase();
      let score = 0;
      if (fields.includes(lower)) score += 1.0;
      for (const word of lower.split(/\s+/)) {
        if (word.length < 3) continue;
        const count = (fields.match(new RegExp(word,'g'))||[]).length;
        score += count * 0.2;
      }
      // semantic fake boost
      if (mode !== 'fts' && (p.type === 'entity' || p.type === 'topic')) score += 0.15;
      return { page: p, score };
    }).filter(r => r.score > 0).sort((a,b)=>b.score-a.score).slice(0, 20);
  }, [q, mode, active]);

  return (
    <div className="mm-home" style={{gridTemplateRows:'auto 1fr'}}>
      <div className="mm-search-head">
        <input className="q" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pages across mounts…" />
        <div className="mm-search-modes">
          {['fts','semantic','hybrid'].map(m => (
            <button key={m} className={mode===m?'active':''} onClick={()=>setMode(m)}>{m}</button>
          ))}
        </div>
        <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-muted)'}}>{results.length} results</span>
      </div>
      <div className="mimir-scroll">
        <div className="mm-search-results">
          {results.map(r => (
            <SearchResult key={r.page.path} page={r.page} q={q} score={r.score} onOpenPage={onOpenPage} />
          ))}
          {!q.trim() && <EmptyState title="Type a query" sub="hybrid search runs full-text + semantic across all selected mounts; provenance chips show which mount each result lives on." />}
          {q.trim() && results.length === 0 && <EmptyState title="No matches" sub="try broader terms or switch mount scope in the topbar." />}
        </div>
      </div>
    </div>
  );
}

function SearchResult({ page, q, score, onOpenPage }) {
  const D = window.MIMIR_DATA;
  const snippet = highlight(page.summary, q);
  return (
    <div className="mm-search-result" onClick={()=>onOpenPage(page.path)}>
      <div style={{display:'flex', alignItems:'baseline', gap:'var(--space-3)'}}>
        <div className="title" style={{flex:1}}>{page.title}</div>
        <div className="score">score {score.toFixed(2)}</div>
      </div>
      <div className="path">{page.path}</div>
      <div className="snippet" dangerouslySetInnerHTML={{__html: snippet}} />
      <div className="chips">
        <span className="mm-chip accent" style={{fontSize:9}}><span className="mm-chip-k">type</span> {page.type}</span>
        <span className={`mm-chip ${page.confidence==='high'?'ok':page.confidence==='medium'?'warn':'err'}`} style={{fontSize:9}}><span className="mm-chip-k">conf</span> {page.confidence}</span>
        {page.mounts.map(m=> <span key={m} className="mm-chip" style={{fontSize:9}}>{m}</span>)}
      </div>
    </div>
  );
}

function highlight(text, q) {
  if (!q.trim()) return text;
  const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return text.replace(new RegExp(`(${escaped})`,'gi'), '<mark>$1</mark>');
}

// ─────────────────────────────────────────────────────────────────
// WARDENS DIRECTORY & PROFILE (ravns bound as wardens of a mount)
// ─────────────────────────────────────────────────────────────────

function RavnsView({ active, ravnId, setRavnId, onOpenPage }) {
  const D = window.MIMIR_DATA;
  const ravns = active==='all' ? D.RAVNS : D.RAVNS.filter(r => r.bindings.some(b=>b.mount===active));
  const selected = ravnId ? D.RAVNS.find(r=>r.id===ravnId) : null;

  if (selected) {
    return <RavnProfile ravn={selected} back={()=>setRavnId(null)} onOpenPage={onOpenPage} />;
  }

  return (
    <div className="mimir-scroll">
      <div style={{padding:'var(--space-5) var(--space-5) 0'}}>
        <div className="mm-section-head">
          <h3>Wardens of {active==='all' ? 'any Mímir' : active}</h3>
          <span className="meta">{ravns.length} warden{ravns.length===1?'':'s'} · click to open profile</span>
        </div>
      </div>
      <div className="mm-ravn-grid">
        {ravns.map(r => (
          <div key={r.id} className="mm-ravn-card" onClick={()=>setRavnId(r.id)}>
            <div className="head">
              <div className="glyph">{r.name.slice(0,2)}</div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="name">{r.name}</span>
                  <span className={`mm-state-dot ${r.state}`} />
                </div>
                <div className="persona">{r.persona}</div>
              </div>
              <span className="mm-chip accent" style={{fontSize:9}}>{r.role}</span>
            </div>
            <div className="bio">{r.bio}</div>
            <div className="bindings">
              {r.bindings.map(b => (
                <span key={b.mount} className="bind-chip">
                  {b.mount}
                  <span className={`mode ${b.mode}`}>{b.mode}</span>
                </span>
              ))}
            </div>
            <div className="metrics">
              <div><strong>{r.pages_touched.toLocaleString()}</strong> pages touched</div>
              <div>last dream <strong>{r.last_dream}</strong></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RavnProfile({ ravn, back, onOpenPage }) {
  const D = window.MIMIR_DATA;
  const touchedPages = D.PAGES.filter(p=>p.updated_by===ravn.id);
  const recent = D.EVENTS.filter(e=>e.ravn===ravn.id);

  return (
    <div className="mimir-scroll">
      <div className="mm-ravn-profile">
        <div style={{marginBottom:'var(--space-4)'}}>
          <button className="mm-btn ghost" onClick={back}>← Wardens directory</button>
        </div>

        <div className="mm-ravn-hero">
          <div className="glyph-lg">{ravn.name.slice(0,2)}</div>
          <div style={{flex:1}}>
            <h1 className="name">{ravn.name}</h1>
            <div className="role">warden · {ravn.role} · persona: <span style={{color:'var(--brand-300)'}}>{ravn.persona}</span></div>
            <div style={{display:'flex', gap:8, marginTop:'var(--space-3)'}}>
              <span className="state-pill">
                <span className={`mm-state-dot ${ravn.state}`} />
                {ravn.state}
              </span>
              <span className="state-pill" style={{fontFamily:'var(--font-mono)'}}>
                tools: {ravn.tools.join(' · ')}
              </span>
            </div>
          </div>
        </div>

        <div className="mm-ravn-bio">{ravn.bio}</div>

        <div className="mm-ravn-grid-2">
          <div className="mm-ravn-panel">
            <h5>Mímir bindings</h5>
            {ravn.bindings.map(b => {
              const m = D.MOUNTS.find(x=>x.name===b.mount);
              return (
                <div key={b.mount} className="mm-bind-row">
                  <span className="name">{b.mount} <span style={{color:'var(--color-text-faint)',fontFamily:'var(--font-sans)',fontSize:10}}>· {m?.role}</span></span>
                  <span className={`mode ${b.mode}`}>{b.mode}</span>
                  <span className="mode" style={{color:'var(--color-text-faint)'}}>p={m?.priority}</span>
                </div>
              );
            })}
          </div>

          <div className="mm-ravn-panel">
            <h5>Areas of expertise</h5>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {ravn.expertise.map(e => <span key={e} className="mm-chip accent">{e}</span>)}
            </div>
            <div style={{marginTop:'var(--space-4)', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-muted)', lineHeight:1.7}}>
              <div><span style={{color:'var(--color-text-muted)'}}>pages touched</span> <span style={{color:'var(--color-text-primary)'}}>{ravn.pages_touched.toLocaleString()}</span></div>
              <div><span style={{color:'var(--color-text-muted)'}}>last dream</span> <span style={{color:'var(--color-text-primary)'}}>{ravn.last_dream}</span></div>
            </div>
          </div>

          <div className="mm-ravn-panel">
            <h5>Last dream cycle</h5>
            <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'var(--space-3)', fontFamily:'var(--font-mono)'}}>
              <div>
                <div style={{fontSize:22, color:'var(--status-emerald)'}}>{ravn.dream_last.pages_updated}</div>
                <div style={{fontSize:10, color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.07em'}}>pages updated</div>
              </div>
              <div>
                <div style={{fontSize:22, color:'var(--brand-300)'}}>{ravn.dream_last.entities_created}</div>
                <div style={{fontSize:10, color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.07em'}}>entities created</div>
              </div>
              <div>
                <div style={{fontSize:22, color:'var(--status-amber)'}}>{ravn.dream_last.lint_fixes}</div>
                <div style={{fontSize:10, color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.07em'}}>lint fixes</div>
              </div>
            </div>
            <div style={{marginTop:'var(--space-3)', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-faint)'}}>
              next run: tonight · emitted on mimir.dream.completed
            </div>
          </div>

          <div className="mm-ravn-panel">
            <h5>Recent activity</h5>
            <div style={{fontFamily:'var(--font-mono)', fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
              {recent.slice(0,6).map((e,i)=>(
                <div key={i} style={{display:'grid', gridTemplateColumns:'50px 60px 1fr', gap:'var(--space-2)', alignItems:'center'}}>
                  <span style={{color:'var(--color-text-faint)'}}>{e.t}</span>
                  <span style={{color: kColor(e.kind)}}>{e.kind}</span>
                  <span style={{color:'var(--color-text-secondary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:e.page?'pointer':'default'}} onClick={()=> e.page && onOpenPage(e.page)}>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{marginTop:'var(--space-5)'}}>
          <div className="mm-section-head">
            <h3>Pages last written by {ravn.name}</h3>
            <span className="meta">{touchedPages.length} of {ravn.pages_touched.toLocaleString()}</span>
          </div>
          <div style={{background:'var(--color-bg-secondary)', border:'1px solid var(--color-border-subtle)', borderRadius:'var(--radius-md)'}}>
            {touchedPages.map(p => (
              <div key={p.path} onClick={()=>onOpenPage(p.path)} style={{padding:'var(--space-3) var(--space-4)', borderBottom:'1px solid var(--color-border-subtle)', cursor:'pointer', display:'grid', gridTemplateColumns:'1fr auto auto', gap:'var(--space-3)', alignItems:'center'}} onMouseEnter={e=>e.currentTarget.style.background='var(--color-bg-tertiary)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
                <div>
                  <div style={{color:'var(--color-text-primary)'}}>{p.title}</div>
                  <div style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-muted)', marginTop:2}}>{p.path}</div>
                </div>
                <span className={`mm-chip ${p.confidence==='high'?'ok':p.confidence==='medium'?'warn':'err'}`} style={{fontSize:9}}>{p.confidence}</span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-faint)'}}>{p.updated_at}</span>
              </div>
            ))}
            {touchedPages.length === 0 && <div style={{padding:'var(--space-4)', color:'var(--color-text-muted)', fontSize:12, fontStyle:'italic'}}>no pages in the current scope</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function kColor(k) {
  return {write:'var(--status-emerald)', ingest:'var(--status-cyan)', lint:'var(--status-amber)', dream:'var(--status-purple)', query:'var(--color-text-muted)'}[k] || 'var(--color-text-muted)';
}

// ─────────────────────────────────────────────────────────────────
// LINT
// ─────────────────────────────────────────────────────────────────

function LintView({ active, onOpenPage }) {
  const D = window.MIMIR_DATA;
  const issues = active==='all' ? D.LINT_ISSUES : D.LINT_ISSUES.filter(i=>i.mount===active);

  const byCheck = uSM(()=>{
    const out = {};
    Object.keys(D.LINT_CHECKS).forEach(k => out[k] = 0);
    issues.forEach(i => out[i.id] = (out[i.id]||0) + 1);
    return out;
  }, [issues]);

  const [filter, setFilter] = uSS(null);
  const filtered = filter ? issues.filter(i=>i.id===filter) : issues;

  const bySeverity = {
    error:   issues.filter(i => D.LINT_CHECKS[i.id].severity === 'error').length,
    warning: issues.filter(i => D.LINT_CHECKS[i.id].severity === 'warning').length,
    info:    issues.filter(i => D.LINT_CHECKS[i.id].severity === 'info').length,
  };
  const autofixable = issues.filter(i => D.LINT_CHECKS[i.id].autofix).length;

  return (
    <div className="mm-home" style={{gridTemplateRows:'auto 1fr'}}>
      <div className="mm-kpi-strip" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
        <div className="mm-kpi warn">
          <span className="lbl">total issues</span>
          <span className="val">{issues.length}</span>
          <span className="sub">{active==='all'?'across all mounts':active}</span>
        </div>
        <div className="mm-kpi">
          <span className="lbl">errors</span>
          <span className="val" style={{color:bySeverity.error>0?'var(--status-red)':'var(--color-text-faint)'}}>{bySeverity.error}</span>
          <span className="sub">L09 timeline edits</span>
        </div>
        <div className="mm-kpi">
          <span className="lbl">warnings</span>
          <span className="val" style={{color:'var(--status-amber)'}}>{bySeverity.warning}</span>
          <span className="sub">L02 · L04 · L05 · L10 · L11 · L12</span>
        </div>
        <div className="mm-kpi accent">
          <span className="lbl">auto-fixable</span>
          <span className="val">{autofixable}</span>
          <span className="sub">L05 · L11 · L12</span>
        </div>
      </div>

      <div className="mm-lint-wrap">
        <div className="mm-lint-summary">
          <h4>Checks</h4>
          <div className={`mm-lint-check ${filter===null?'active':''}`} onClick={()=>setFilter(null)}>
            <span className="id">All</span>
            <span>every issue</span>
            <span className="cnt">{issues.length}</span>
          </div>
          {Object.entries(D.LINT_CHECKS).map(([id, check]) => (
            <div key={id} className={`mm-lint-check ${filter===id?'active':''}`} onClick={()=>setFilter(id)}>
              <div>
                <span className={`sev ${check.severity}`} />
                <span className="id">{id}</span>
              </div>
              <div style={{display:'flex', flexDirection:'column', gap:1, minWidth:0}}>
                <span style={{color:'var(--color-text-primary)', fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{check.name}</span>
                {check.autofix && <span className="autofix-badge">fix</span>}
              </div>
              <span className={`cnt ${byCheck[id]===0?'zero':''}`}>{byCheck[id]}</span>
            </div>
          ))}
        </div>

        <div>
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:'var(--space-3)'}}>
            <h3 style={{margin:0, fontSize:'var(--text-base)', fontWeight:600}}>
              {filter ? `${filter} — ${D.LINT_CHECKS[filter].name}` : 'All lint issues'}
              <span style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-muted)', marginLeft:8, fontWeight:400}}>· {filtered.length}</span>
            </h3>
            <div style={{display:'flex', gap:6}}>
              <button className="mm-btn">Run lint</button>
              <button className="mm-btn primary">Auto-fix ({autofixable})</button>
            </div>
          </div>

          {filter && (
            <div style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-muted)', padding:'var(--space-3)', background:'var(--color-bg-secondary)', border:'1px solid var(--color-border-subtle)', borderRadius:'var(--radius-md)', marginBottom:'var(--space-3)', lineHeight:1.6}}>
              <span style={{color:'var(--brand-300)'}}>{filter}</span> — {D.LINT_CHECKS[filter].desc}.{' '}
              {D.LINT_CHECKS[filter].autofix
                ? <span style={{color:'var(--status-emerald)'}}>auto-fixable via <code>mimir_lint --fix</code>.</span>
                : <span>requires human or warden intervention.</span>}
            </div>
          )}

          <div className="mm-lint-list">
            {filtered.map((issue, i) => (
              <div key={i} className="mm-lint-row">
                <div>
                  <span className="id">{issue.id}</span>
                  <span className={`sev ${D.LINT_CHECKS[issue.id].severity}`} style={{marginLeft:4, width:6, height:6, borderRadius:'50%', display:'inline-block', background: issue.id==='L09'?'var(--status-red)':D.LINT_CHECKS[issue.id].severity==='warning'?'var(--status-amber)':'var(--status-cyan)'}} />
                </div>
                <div style={{minWidth:0}}>
                  <div className="page" onClick={()=>onOpenPage(issue.page)} style={{cursor:'pointer'}}>
                    {issue.page}
                    <span className="mount">· {issue.mount}</span>
                  </div>
                  <div className="msg">{issue.msg}</div>
                </div>
                <div style={{display:'flex', gap:6}}>
                  {D.LINT_CHECKS[issue.id].autofix && <button className="mm-btn" style={{fontSize:11, padding:'3px 8px'}}>Fix</button>}
                  <button className="mm-btn ghost" style={{fontSize:11, padding:'3px 8px'}} onClick={()=>onOpenPage(issue.page)}>Open</button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <EmptyState title="Clean" sub="no issues for this check." />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// INGEST + ROUTING
// ─────────────────────────────────────────────────────────────────

function IngestView({ active }) {
  const D = window.MIMIR_DATA;
  const [title, setTitle] = uSS('Niuu SDD §5 — dispatch protocol');
  const [text, setText] = uSS('The dispatch protocol specifies how Týr hands a saga off to a raid…');
  const [path, setPath] = uSS('projects/niuu/dispatch.md');

  const resolved = uSM(()=>{
    for (const rule of D.ROUTING_RULES) {
      if (path.startsWith(rule.prefix)) return { matched: rule.prefix, mounts: rule.mounts };
    }
    return { matched: null, mounts: D.ROUTING_DEFAULT };
  }, [path]);

  const sources = active==='all' ? D.SOURCES : D.SOURCES.filter(s=>s.mount===active);

  return (
    <div className="mimir-scroll">
      <div className="mm-ingest-grid">
        <div>
          <div className="mm-section-head">
            <h3>Ingest a source</h3>
            <span className="meta">raw → compiled truth</span>
          </div>

          <div style={{display:'flex', flexDirection:'column', gap:'var(--space-3)'}}>
            <div>
              <label style={{fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--color-text-muted)', display:'block', marginBottom:4}}>Source title</label>
              <input className="mm-input" value={title} onChange={e=>setTitle(e.target.value)} />
            </div>
            <div>
              <label style={{fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--color-text-muted)', display:'block', marginBottom:4}}>Target page path</label>
              <input className="mm-input" value={path} onChange={e=>setPath(e.target.value)} />
              <div style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-muted)', marginTop:4}}>the path tells write-routing which mount(s) this goes to</div>
            </div>
            <div>
              <label style={{fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--color-text-muted)', display:'block', marginBottom:4}}>Raw content</label>
              <textarea className="mm-textarea" value={text} onChange={e=>setText(e.target.value)} rows={8} />
            </div>
            <div style={{display:'flex', gap:8, alignItems:'center'}}>
              <button className="mm-btn primary">Ingest</button>
              <button className="mm-btn">Fetch URL…</button>
              <button className="mm-btn ghost">Upload file…</button>
              <span style={{flex:1}} />
              <span style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-muted)'}}>Skögul (ingest-scout) will tag categories</span>
            </div>
          </div>
        </div>

        <div>
          <div className="mm-section-head">
            <h3>Write routing</h3>
            <span className="meta">path prefix → target mounts</span>
          </div>
          <div className="mm-routing">
            {D.ROUTING_RULES.map(rule => (
              <div key={rule.prefix} className={`row ${rule.prefix===resolved.matched?'hit':''}`} style={{background: rule.prefix===resolved.matched ? 'color-mix(in srgb, var(--status-emerald) 12%, transparent)' : undefined, borderRadius:'var(--radius-sm)', padding: rule.prefix===resolved.matched ? '5px 8px' : undefined}}>
                <span className="prefix">{rule.prefix === resolved.matched ? '▸ ' : '  '}{rule.prefix}</span>
                <div className="mounts">
                  {rule.mounts.map(m => <span key={m} className={`mpill ${rule.prefix===resolved.matched?'hit':''}`}>{m}</span>)}
                </div>
              </div>
            ))}
            <div className="row" style={{color:'var(--color-text-muted)', fontStyle:'italic'}}>
              <span className="prefix">  default</span>
              <div className="mounts">
                {D.ROUTING_DEFAULT.map(m => <span key={m} className="mpill">{m}</span>)}
              </div>
            </div>
          </div>

          <div style={{marginTop:'var(--space-4)', padding:'var(--space-3)', background:'color-mix(in srgb, var(--brand-300) 6%, transparent)', border:'1px solid color-mix(in srgb, var(--brand-300) 25%, transparent)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6}}>
            <div style={{color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', fontSize:10, marginBottom:6}}>Resolved for <span style={{color:'var(--brand-300)'}}>{path}</span></div>
            {resolved.matched
              ? <>matched prefix <span style={{color:'var(--brand-300)'}}>{resolved.matched}</span> → writes to {resolved.mounts.map((m,i)=><span key={m}><span style={{color:'var(--status-emerald)'}}>{m}</span>{i<resolved.mounts.length-1?', ':''}</span>)}</>
              : <>no prefix match — falls through to default ({resolved.mounts.join(', ')})</>
            }
          </div>

          <div className="mm-section-head" style={{marginTop:'var(--space-5)'}}>
            <h3>Recent sources</h3>
            <span className="meta">{sources.length} · across {active==='all'?'all mounts':active}</span>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:4}}>
            {sources.slice(0,8).map(s => (
              <div key={s.id} className="mm-source-pill">
                <span className="id">{s.id.slice(0,10)}</span>
                <span className="ttl" title={s.title}>{s.title}</span>
                <span style={{color:'var(--color-text-faint)', fontSize:10}}>{s.mount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// GRAPH
// ─────────────────────────────────────────────────────────────────

function GraphView({ active, onOpenPage }) {
  const D = window.MIMIR_DATA;
  const pages = active==='all' ? D.PAGES : D.PAGES.filter(p=>p.mounts.includes(active));
  const [hover, setHover] = uSS(null);
  const svgRef = uSR(null);
  const [size, setSize] = uSS({w:800, h:600});

  uSE(()=>{
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(()=>setSize({w:el.clientWidth, h:el.clientHeight}));
    ro.observe(el);
    return ()=>ro.disconnect();
  },[]);

  // Build simple force-free layout by category grouping + radial placement.
  const nodes = uSM(()=>{
    const cats = Array.from(new Set(pages.map(p=>p.category)));
    const cx = size.w/2, cy = size.h/2;
    const R = Math.min(size.w, size.h) * 0.36;
    return pages.map(p => {
      const catIdx = cats.indexOf(p.category);
      const catAngle = (catIdx / cats.length) * Math.PI * 2;
      const sameCat = pages.filter(q=>q.category===p.category);
      const inner = sameCat.indexOf(p);
      const innerAngle = (inner / Math.max(1, sameCat.length)) * 0.8 - 0.4;
      const r = R * (0.5 + 0.5 * (Math.abs(Math.sin(inner*2.1)) * 0.9 + 0.1));
      const x = cx + r * Math.cos(catAngle + innerAngle);
      const y = cy + r * Math.sin(catAngle + innerAngle);
      return { page: p, x, y, category: p.category };
    });
  }, [pages, size]);

  const edges = uSM(()=>{
    const byPath = new Map(nodes.map(n=>[n.page.path, n]));
    const srcMap = {};
    pages.forEach(p => p.source_ids.forEach(s => { srcMap[s] = srcMap[s] || []; srcMap[s].push(p.path); }));
    const out = [];
    Object.values(srcMap).forEach(group => {
      for (let i=0; i<group.length; i++) {
        for (let j=i+1; j<group.length; j++) {
          const a = byPath.get(group[i]), b = byPath.get(group[j]);
          if (a && b) out.push({a, b, kind: 'source'});
        }
      }
    });
    // related wikilink edges
    pages.forEach(p => (p.related||[]).forEach(slug => {
      const target = pages.find(q => q.path.includes(slug));
      const a = byPath.get(p.path), b = target && byPath.get(target.path);
      if (a && b && a !== b) out.push({a, b, kind:'related'});
    }));
    return out;
  }, [nodes, pages]);

  const colorFor = (cat) => ({
    entities:'var(--brand-400)', projects:'var(--status-cyan)', concepts:'var(--status-purple)',
    technical:'var(--status-emerald)', household:'var(--status-amber)', self:'var(--brand-200)',
    kanuck:'var(--status-orange)', meta:'var(--color-text-faint)',
  })[cat] || 'var(--color-text-muted)';

  return (
    <div className="mm-graph-wrap">
      <svg ref={svgRef} width="100%" height="100%" style={{display:'block'}}>
        <defs>
          <filter id="mmglow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g>
          {edges.map((e,i)=>(
            <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
              stroke={e.kind==='source' ? 'rgba(147,197,253,0.16)' : 'rgba(125,211,252,0.28)'}
              strokeWidth={e.kind==='source' ? 0.8 : 1.2}
              strokeDasharray={e.kind==='related' ? '4 3' : ''}/>
          ))}
        </g>
        <g>
          {nodes.map(n => (
            <g key={n.page.path} transform={`translate(${n.x},${n.y})`} style={{cursor:'pointer'}} onMouseEnter={()=>setHover(n)} onMouseLeave={()=>setHover(null)} onClick={()=>onOpenPage(n.page.path)}>
              <circle r={n.page.type==='entity' ? 6 : 4} fill={colorFor(n.category)} opacity={hover && hover!==n?0.35:1} filter={hover===n?'url(#mmglow)':''} stroke={n.page.confidence==='low'?'var(--status-red)':'transparent'} strokeWidth={0.8} />
              {hover===n && <text x={10} y={4} fontSize="10" fontFamily="var(--font-mono)" fill="var(--color-text-primary)" style={{paintOrder:'stroke',stroke:'var(--color-bg-primary)',strokeWidth:4}}>{n.page.title}</text>}
            </g>
          ))}
        </g>
      </svg>

      <div className="mm-graph-legend">
        <div style={{color:'var(--color-text-primary)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4}}>Category</div>
        {['entities','projects','concepts','technical','household','self','kanuck','meta'].map(c=>(
          <div key={c} className="row">
            <span className="swatch" style={{background: colorFor(c)}} />
            <span>{c}</span>
          </div>
        ))}
        <div style={{color:'var(--color-text-primary)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em', margin:'8px 0 4px'}}>Edges</div>
        <div className="row"><span style={{width:16, height:1, background:'rgba(147,197,253,0.5)'}} /><span>shared source</span></div>
        <div className="row"><span style={{width:16, height:0, borderTop:'1px dashed rgba(125,211,252,0.7)'}} /><span>wikilink</span></div>
      </div>

      <div style={{position:'absolute', right:'var(--space-4)', top:'var(--space-4)', padding:'var(--space-3)', background:'var(--ice-panel)', border:'1px solid var(--color-border-subtle)', borderRadius:'var(--radius-md)', backdropFilter:'blur(8px)', fontFamily:'var(--font-mono)', fontSize:11}}>
        <div style={{color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', fontSize:10, marginBottom:4}}>Graph</div>
        <div style={{color:'var(--color-text-primary)'}}>{nodes.length} pages · {edges.length} edges</div>
        <div style={{color:'var(--color-text-muted)', marginTop:2}}>{active==='all'?'all mounts':active}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOG
// ─────────────────────────────────────────────────────────────────

function LogView({ active, onOpenPage }) {
  const D = window.MIMIR_DATA;
  const events = active==='all' ? D.EVENTS : D.EVENTS.filter(e=>e.mount===active);
  return (
    <div className="mimir-scroll">
      <div className="mm-section-head" style={{padding:'var(--space-5) var(--space-5) 0'}}>
        <h3>Activity log</h3>
        <span className="meta">append-only · {events.length} entries · newest first</span>
      </div>
      <div className="mm-log">
        <div className="row" style={{color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', fontSize:9, fontWeight:500}}>
          <span>time</span><span>kind</span><span>mount</span><span>warden · message</span>
        </div>
        {events.map((e,i)=>(
          <div key={i} className="row">
            <span className="t">{e.t}</span>
            <span className="k" style={{color:kColor(e.kind)}}>{e.kind}</span>
            <span style={{color:'var(--brand-300)'}}>{e.mount}</span>
            <span>
              <span style={{color:'var(--color-text-primary)'}}>{e.ravn}</span>
              <span style={{color:'var(--color-text-faint)'}}> · </span>
              <span style={{color:'var(--color-text-secondary)', cursor:e.page?'pointer':'default'}} onClick={()=>e.page && onOpenPage(e.page)}>{e.msg}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function EmptyState({ title, sub }) {
  return (
    <div style={{padding:'var(--space-8)', textAlign:'center', color:'var(--color-text-muted)'}}>
      <div style={{fontSize:14, fontWeight:500, color:'var(--color-text-secondary)', marginBottom:4}}>{title}</div>
      <div style={{fontSize:12, maxWidth:380, margin:'0 auto', lineHeight:1.5}}>{sub}</div>
    </div>
  );
}

window.MimirViews = { SearchView, RavnsView, LintView, IngestView, GraphView, LogView };
