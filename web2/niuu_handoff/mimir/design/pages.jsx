/* global React */
// ─── Mímir — Pages (tree + reader w/ two zones) ────────────────────

const { useState:usePState, useMemo:usePMemo } = React;

function PagesView({ active, pagePath, onOpenPage, onOpenRavn, readerLayout }) {
  const D = window.MIMIR_DATA;

  const visiblePages = usePMemo(()=>{
    if (active === 'all') return D.PAGES;
    return D.PAGES.filter(p => p.mounts.includes(active));
  }, [active]);

  const tree = usePMemo(()=> D.buildTree(visiblePages), [visiblePages]);
  const page = D.PAGES.find(p=>p.path===pagePath) || visiblePages[0];

  return (
    <div className="mimir-root triple" style={{height:'100%'}}>
      <div className="mimir-sidepanel">
        <div style={{padding:'var(--space-3) var(--space-4)', borderBottom:'1px solid var(--color-border-subtle)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--color-text-muted)'}}>Pages</div>
          <div style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-faint)'}}>{visiblePages.length}</div>
        </div>
        <div className="mimir-scroll">
          <Tree node={tree} depth={0} pagePath={page?.path} onOpenPage={onOpenPage} />
        </div>
      </div>

      <div className="mimir-body">
        {page && (readerLayout === 'split'
          ? <PageReaderSplit page={page} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} />
          : <PageReader page={page} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} />
        )}
      </div>

      <div className="mimir-rightpanel">
        {page && <PageMeta page={page} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} />}
      </div>
    </div>
  );
}

// ── Tree ──────────────────────────────────────────────────────────

function Tree({ node, depth, pagePath, onOpenPage }) {
  const childDirs = Object.values(node.children);
  const sortedPages = [...node.pages].sort((a,b)=>a.title.localeCompare(b.title));

  return (
    <div className="mm-tree" style={{paddingLeft: depth===0 ? 'var(--space-2)' : 0}}>
      {childDirs.map(c => <TreeDir key={c.name} node={c} depth={depth+1} pagePath={pagePath} onOpenPage={onOpenPage} />)}
      {sortedPages.map(p => (
        <div key={p.path} className={`mm-tree-node ${p.path===pagePath?'active':''}`} onClick={()=>onOpenPage(p.path)} style={{paddingLeft: 14 + depth*12}}>
          <span className={`conf-dot`} style={{background: confDot(p.confidence)}} />
          <span style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.path.split('/').pop().replace('.md','')}</span>
          {p.flagged && <span className="flag" title="flagged for re-synthesis">⚑</span>}
        </div>
      ))}
    </div>
  );
}

function TreeDir({ node, depth, pagePath, onOpenPage }) {
  const [open, setOpen] = usePState(depth <= 2);
  const childCount = countPages(node);
  return (
    <div>
      <div className="mm-tree-node folder" onClick={()=>setOpen(!open)} style={{paddingLeft: 4 + (depth-1)*12}}>
        <span className="caret">{open?'▾':'▸'}</span>
        <span>{node.name}/</span>
        <span className="count">{childCount}</span>
      </div>
      {open && <Tree node={node} depth={depth} pagePath={pagePath} onOpenPage={onOpenPage} />}
    </div>
  );
}

function countPages(node) {
  let c = node.pages.length;
  for (const ch of Object.values(node.children)) c += countPages(ch);
  return c;
}

function confDot(c) {
  if (c==='high') return 'var(--status-emerald)';
  if (c==='medium') return 'var(--status-amber)';
  if (c==='low') return 'var(--status-red)';
  return 'var(--color-text-faint)';
}

// ── Reader — structured two-zone ──────────────────────────────────

