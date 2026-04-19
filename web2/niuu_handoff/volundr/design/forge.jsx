/* global React */
// ─── Völundr · Forge (overview) ───────────────────────────────
// What's in flight right now · resources · cost burn · boot queue.
// The user opens Völundr here and gets a reading of the fleet in <5s.

const { useMemo: useFm } = React;

function ForgeView({ ctx }) {
  const { SESSIONS, CLUSTERS, TOKEN_BURN_LAST_HOUR, TEMPLATES } = window.VOL_DATA;

  const active   = SESSIONS.filter(s => s.status === 'active');
  const booting  = SESSIONS.filter(s => s.status === 'booting');
  const errored  = SESSIONS.filter(s => s.status === 'error');
  const recent   = [...SESSIONS].sort((a,b)=>b.lastActive-a.lastActive).slice(0,8);

  // Cluster rollups
  const clusterLoad = CLUSTERS.map(c => {
    const sess = SESSIONS.filter(s => s.cluster===c.id && (s.status==='active' || s.status==='booting'));
    const cpuPct = c.cpu.used / c.cpu.total;
    const memPct = c.mem.used / c.mem.total;
    const gpuPct = c.gpu.total ? c.gpu.used / c.gpu.total : null;
    return { ...c, sessCount: sess.length, cpuPct, memPct, gpuPct };
  });

  // Aggregates for header metric strip
  const totalActive = active.length;
  const totalTokens = SESSIONS.reduce((n,s)=>n+(s.tokensIn||0)+(s.tokensOut||0), 0);
  const totalCost = SESSIONS.reduce((n,s)=>n+(s.costCents||0), 0);
  const totalGPUs = CLUSTERS.reduce((n,c)=>n+(c.gpu?.total||0), 0);
  const usedGPUs  = CLUSTERS.reduce((n,c)=>n+(c.gpu?.used||0), 0);

  // Token-burn rate: last 5 minutes avg per second
  const burn5 = TOKEN_BURN_LAST_HOUR.slice(-5).reduce((a,b)=>a+b,0) / 5;

  return (
    <div className="v-page v-page-forge">
      {/* ═══ METRIC STRIP ═══ */}
      <section className="v-metrics">
        <MetricTile label="active pods" value={totalActive} sub={`${booting.length} booting · ${errored.length} error`} accent="brand">
          <Sparkline values={TOKEN_BURN_LAST_HOUR.slice(-40)} width={130} height={30}/>
        </MetricTile>
        <MetricTile label="tokens today" value={window.VOL_ATOMS.tokens(totalTokens)} sub={`${Math.round(burn5)}/s · 5m avg`} accent="brand"/>
        <MetricTile label="cost today" value={window.VOL_ATOMS.money(totalCost)} sub={`$${(totalCost/100 * 24 / ((Date.now() - new Date().setHours(0,0,0,0))/3600000)).toFixed(0)} projected 24h`} accent="brand"/>
        <MetricTile label="gpus" value={`${usedGPUs}/${totalGPUs}`} sub="across 6 clusters" accent="neutral">
          <GPUBar clusters={CLUSTERS}/>
        </MetricTile>
      </section>

      {/* ═══ BODY GRID ═══ */}
      <div className="v-forge-grid">

        {/* ─── IN-FLIGHT PODS ─── */}
        <section className="v-panel v-panel-inflight">
          <header className="v-panel-head">
            <div className="v-panel-title">
              <h2>In-flight pods</h2>
              <span className="mono dim">{active.length + booting.length}</span>
            </div>
            <button className="v-link mono" onClick={()=>ctx.setTab('sessions')}>
              all sessions <Icon.chev/>
            </button>
          </header>
          <div className="v-inflight-list">
            {[...booting, ...active]
              .sort((a,b)=>{
                if (a.status!==b.status) return a.status==='booting' ? -1 : 1;
                return b.lastActive - a.lastActive;
              })
              .slice(0, 6)
              .map(s => <InflightRow key={s.id} s={s} onOpen={()=>{ctx.selectSession(s.id); ctx.setTab('sessions');}}/>)}
          </div>
        </section>

        {/* ─── CLUSTER LOAD ─── */}
        <section className="v-panel v-panel-clusters">
          <header className="v-panel-head">
            <div className="v-panel-title">
              <h2>Forge load</h2>
              <span className="mono dim">{CLUSTERS.length} clusters</span>
            </div>
            <button className="v-link mono" onClick={()=>ctx.setTab('clusters')}>details <Icon.chev/></button>
          </header>
          <div className="v-clusters-list">
            {clusterLoad.map(c => (
              <div key={c.id} className="v-cluster-row">
                <div className="v-cluster-ident">
                  <div className="v-cluster-names">
                    <span className="v-cluster-name-strong">{c.name}</span>
                    <span className="mono dim v-cluster-realm">· {c.realm}</span>
                  </div>
                  <div className="v-cluster-kind-row">
                    <span className={`v-cluster-kind-badge v-cluster-${c.kind}`}>{c.kind}</span>
                    <span className="mono dim">{c.sessCount} pod{c.sessCount!==1?'s':''}</span>
                  </div>
                </div>
                <div className="v-cluster-meters">
                  <div className="v-mini-meter"><span className="mono tiny dim">cpu</span><div className="v-meter-bar"><div className="v-meter-fill" style={{width:`${(c.cpuPct*100).toFixed(0)}%`, background: c.cpuPct>0.85?'var(--color-critical)':c.cpuPct>0.6?'var(--brand-400)':'var(--brand-500)'}}/></div></div>
                  <div className="v-mini-meter"><span className="mono tiny dim">mem</span><div className="v-meter-bar"><div className="v-meter-fill" style={{width:`${(c.memPct*100).toFixed(0)}%`, background: c.memPct>0.85?'var(--color-critical)':c.memPct>0.6?'var(--brand-400)':'var(--brand-500)'}}/></div></div>
                  <div className="v-mini-meter">
                    {c.gpu?.total ? <>
                      <span className="mono tiny dim">gpu</span>
                      <div className="v-meter-bar"><div className="v-meter-fill" style={{width:`${(c.gpuPct*100).toFixed(0)}%`, background:c.gpuPct>0.85?'var(--color-critical)':'var(--brand-500)'}}/></div>
                    </> : <>
                      <span className="mono tiny dim">gpu</span>
                      <div className="v-meter-bar v-meter-none"><span className="mono tiny dim">—</span></div>
                    </>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── QUICK LAUNCH ─── */}
        <section className="v-panel v-panel-launch">
          <header className="v-panel-head">
            <div className="v-panel-title">
              <h2>Quick launch</h2>
              <span className="mono dim">from a template</span>
            </div>
          </header>
          <div className="v-ql-grid">
            {TEMPLATES.slice(0, 4).map(t => (
              <button key={t.name} className="v-ql-card"
                      onClick={()=>{ ctx.selectTemplate(t.name); ctx.setShowLaunch(true); }}>
                <div className="v-ql-head">
                  <CliBadge cli={t.cli}/>
                  {t.default && <span className="v-badge-tiny">default</span>}
                </div>
                <div className="v-ql-name mono">{t.name}</div>
                <div className="v-ql-desc">{t.desc}</div>
                <div className="v-ql-foot">
                  <span className="mono dim">{t.resources.cpu}c · {t.resources.mem}</span>
                  {t.resources.gpu !== '0' && <span className="mono v-ql-gpu">gpu {t.resources.gpu}</span>}
                  <span className="mono dim">{t.usage}×</span>
                </div>
              </button>
            ))}
          </div>
          <button className="v-ql-cta" onClick={()=>ctx.setShowLaunch(true)}>
            <Icon.plus/>&nbsp;custom launch…
          </button>
        </section>

        {/* ─── CHRONICLE TAIL ─── */}
        <section className="v-panel v-panel-chronicle">
          <header className="v-panel-head">
            <div className="v-panel-title">
              <h2>Recent across fleet</h2>
              <span className="mono dim">last 30m</span>
            </div>
          </header>
          <ol className="v-chron-tail">
            {recent.slice(0,8).map(s => (
              <li key={s.id} className="v-chron-item">
                <span className="mono v-chron-time">{window.VOL_ATOMS.relTime(s.lastActive).replace(' ago','')}</span>
                <StatusDot status={s.status==='active' && s.activity==='idle' ? 'idle' : s.status}/>
                <span className="mono v-chron-name">{s.name}</span>
                <span className="v-chron-sep dim">·</span>
                <span className="v-chron-preview">{s.preview || '—'}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ─── ERROR STRIP (if any) ─── */}
        {errored.length > 0 && (
          <section className="v-panel v-panel-errors">
            <header className="v-panel-head">
              <div className="v-panel-title">
                <h2 style={{color:'#f87171'}}>Needs attention</h2>
                <span className="mono dim">{errored.length}</span>
              </div>
            </header>
            <div className="v-err-list">
              {errored.map(s => (
                <div key={s.id} className="v-err-row">
                  <StatusDot status="error"/>
                  <div className="v-err-body">
                    <div className="v-err-title"><span className="mono">{s.name}</span> <span className="mono dim">{s.id}</span></div>
                    <div className="v-err-msg mono">{s.error || '—'}</div>
                  </div>
                  <button className="v-btn v-btn-sm v-btn-primary">retry</button>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

// ── MetricTile ───
function MetricTile({ label, value, sub, accent='brand', children }) {
  return (
    <div className={`v-metric v-metric-${accent}`}>
      <div className="v-metric-label">{label}</div>
      <div className="v-metric-value mono">{value}</div>
      <div className="v-metric-sub mono dim">{sub}</div>
      {children && <div className="v-metric-viz">{children}</div>}
    </div>
  );
}

// ── GPUBar ───
function GPUBar({ clusters }) {
  // small blocks, one per GPU, filled if in use
  const all = [];
  for (const c of clusters) {
    for (let i = 0; i < (c.gpu?.total || 0); i++) {
      all.push({ used: i < (c.gpu?.used || 0), cluster: c.name, kind: c.gpu.kind });
    }
  }
  return (
    <div className="v-gpu-strip" title={`${all.filter(g=>g.used).length}/${all.length} GPUs in use`}>
      {all.map((g,i) => <span key={i} className={`v-gpu-cell ${g.used?'used':''}`} title={`${g.cluster} · ${g.kind}${g.used?' · in use':' · free'}`}/>)}
    </div>
  );
}

// ── InflightRow ─
function InflightRow({ s, onOpen }) {
  const { VOL_ATOMS } = window;
  if (s.status === 'booting') {
    return (
      <div className="v-inf-row v-inf-booting" onClick={onOpen}>
        <div className="v-inf-left">
          <StatusDot status="booting"/>
          <div className="v-inf-name-col">
            <div className="v-inf-name mono">{s.name}</div>
            <div className="v-inf-sub mono dim">{s.id} · {window.VOL_DATA.CLUSTER_BY_ID[s.cluster].name}</div>
          </div>
        </div>
        <div className="v-inf-boot-progress">
          <div className="v-boot-label mono dim">{s.bootStep || 'pulling…'}</div>
          <div className="v-meter-bar"><div className="v-meter-fill" style={{ width:`${(s.bootProgress||0.1)*100}%`, background:'var(--brand-500)' }}/></div>
        </div>
        <CliBadge cli={s.cli} compact/>
      </div>
    );
  }
  return (
    <div className={`v-inf-row v-inf-${s.activity || 'active'}`} onClick={onOpen}>
      <div className="v-inf-left">
        <StatusDot status={s.activity==='idle' ? 'idle' : 'active'}/>
        <div className="v-inf-name-col">
          <div className="v-inf-name mono">{s.name}</div>
          <div className="v-inf-sub">
            <SourceLabel source={s.source} short/>
            <span className="dim mono"> · {window.VOL_DATA.CLUSTER_BY_ID[s.cluster].name}</span>
          </div>
        </div>
      </div>
      <div className="v-inf-preview mono">{s.preview}</div>
      <div className="v-inf-right">
        <div className="v-inf-meters">
          {s.cpu && <div className="v-inf-meter" title={`cpu ${s.cpu.used}/${s.cpu.limit}c`}>
            <span className="mono tiny dim">cpu</span>
            <div className="v-meter-bar tiny"><div className="v-meter-fill" style={{width:`${(s.cpu.used/s.cpu.limit*100)}%`}}/></div>
          </div>}
          {s.mem && <div className="v-inf-meter" title={`mem ${s.mem.used}/${s.mem.limit} GiB`}>
            <span className="mono tiny dim">mem</span>
            <div className="v-meter-bar tiny"><div className="v-meter-fill" style={{width:`${(s.mem.used/s.mem.limit*100)}%`}}/></div>
          </div>}
          {s.gpu && <div className="v-inf-meter" title={`gpu ${s.gpu.used}% ${s.gpu.kind}`}>
            <span className="mono tiny dim">gpu</span>
            <div className="v-meter-bar tiny"><div className="v-meter-fill" style={{width:`${s.gpu.used}%`, background:'var(--brand-500)'}}/></div>
          </div>}
        </div>
        <div className="v-inf-stats mono dim">
          <span>{VOL_ATOMS.tokens(s.tokensIn+s.tokensOut)}</span>
          <span className="sep">·</span>
          <span>{VOL_ATOMS.money(s.costCents)}</span>
        </div>
        <CliBadge cli={s.cli} compact/>
      </div>
    </div>
  );
}

window.ForgeView = ForgeView;
