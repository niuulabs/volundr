/* global React */
// ─── Mímir — Home (mount cards + federated activity) ──────────────

const { useState:useStateH, useMemo:useMemoH, useEffect:useEffectH } = React;

function MimirHome({ active, setActive, onOpenPage, onOpenRavn, density }) {
  const D = window.MIMIR_DATA;
  const { MountChip } = window.MIMIR_ATOMS;

  const selected = active === 'all' ? null : D.MOUNTS.find(m=>m.name===active);
  const mounts = active === 'all' ? D.MOUNTS : [selected].filter(Boolean);

  const totalPages = mounts.reduce((a,m)=>a+m.pages,0);
  const totalSources = mounts.reduce((a,m)=>a+m.sources,0);
  const totalLint = mounts.reduce((a,m)=>a+m.lint_issues,0);
  const wardenCount = D.RAVNS.filter(r =>
    active === 'all' ? true : r.bindings.some(b=>b.mount===active)
  ).length;

  const feed = useMemoH(()=> {
    if (active === 'all') return D.EVENTS;
    return D.EVENTS.filter(e => e.mount === active);
  }, [active]);

  return (
    <div className="mm-home">
      <div className="mm-kpi-strip">
        <div className="mm-kpi accent">
          <span className="lbl">pages</span>
          <span className="val">{totalPages.toLocaleString()}</span>
          <span className="sub">{active==='all' ? `across ${D.MOUNTS.length} mounts` : `in ${active}`}</span>
        </div>
        <div className="mm-kpi">
          <span className="lbl">sources</span>
          <span className="val">{totalSources.toLocaleString()}</span>
          <span className="sub">raw ingested</span>
        </div>
        <div className="mm-kpi">
          <span className="lbl">wardens</span>
          <span className="val">{wardenCount}</span>
          <span className="sub">ravns bound to mounts</span>
        </div>
        <div className="mm-kpi warn">
          <span className="lbl">lint issues</span>
          <span className="val">{totalLint}</span>
          <span className="sub">{totalLint > 0 ? `${D.LINT_ISSUES.filter(i=>D.LINT_CHECKS[i.id].autofix).length} auto-fixable` : 'clean'}</span>
        </div>
        <div className="mm-kpi">
          <span className="lbl">last write</span>
          <span className="val" style={{fontSize:'var(--text-base)'}}>{mounts[0]?.last_write || '—'}</span>
          <span className="sub">{active==='all' ? 'newest across mounts' : 'on this mount'}</span>
        </div>
      </div>

      <div className="mm-home-cols">
        <div className="mm-home-col">
          <div className="mm-section-head">
            <h3>{active === 'all' ? 'Mounted instances' : selected?.host}</h3>
            <span className="meta">{active === 'all' ? 'click to focus a single mount' : 'configuration'}</span>
          </div>

          {active === 'all' ? (
            <div className="mm-mount-grid">
              {D.MOUNTS.map(m => (
                <div key={m.name} className="mm-mount-card" onClick={()=>setActive(m.name)}>
                  <div className="head">
                    <span className={`mm-state-dot ${m.status==='healthy'?'working':'degraded'}`} />
                    <span className="name">{m.name}</span>
                    <span className={`role ${m.role}`}>{m.role}</span>
                    <span style={{marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-faint)'}}>p={m.priority}</span>
                  </div>
                  <div className="host">{m.host}</div>
                  <div className="desc">{m.desc}</div>
                  <div className="metrics">
                    <div className="metric"><strong>{m.pages}</strong> pages</div>
                    <div className="metric"><strong>{m.sources}</strong> sources</div>
                    <div className={`metric ${m.lint_issues>10?'crit':''}`}><strong>{m.lint_issues}</strong> lint</div>
                    <div className="metric"><strong>{(m.size_kb/1024).toFixed(1)}</strong> MB</div>
                    {m.categories && <div className="metric" style={{flexBasis:'100%',paddingTop:4}}>scope: <span style={{color:'var(--brand-300)'}}>{m.categories.join(', ')}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mm-mount-grid" style={{gridTemplateColumns:'1fr'}}>
              {selected && <MountDetail mount={selected} />}
            </div>
          )}

          <div className="mm-section-head">
            <h3>Wardens</h3>
            <span className="meta">ravns bound here · read / write fan-out</span>
          </div>
          <div style={{display:'flex', flexWrap:'wrap', gap: 'var(--space-2)'}}>
            {D.RAVNS.filter(r => active==='all' || r.bindings.some(b=>b.mount===active)).map(r => (
              <div key={r.id} className="mm-ravn-card" style={{flex:'0 0 calc(50% - 6px)', cursor:'pointer'}} onClick={()=>onOpenRavn(r.id)}>
                <div className="head">
                  <div className="glyph">{r.name.slice(0,2)}</div>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span className="name">{r.name}</span>
                      <span className={`mm-state-dot ${r.state}`} />
                    </div>
                    <div className="persona">{r.persona}</div>
                  </div>
                </div>
                <div className="bio">{r.bio.length > 140 ? r.bio.slice(0,140)+'…' : r.bio}</div>
                <div className="bindings">
                  {r.bindings.map(b => (
                    <span key={b.mount} className="bind-chip">
                      {b.mount}
                      <span className={`mode ${b.mode}`}>{b.mode}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mm-home-col" style={{padding:0}}>
          <div className="mm-section-head" style={{padding:'var(--space-5) var(--space-5) var(--space-3)'}}>
            <h3>Activity</h3>
            <span className="meta">{active === 'all' ? 'all mounts, newest first' : `${active} only`}</span>
          </div>
          <div className="mm-feed">
            {feed.map((e, i) => (
              <div key={i} className="mm-feed-row">
                <span className="t">{e.t}</span>
                <span className={`k ${e.kind}`}>{e.kind}</span>
                <span className="m">{e.mount}</span>
                <span className="msg" onClick={()=> e.page && onOpenPage(e.page)}>
                  <span style={{color:'var(--color-text-primary)'}}>{e.ravn}</span>
                  <span style={{color:'var(--color-text-faint)'}}> · </span>
                  {e.msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MountDetail({ mount }) {
  const D = window.MIMIR_DATA;
  const ravns = D.RAVNS.filter(r => r.bindings.some(b=>b.mount===mount.name));
  return (
    <div className="mm-mount-card" style={{cursor:'default'}}>
      <div className="head">
        <span className={`mm-state-dot ${mount.status==='healthy'?'working':'degraded'}`} />
        <span className="name" style={{fontSize:16}}>{mount.name}</span>
        <span className={`role ${mount.role}`}>{mount.role}</span>
        <span style={{marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-faint)'}}>priority={mount.priority}</span>
      </div>
      <div className="host">{mount.host}</div>
      <div className="desc" style={{marginTop:'var(--space-3)'}}>{mount.desc}</div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'var(--space-3)', marginTop:'var(--space-3)', fontFamily:'var(--font-mono)', fontSize:11}}>
        <div><span style={{color:'var(--color-text-muted)'}}>url</span><br /><span style={{color:'var(--color-text-primary)'}}>{mount.url}</span></div>
        <div><span style={{color:'var(--color-text-muted)'}}>embedding</span><br /><span style={{color:'var(--color-text-primary)'}}>{mount.embedding}</span></div>
        <div><span style={{color:'var(--color-text-muted)'}}>categories</span><br /><span style={{color:'var(--color-text-primary)'}}>{mount.categories ? mount.categories.join(', ') : 'all'}</span></div>
        <div><span style={{color:'var(--color-text-muted)'}}>size</span><br /><span style={{color:'var(--color-text-primary)'}}>{(mount.size_kb/1024).toFixed(2)} MB</span></div>
      </div>

      <div className="metrics" style={{marginTop:'var(--space-3)'}}>
        <div className="metric"><strong>{mount.pages}</strong> pages</div>
        <div className="metric"><strong>{mount.sources}</strong> sources</div>
        <div className="metric"><strong>{ravns.length}</strong> wardens</div>
        <div className={`metric ${mount.lint_issues>10?'crit':''}`}><strong>{mount.lint_issues}</strong> lint</div>
      </div>
    </div>
  );
}

window.MimirHome = MimirHome;