function PageReader({ page, onOpenPage, onOpenRavn }) {
  const D = window.MIMIR_DATA;
  const ravn = D.RAVNS.find(r=>r.id===page.updated_by);
  const body = page.content || inferBody(page);
  const parts = page.path.split('/');

  return (
    <div className="mimir-scroll">
      <div className="mm-page-wrap">
        <div className="mm-page-crumbs">
          {parts.slice(0,-1).map((p,i)=> <React.Fragment key={i}><span>{p}</span><span className="sep">/</span></React.Fragment>)}
          <span className="leaf">{parts[parts.length-1]}</span>
        </div>

        <h1 className="mm-page-title">{page.title}</h1>
        <p className="mm-page-summary">{page.summary}</p>

        <div className="mm-action-bar">
          <button className="mm-btn"><span>✎</span> Edit compiled truth</button>
          <button className="mm-btn">⚑ Flag for re-synthesis</button>
          <button className="mm-btn">Promote confidence</button>
          <button className="mm-btn ghost">Open raw</button>
          <div style={{flex:1}} />
          <button className="mm-btn ghost" style={{fontFamily:'var(--font-mono)',fontSize:11}}>⌘K cite this</button>
        </div>

        <div className="mm-chip-bar">
          <span className="mm-chip accent"><span className="mm-chip-k">type</span> {page.type}</span>
          {page.entity_type && <span className="mm-chip"><span className="mm-chip-k">entity</span> {page.entity_type}</span>}
          <span className={`mm-chip ${page.confidence==='high'?'ok':page.confidence==='medium'?'warn':'err'}`}>
            <span className="mm-chip-k">confidence</span> {page.confidence}
          </span>
          {page.mounts.map(m => <span key={m} className="mm-chip mount"><span className="mm-chip-k">mount</span> {m}</span>)}
          <span className="mm-chip"><span className="mm-chip-k">updated</span> {page.updated_at}</span>
          {ravn && <span className="mm-chip" onClick={()=>onOpenRavn(ravn.id)} style={{cursor:'pointer'}}><span className="mm-chip-k">by</span> {ravn.name}</span>}
          {page.flagged && <span className="mm-chip warn"><span className="mm-chip-k">⚑</span> re-synthesis</span>}
        </div>

        <div className="mm-zone">
          <div className="mm-zone-head">
            <span className="mm-zone-title">Compiled Truth</span>
            <span className="mm-zone-sub">rewritable — synthesised by ravens</span>
          </div>

          {body.keyFacts && (<>
            <h4>Key facts</h4>
            <ul>{body.keyFacts.map((f,i)=><li key={i}>{f}</li>)}</ul>
          </>)}

          {body.relationships && body.relationships.length > 0 && (<>
            <h4>Relationships</h4>
            <ul>
              {body.relationships.map((r,i)=>(
                <li key={i}>
                  <span className={`mm-wikilink ${isBroken(r.slug)?'broken':''}`} onClick={()=>jumpToSlug(r.slug, onOpenPage)}>[[{r.slug}]]</span>
                  <span style={{color:'var(--color-text-secondary)'}}> — {r.note}</span>
                </li>
              ))}
            </ul>
          </>)}

          {body.assessment && (<>
            <h4>Assessment</h4>
            <p>{body.assessment}</p>
          </>)}
        </div>

        <div className="mm-zone">
          <div className="mm-zone-head">
            <span className="mm-zone-title">Timeline</span>
            <span className="mm-zone-sub">append-only — {body.timeline?.length||0} entries</span>
          </div>
          <div className="mm-timeline">
            {(body.timeline || []).map((t,i)=>(
              <div key={i} className="mm-tl-entry">
                <div className="mm-tl-date">{t.date}</div>
                <div className="mm-tl-text">{t.note}</div>
                <div className="mm-tl-src">[Source: {t.source}]</div>
              </div>
            ))}
            {(!body.timeline || body.timeline.length===0) && (
              <div style={{color:'var(--color-text-muted)',fontSize:12,fontStyle:'italic', padding:'var(--space-2) 0'}}>no timeline entries yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reader — split pane (markdown left, raw sources right) ────────

function PageReaderSplit({ page, onOpenPage, onOpenRavn }) {
  return (
    <div style={{display:'grid', gridTemplateColumns:'1.2fr 1fr', height:'100%', overflow:'hidden'}}>
      <div className="mimir-scroll" style={{borderRight:'1px solid var(--color-border-subtle)'}}>
        <PageReader page={page} onOpenPage={onOpenPage} onOpenRavn={onOpenRavn} />
      </div>
      <div className="mimir-scroll" style={{background:'var(--color-bg-secondary)'}}>
        <RawSources page={page} />
      </div>
    </div>
  );
}

function RawSources({ page }) {
  const D = window.MIMIR_DATA;
  const sources = D.SOURCES.filter(s => page.source_ids.includes(s.id));
  return (
    <div style={{padding:'var(--space-4) var(--space-5)'}}>
      <div style={{fontSize:10, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--color-text-muted)', marginBottom:'var(--space-3)'}}>Raw sources backing this page</div>
      {sources.map(s=>(
        <div key={s.id} style={{background:'var(--color-bg-primary)', border:'1px solid var(--color-border-subtle)', borderRadius:'var(--radius-md)', padding:'var(--space-3)', marginBottom:'var(--space-2)', fontFamily:'var(--font-mono)', fontSize:11}}>
          <div style={{display:'flex', gap:'var(--space-2)', alignItems:'baseline'}}>
            <span style={{color:'var(--brand-300)'}}>{s.id}</span>
            <span style={{color:'var(--color-text-faint)'}}>·</span>
            <span style={{color:'var(--color-text-primary)', fontFamily:'var(--font-sans)', fontSize:13, flex:1}}>{s.title}</span>
          </div>
          <div style={{color:'var(--color-text-muted)', marginTop:4}}>{s.type} · {s.origin}</div>
          <div style={{color:'var(--color-text-faint)', marginTop:2, fontSize:10}}>ingested {s.ingested} · by {s.ravn} · mount={s.mount}</div>
        </div>
      ))}
      {sources.length === 0 && <div style={{color:'var(--color-text-muted)',fontSize:12,fontStyle:'italic'}}>no sources attributed yet</div>}
    </div>
  );
}

// ── Right-hand meta pane ──────────────────────────────────────────

function PageMeta({ page, onOpenPage, onOpenRavn }) {
  const D = window.MIMIR_DATA;
  const ravn = D.RAVNS.find(r=>r.id===page.updated_by);
  const sources = D.SOURCES.filter(s=>page.source_ids.includes(s.id));
  const backlinks = D.PAGES.filter(p => p.related && p.related.some(slug => page.path.includes(slug)));

  return (
    <>
      <div className="mm-meta-head">
        <h4>Page detail</h4>
        <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--color-text-faint)'}}>{(page.size/1024).toFixed(1)} kB</span>
      </div>

      <div className="mm-meta-block">
        <h5>Provenance</h5>
        <div className="mm-meta-row"><span className="k">path</span><span className="v">{page.path}</span></div>
        <div className="mm-meta-row"><span className="k">type</span><span className="v">{page.type}</span></div>
        <div className="mm-meta-row"><span className="k">confidence</span><span className="v"><ConfBarInline level={page.confidence} /></span></div>
        <div className="mm-meta-row"><span className="k">updated</span><span className="v">{page.updated_at}</span></div>
        {ravn && <div className="mm-meta-row"><span className="k">by</span><span className="v" style={{color:'var(--brand-300)', cursor:'pointer'}} onClick={()=>onOpenRavn(ravn.id)}>{ravn.name}</span></div>}
      </div>

      <div className="mm-meta-block">
        <h5>Lives on</h5>
        {page.mounts.map(name => {
          const m = D.MOUNTS.find(x=>x.name===name);
          return (
            <div key={name} style={{display:'flex', alignItems:'center', gap:8, padding:'3px 0', fontFamily:'var(--font-mono)', fontSize:11}}>
              <span className={`mm-state-dot ${m?.status==='healthy'?'working':'degraded'}`} />
              <span style={{color:'var(--color-text-primary)'}}>{name}</span>
              <span style={{color:'var(--color-text-faint)'}}>·</span>
              <span style={{color:'var(--color-text-muted)'}}>{m?.role}</span>
              <span style={{marginLeft:'auto', color:'var(--color-text-faint)', fontSize:10}}>p={m?.priority}</span>
            </div>
          );
        })}
      </div>

      <div className="mm-meta-block">
        <h5>Sources ({sources.length})</h5>
        {sources.map(s => (
          <div key={s.id} className="mm-source-pill">
            <span className="id">{s.id.slice(0,10)}</span>
            <span className="ttl" title={s.title}>{s.title}</span>
          </div>
        ))}
        {sources.length === 0 && <div style={{color:'var(--color-text-faint)', fontSize:11, fontStyle:'italic'}}>no sources</div>}
      </div>

      {backlinks.length > 0 && (
        <div className="mm-meta-block">
          <h5>Backlinks ({backlinks.length})</h5>
          {backlinks.slice(0,6).map(p => (
            <div key={p.path} onClick={()=>onOpenPage(p.path)} style={{padding:'4px 0', fontSize:12, color:'var(--color-text-secondary)', cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.color='var(--color-text-primary)'} onMouseLeave={e=>e.currentTarget.style.color='var(--color-text-secondary)'}>
              ↩ {p.title}
            </div>
          ))}
        </div>
      )}

      <div className="mm-meta-block" style={{flex:1, overflow:'auto'}}>
        <h5>Recent activity</h5>
        {D.EVENTS.filter(e=>e.page===page.path).slice(0,8).map((e,i)=>(
          <div key={i} style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-secondary)', padding:'3px 0'}}>
            <span style={{color:'var(--color-text-faint)'}}>{e.t}</span>
            <span style={{color:'var(--color-text-muted)', margin:'0 6px'}}>·</span>
            <span style={{color:'var(--status-cyan)'}}>{e.kind}</span>
            <span style={{color:'var(--color-text-muted)', margin:'0 6px'}}>·</span>
            <span>{e.ravn}</span>
          </div>
        ))}
        {D.EVENTS.filter(e=>e.page===page.path).length === 0 && (
          <div style={{color:'var(--color-text-faint)', fontSize:11, fontStyle:'italic'}}>quiet</div>
        )}
      </div>
    </>
  );
}

function ConfBarInline({ level }) {
  const color = level==='high'?'var(--status-emerald)':level==='medium'?'var(--status-amber)':'var(--status-red)';
  const pct = level==='high'?100:level==='medium'?60:25;
  return (
    <span style={{display:'inline-grid', gridTemplateColumns:'40px auto', gap:6, alignItems:'center'}}>
      <span style={{height:4, background:'var(--color-bg-elevated)', borderRadius:2, position:'relative', display:'inline-block'}}>
        <span style={{position:'absolute', inset:0, width:`${pct}%`, background:color, borderRadius:2}} />
      </span>
      <span style={{color}}>{level}</span>
    </span>
  );
}

// ── helpers ───────────────────────────────────────────────────────

function isBroken(slug) {
  return slug === 'component-ravn' || slug === 'technology-aluminium-6061';
}
function jumpToSlug(slug, onOpenPage) {
  const D = window.MIMIR_DATA;
  const p = D.PAGES.find(p => p.path.includes(slug));
  if (p) onOpenPage(p.path);
}
function inferBody(page) {
  // fallback body for pages that didn't ship content
  return {
    keyFacts: [ page.summary ],
    relationships: (page.related || []).map(slug => ({slug, note: 'related entity'})),
    assessment: `Compiled truth pending next dream cycle. Confidence: ${page.confidence}.`,
    timeline: [
      { date: page.updated_at.slice(0,10), note: 'Last write by ' + page.updated_by + '.', source: page.updated_by + ', mimir, ' + page.updated_at.slice(0,10) },
    ],
  };
}

window.PagesView = PagesView;
