/* global React, SAGAS, QUEUE, fmtAgo, StatusBadge, StatusDot, Confidence, Pipe, Sparkline, PersonaAvatar, PERSONA_BY_ID */
const { useState: uS, useEffect: uE, useMemo: uM, useRef: uR } = React;

// ───────────────── DASHBOARD ─────────────────
function DashboardView({ setTab, setActiveSagaId }) {
  const kpis = uM(() => ({
    activeSagas: SAGAS.filter(s => s.status!=='complete').length,
    activeRaids: SAGAS.flatMap(s=>s.phases).flatMap(p=>p.raids).filter(r=>r.status==='running').length,
    reviewRaids: SAGAS.flatMap(s=>s.phases).flatMap(p=>p.raids).filter(r=>r.status==='review').length,
    mergedToday: 12,
  }), []);

  const throughput = uM(()=> Array.from({length:24}, (_,i) => Math.round(4 + 3*Math.sin(i/3)+Math.random()*2)), []);
  const confidence = uM(()=> Array.from({length:24}, (_,i) => 0.6 + 0.3*Math.sin(i/5)+Math.random()*0.05), []);

  // Live activity mesh — ravens clustered by raid, edges = recent events between them.
  const canvasRef = uR(null);
  const [hover, setHover] = uS(null); // { raven, x, y } | null
  const hoverRef = uR(null);
  uE(() => { hoverRef.current = hover; }, [hover]);
  const nodesRef = uR([]);

  // Build raids from SAGAS: each running/review raid becomes a cluster; persona seats become ravens
  const raids = uM(() => {
    const out = [];
    SAGAS.filter(s => s.status !== 'complete').forEach(s => {
      s.phases.forEach(ph => {
        ph.raids.filter(r => r.status==='running' || r.status==='review' || r.status==='queued').forEach(r => {
          out.push({
            id: s.id+'/'+r.id,
            sagaId: s.id,
            sagaIdentifier: s.identifier,
            raidIdentifier: r.identifier,
            raidName: r.name,
            phaseName: ph.name,
            status: r.status,
            confidence: r.confidence,
            ravens: [r.persona, 'raid-executor', 'mimir-indexer'].slice(0, r.status==='running' ? 3 : 2),
          });
        });
      });
    });
    return out.slice(0, 6); // cap for legibility
  }, []);

  uE(() => {
    const c = canvasRef.current; if (!c) return;
    const ro = new ResizeObserver(() => setup());
    ro.observe(c);
    let raf;
    let nodes = [], edges = [];
    let pulses = [];
    function setup() {
      const cv = c.getBoundingClientRect();
      c.width = cv.width * devicePixelRatio; c.height = cv.height * devicePixelRatio;
      const W = cv.width, H = cv.height;
      // Lay out clusters on a horizontal rhythm
      const cols = Math.min(raids.length, 3);
      const rows = Math.ceil(raids.length / cols);
      nodes = [];
      raids.forEach((r, i) => {
        const col = i % cols, row = Math.floor(i/cols);
        const cx = W*(col+1)/(cols+1);
        const cy = H*(row+1)/(rows+1);
        const clusterNode = { kind:'cluster', raid:r, x:cx, y:cy, r:36 };
        nodes.push(clusterNode);
        r.ravens.forEach((p, k) => {
          const ang = (k / r.ravens.length) * Math.PI * 2 - Math.PI/2;
          nodes.push({ kind:'raven', raid:r, persona:p, x:cx + Math.cos(ang)*46, y:cy + Math.sin(ang)*46, r:10 });
        });
      });
      // Edges within each cluster (raven <-> raven in same raid)
      edges = [];
      raids.forEach(r => {
        const mine = nodes.filter(n => n.kind==='raven' && n.raid.id===r.id);
        for (let i=0;i<mine.length;i++) for (let j=i+1;j<mine.length;j++) edges.push([mine[i], mine[j], r]);
      });
      nodesRef.current = nodes;
    }
    setup();
    // Event pulses — spawn on random edges, ride along, fade
    const spawn = () => {
      if (edges.length && pulses.length < 18) {
        const e = edges[Math.floor(Math.random()*edges.length)];
        pulses.push({ e, t: 0, speed: 0.010 + Math.random()*0.012 });
      }
    };
    const spawnInt = setInterval(spawn, 260);

    const ctx = c.getContext('2d');
    const draw = () => {
      const cv = c.getBoundingClientRect();
      const W = cv.width, H = cv.height;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0,0,W,H);
      // cluster halos
      nodes.filter(n=>n.kind==='cluster').forEach(n => {
        const grad = ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r+28);
        grad.addColorStop(0, 'rgba(125,211,252,0.12)');
        grad.addColorStop(1, 'rgba(125,211,252,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(n.x,n.y,n.r+28,0,Math.PI*2); ctx.fill();
      });
      // edges (soft)
      ctx.strokeStyle = 'rgba(147,197,253,0.18)'; ctx.lineWidth = 1;
      edges.forEach(([a,b]) => { ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); });
      // pulses
      pulses.forEach(p => { p.t += p.speed; });
      pulses = pulses.filter(p => p.t < 1);
      pulses.forEach(p => {
        const [a,b] = p.e;
        const x = a.x + (b.x-a.x)*p.t, y = a.y + (b.y-a.y)*p.t;
        const alpha = 1 - Math.abs(p.t-0.5)*1.4;
        ctx.fillStyle = `rgba(186,230,253,${Math.max(0,alpha)})`;
        ctx.beginPath(); ctx.arc(x,y,2.5,0,Math.PI*2); ctx.fill();
      });
      // raven nodes
      const hoverNow = hoverRef.current;
      nodes.filter(n=>n.kind==='raven').forEach(n => {
        const isHover = hoverNow && hoverNow.node === n;
        ctx.fillStyle = isHover ? '#bae6fd' : 'rgba(125,211,252,0.85)';
        ctx.beginPath(); ctx.arc(n.x,n.y,isHover?5:3.2,0,Math.PI*2); ctx.fill();
        if (isHover) {
          ctx.strokeStyle = 'rgba(186,230,253,0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(n.x,n.y,9,0,Math.PI*2); ctx.stroke();
        }
      });
      // cluster labels
      ctx.font = '500 10px JetBrains Mono, monospace'; ctx.textAlign='center';
      nodes.filter(n=>n.kind==='cluster').forEach(n => {
        ctx.fillStyle = '#e4e4e7';
        ctx.fillText(n.raid.raidIdentifier, n.x, n.y + 4);
        ctx.fillStyle = '#71717a';
        ctx.fillText(n.raid.phaseName.toLowerCase(), n.x, n.y + 18);
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); clearInterval(spawnInt); ro.disconnect(); };
  }, [raids]);

  const onMeshMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = nodesRef.current.find(n => Math.hypot(n.x-mx, n.y-my) < (n.kind==='cluster' ? n.r : 14));
    if (hit) setHover({ node: hit, x: mx, y: my }); else setHover(null);
  };
  const onMeshClick = () => {
    if (!hover) return;
    const sagaId = hover.node.raid.sagaId;
    setActiveSagaId(sagaId); setTab('sagas');
  };

  const feed = [
    { t:'12s ago', subject:'NIU-214.2', body:'coding-agent → code.changed (raid-42aa)', kind:'run' },
    { t:'18s ago', subject:'NIU-199.2', body:'qa-agent → qa.completed verdict=pass', kind:'ok' },
    { t:'34s ago', subject:'NIU-183.4', body:'reviewer → review.completed needs_changes', kind:'warn' },
    { t:'1m ago',  subject:'NIU-088.1', body:'sagapublished: saga.completed', kind:'ok' },
    { t:'2m ago',  subject:'NIU-148.2', body:'coding-agent → raid.attempted verdict=fail', kind:'crit' },
    { t:'2m ago',  subject:'NIU-214.3', body:'review-arbiter → review.arbitrated pending', kind:'warn' },
  ];

  return (
    <div className="dash">
      <div className="kpi accent">
        <div className="label">Active sagas</div>
        <div className="val">{kpis.activeSagas}<span className="unit">in flight</span></div>
        <div className="sub"><StatusDot status="running" pulsing/> dispatched this hour: <span className="mono">4</span></div>
      </div>
      <div className="kpi">
        <div className="label">Active raids</div>
        <div className="val">{kpis.activeRaids}<span className="unit">running</span></div>
        <Sparkline data={throughput} color="#7dd3fc"/>
      </div>
      <div className="kpi" onClick={()=>setTab('sagas')} style={{ cursor:'pointer' }}>
        <div className="label">Awaiting review</div>
        <div className="val">{kpis.reviewRaids}</div>
        <div className="sub"><span className="mono" style={{ color:'var(--color-brand-300)' }}>2 escalated</span> · oldest 18m</div>
      </div>
      <div className="kpi">
        <div className="label">Merged · 24h</div>
        <div className="val">{kpis.mergedToday}</div>
        <Sparkline data={[2,3,3,4,5,6,7,9,10,11,11,12]} color="#86efac"/>
      </div>

      <div className="dash-row-title">
        <h2>Saga stream</h2>
        <button className="btn sm" onClick={()=>setTab('sagas')}>View all</button>
      </div>
      {SAGAS.filter(s=>s.status!=='complete').slice(0,4).map(s => (
        <div key={s.id} className="saga-card" style={{ gridColumn:'span 2' }} onClick={()=>{ setActiveSagaId(s.id); setTab('sagas'); }}>
          <div>
            <div className="name">{s.name}</div>
            <div className="meta">
              <span className="id-chip">{s.identifier}</span>
              <StatusBadge status={s.status}/>
              <Confidence value={s.confidence}/>
              <span>{s.repos[0]}</span>
              <span>{fmtAgo(s.created)}</span>
            </div>
          </div>
          <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-muted)' }}>
            {s.phases.filter(p=>p.status==='complete').length} / {s.phases.length}
          </div>
          <Pipe saga={s}/>
        </div>
      ))}

      <div className="dash-row-title">
        <h2>Live flock</h2>
        <span className="eyebrow">sleipnir events · last 5m</span>
      </div>
      <div className="flock-viz wide" onMouseMove={onMeshMove} onMouseLeave={()=>setHover(null)} onClick={onMeshClick} style={{ cursor: hover ? 'pointer' : 'default' }}>
        <div className="overlay-title"><span className="live-dot" style={{ background:'var(--color-brand-300)', boxShadow:'0 0 8px var(--color-brand-300)' }}/> Raid mesh</div>
        <div className="overlay-cnt">{raids.reduce((a,r)=>a+r.ravens.length,0)} ravens · {raids.length} raids · click to open</div>
        <canvas ref={canvasRef} style={{ width:'100%', height:'100%' }}/>
        {hover && hover.node.kind==='raven' && (
          <div className="mesh-tip" style={{ left: hover.x+12, top: hover.y+12 }}>
            <div className="mono" style={{ fontWeight:500 }}>{hover.node.persona}</div>
            <div className="mono faint" style={{ fontSize:10, marginTop:2 }}>{hover.node.raid.raidIdentifier} · {hover.node.raid.phaseName}</div>
          </div>
        )}
        {hover && hover.node.kind==='cluster' && (
          <div className="mesh-tip" style={{ left: hover.x+12, top: hover.y+12 }}>
            <div style={{ fontWeight:500 }}>{hover.node.raid.raidName}</div>
            <div className="mono faint" style={{ fontSize:10, marginTop:2 }}>{hover.node.raid.raidIdentifier} · {hover.node.raid.ravens.length} ravens · conf {hover.node.raid.confidence.toFixed(2)}</div>
          </div>
        )}
      </div>
      <div className="wide">
        <div className="sec-head"><span className="t">Event feed</span><span className="eyebrow mono">sleipnir:*</span></div>
        <div className="raid-feed">
          {feed.map((f,i) => {
            // Resolve subject to a saga if possible
            const parentSaga = SAGAS.find(s => f.subject.startsWith(s.identifier));
            const openSaga = () => { if (parentSaga) { setActiveSagaId(parentSaga.id); setTab('sagas'); } };
            return (
              <div key={i} className="raid-feed-row">
                <StatusDot status={f.kind==='ok'?'complete':f.kind==='run'?'running':f.kind==='crit'?'failed':'review'}/>
                <span className="t">{f.t}</span>
                <span>{f.body}</span>
                <span className="subject">{f.subject}</span>
                <button className={`btn sm ghost ${!parentSaga ? 'disabled-link' : ''}`} onClick={openSaga} disabled={!parentSaga} title={parentSaga?`Open ${parentSaga.identifier}`:'No linked saga'}>↗</button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="dash-row-title">
        <h2>Throughput</h2>
      </div>
      <div className="kpi wide"><div className="label">Raids completed / hour</div>
        <div className="val" style={{ fontSize:18, display:'flex', alignItems:'baseline', gap:8 }}>{throughput.reduce((a,b)=>a+b,0)}<span className="unit">· 24h</span></div>
        <Sparkline data={throughput} color="#7dd3fc" height={60}/>
      </div>
      <div className="kpi wide"><div className="label">Saga confidence</div>
        <div className="val" style={{ fontSize:18 }}>{Math.round(confidence.at(-1)*100)}%<span className="unit">· now</span></div>
        <Sparkline data={confidence} color="#bae6fd" height={60}/>
      </div>
    </div>
  );
}

// ───────────────── SAGAS ─────────────────
// Deterministic glyph picker: hash saga identifier to one of a curated set of safe runes.
const SAGA_GLYPHS = ['ᚠ','ᚱ','ᚲ','ᚷ','ᚢ','ᛁ','ᛃ','ᛉ','ᛒ','ᛖ','ᛗ','ᛜ','ᛟ','ᛞ'];
function sagaGlyph(id) { let h=0; for (const c of (id||'')) h = (h*31 + c.charCodeAt(0)) >>> 0; return SAGA_GLYPHS[h % SAGA_GLYPHS.length]; }

function SagasView({ activeSagaId, setActiveSagaId }) {
  const [filter, setFilter] = uS('');
  const [toast, setToast] = uS(null);
  const [showNew, setShowNew] = uS(false);
  const saga = SAGAS.find(s => s.id === activeSagaId) || SAGAS[0];
  const visible = SAGAS.filter(s => !filter || (s.name+' '+s.identifier+' '+s.branch).toLowerCase().includes(filter.toLowerCase()));

  const flash = (msg) => { setToast(msg); setTimeout(()=>setToast(null), 2200); };

  const doExport = () => {
    const data = JSON.stringify(SAGAS, null, 2);
    const blob = new Blob([data], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'sagas.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    flash(`Exported ${SAGAS.length} sagas`);
  };

  // Stage rail + confidence timeline — derived from saga.phases
  const sagaWorkflow = saga.workflow || 'ship';
  const sagaWorkflowVersion = saga.workflowVersion || '1.4.2';
  const stages = saga.phases.map(ph => ({ label: ph.name, status: ph.status, conf: ph.confidence }));
  const conf = [0.4,0.52,0.61,0.68,0.66,0.72,0.78,0.80,0.79,0.82];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Sagas</h2>
          <p>Every saga is a decomposed tracker issue driven by a workflow. Select one to inspect phases, raids and confidence movement.</p>
        </div>
        <div className="page-tools">
          <input className="input" style={{ width:220 }} placeholder="Filter sagas…" value={filter} onChange={e=>setFilter(e.target.value)}/>
          <button className="btn" onClick={doExport}>Export</button>
          <button className="btn primary" onClick={()=>setShowNew(true)}>+ New saga</button>
        </div>
      </div>
      <div className="saga-list">
        {visible.length === 0 && <div className="q-empty">No sagas match "{filter}".</div>}
        {visible.map(s => {
          const totalRaids = s.phases.reduce((a,p)=>a+p.raids.length,0);
          const merged = s.phases.flatMap(p=>p.raids).filter(r=>r.status==='merged').length;
          return (
            <div key={s.id} className={`saga-row ${s.id===saga.id?'selected':''}`} onClick={()=>setActiveSagaId(s.id)}>
              <div className="saga-glyph" title={s.identifier}>{sagaGlyph(s.identifier)}</div>
              <div>
                <div className="title">{s.name}</div>
                <div className="sub">
                  <span className="id-chip">{s.identifier}</span>
                  <span>{s.repos[0]}</span>
                  <span>branch · {s.branch}</span>
                  <span>{fmtAgo(s.created)}</span>
                </div>
              </div>
              <Pipe saga={s}/>
              <StatusBadge status={s.status}/>
              <Confidence value={s.confidence}/>
              <div className="counts">
                <span className="big">{merged}/{totalRaids}</span>
                <span>raids</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="saga-detail">
        <div>
          <div className="sec-head"><span className="t">{saga.identifier} · {saga.name}</span><span className="eyebrow mono">{saga.branch} → {saga.base}</span></div>
          {saga.phases.map(ph => (
            <div key={ph.id} className="phase">
              <div className="phase-head">
                <div className="t"><StatusDot status={ph.status} pulsing={ph.status==='active'}/> Phase {ph.number} · {ph.name}</div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <StatusBadge status={ph.status}/>
                  <Confidence value={ph.confidence}/>
                </div>
              </div>
              {ph.raids.map(r => (
                <div key={r.id} className="raid">
                  <StatusDot status={r.status} pulsing={r.status==='running'}/>
                  <span className="r-id">{r.identifier}</span>
                  <span className="r-name">{r.name}</span>
                  <PersonaAvatar personaId={r.persona} size={20}/>
                  <StatusBadge status={r.status}/>
                  <Confidence value={r.confidence}/>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div>
          <div className="card" style={{ marginBottom:12 }}>
            <div className="h">
              <h3>Workflow</h3>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <span className="chip">v{sagaWorkflowVersion}</span>
                <button className="btn sm ghost" title="Workflow for this saga can be overridden from Dispatch">…</button>
              </div>
            </div>
            <div style={{ padding:12 }}>
              <div className="mono faint" style={{ fontSize:10, letterSpacing:'.06em', marginBottom:4 }}>APPLIED · PER-SAGA</div>
              <div style={{ fontSize:13, fontWeight:500, marginBottom:4 }}>{sagaWorkflow} — default release cycle</div>
              <p className="muted" style={{ margin:'0 0 8px', fontSize:12 }}>qa → pre-ship review → version bump → release PR.</p>
              <div className="info-row">
                <span className="info-icon">i</span>
                <span>Override this workflow per-dispatch from the <a className="inline-link" onClick={e=>{ e.preventDefault(); }}>Dispatch</a> view. The saga's workflow is the default; overrides apply only to that run.</span>
              </div>
              <hr className="sep"/>
              <div className="mono faint" style={{ fontSize:10, letterSpacing:'.06em', marginBottom:4 }}>FLOCK</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {['decomposer','coding-agent','reviewer','qa-agent','ship-agent'].map(pid => (
                  <span key={pid} className="chip"><PersonaAvatar personaId={pid} size={14}/>{pid}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom:12 }}>
            <div className="h"><h3>Stage progress</h3><span className="mono faint" style={{ fontSize:10 }}>{stages.filter(s=>s.status==='complete').length} / {stages.length}</span></div>
            <div style={{ padding:14 }}>
              <div className="stage-rail">
                {stages.map((st, i) => (
                  <React.Fragment key={i}>
                    <div className={`stage-dot st-${st.status}`} title={`${st.label} · ${st.status}`}>
                      <span className="stage-dot-n">{i+1}</span>
                    </div>
                    {i<stages.length-1 && <div className={`stage-bar ${st.status==='complete'?'done':''}`}/>}
                  </React.Fragment>
                ))}
              </div>
              <div className="stage-labels">
                {stages.map((st, i) => <span key={i} className={`stage-label ${st.status==='active'?'on':''}`}>{st.label}</span>)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="h">
              <h3>Confidence drift</h3>
              <span className="mono faint" style={{ fontSize:10 }}>aggregate · {conf.length} events</span>
            </div>
            <div style={{ padding:14 }}>
              <p className="muted" style={{ margin:'0 0 10px', fontSize:11 }}>
                How this saga's overall confidence has moved as raids reported back. Dips call for attention — a QA fail or security flag will pull it down.
              </p>
              <Sparkline data={conf} color="var(--color-brand-300)" height={56}/>
              <div className="conf-foot mono faint">
                <span>start <strong>{conf[0].toFixed(2)}</strong></span>
                <span>now <strong style={{ color:'var(--color-text-primary)' }}>{conf.at(-1).toFixed(2)}</strong></span>
                <span>scope_adherence <strong>0.94</strong></span>
                <span>tests <strong>98%</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showNew && (
        <Modal title="Create saga" onClose={()=>setShowNew(false)}>
          <p className="desc" style={{ margin:'0 0 12px' }}>New sagas start from a prompt and get refined through Plan's conversational intake. Want to go there now?</p>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button className="btn sm ghost" onClick={()=>setShowNew(false)}>Cancel</button>
            <button className="btn sm primary" onClick={()=>{ setShowNew(false); window.dispatchEvent(new CustomEvent('tyr:nav', { detail:'plan' })); }}>Go to Plan →</button>
          </div>
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ───────────────── DISPATCH ─────────────────
function DispatchView() {
  const [picked, setPicked] = uS(new Set(['q1','q3']));
  const [filter, setFilter] = uS('all'); // all | ready | blocked | queue
  const [threshold, setThreshold] = uS(0.70);
  const [concurrent, setConcurrent] = uS(5);
  const [autoContinue, setAutoContinue] = uS(true);
  const [retries, setRetries] = uS(2);
  const [modal, setModal] = uS(null); // 'apply-workflow' | 'threshold' | 'edit-rules' | null
  const [wfOverrides, setWfOverrides] = uS({}); // sagaId -> workflowId
  const [toast, setToast] = uS(null);

  const toggle = (id) => setPicked(prev => { const n = new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const byId = Object.fromEntries(SAGAS.map(s=>[s.id,s]));
  const filtered = QUEUE.filter(q => {
    if (filter === 'ready')   return q.ready;
    if (filter === 'blocked') return !q.ready;
    if (filter === 'queue')   return q.waitMin > 0;
    return true;
  });
  const grouped = {};
  filtered.forEach(q => { (grouped[q.sagaId] = grouped[q.sagaId]||[]).push(q); });

  const readyCount   = QUEUE.filter(q=>q.ready).length;
  const blockedCount = QUEUE.filter(q=>!q.ready).length;

  const flash = (msg) => { setToast(msg); setTimeout(()=>setToast(null), 2200); };

  return (
    <div className="dispatch">
      <div className="dispatch-main">
        <div className="dispatch-head">
          <div>
            <div className="eyebrow">DISPATCH QUEUE</div>
            <h2 style={{ margin:'2px 0 0', fontSize:20, fontWeight:600 }}>{QUEUE.length} raids · {readyCount} ready</h2>
          </div>
          <div className="page-tools">
            <span className="chip">threshold <strong className="mono" style={{ color:'var(--color-brand-300)' }}>{threshold.toFixed(2)}</strong></span>
            <span className="chip">concurrent <strong className="mono">3 / {concurrent}</strong></span>
            <button className="btn sm">⏸ Pause dispatcher</button>
          </div>
        </div>

        <div className="q-filters">
          {[['all','All',QUEUE.length],['ready','Ready',readyCount],['blocked','Blocked',blockedCount],['queue','Queued',QUEUE.filter(q=>q.waitMin>0).length]].map(([k,label,n]) => (
            <button key={k} className={`q-filter ${filter===k?'on':''}`} onClick={()=>setFilter(k)}>
              {label}<span className="mono" style={{ opacity:.6, marginLeft:6 }}>{n}</span>
            </button>
          ))}
        </div>

        {picked.size > 0 && (
          <div className="dispatch-bulk">
            <span className="count">{picked.size}</span>
            <span>selected</span>
            <span style={{ flex:1 }}/>
            <button className="btn sm ghost" onClick={()=>setModal('apply-workflow')}>Apply workflow…</button>
            <button className="btn sm" onClick={()=>setModal('threshold')}>Override threshold</button>
            <button className="btn sm primary" onClick={()=>{ flash(`Dispatched ${picked.size} raid${picked.size>1?'s':''}`); setPicked(new Set()); }}>↯ Dispatch now</button>
          </div>
        )}

        {Object.entries(grouped).length === 0 && (
          <div className="q-empty">No raids match this filter.</div>
        )}

        {Object.entries(grouped).map(([sid, items]) => {
          const saga = byId[sid];
          const wfOverride = wfOverrides[sid];
          const effectiveWf = wfOverride || saga.workflow || 'ship';
          return (
            <div key={sid} className="q-saga-group">
              <div className="h">
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span className="id-chip">{saga.identifier}</span>
                  <span style={{ fontWeight:500 }}>{saga.name}</span>
                </div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-muted)', display:'flex', alignItems:'center', gap:8 }}>
                  <span>{items.length} queued · {saga.branch}</span>
                  <span style={{ width:1, height:10, background:'var(--color-border)' }}/>
                  <span>
                    workflow <span style={{ color:'var(--color-text-secondary)' }}>{effectiveWf}</span>
                    {wfOverride && <span className="badge b-ok" style={{ marginLeft:6 }}>override</span>}
                  </span>
                </div>
              </div>
              {items.map(q => {
                const raid = saga.phases.flatMap(p=>p.raids).find(r=>r.id===q.raid);
                if (!raid) return null;
                return (
                  <div key={q.id} className={`q-item ${picked.has(q.id)?'picked':''}`} onClick={()=>toggle(q.id)}>
                    <div className="chk">{picked.has(q.id) && <span>✓</span>}</div>
                    <div>
                      <div style={{ fontWeight:500 }}>{raid.name}</div>
                      <div className="mono faint" style={{ fontSize:10, marginTop:2 }}>
                        {raid.identifier} · est {raid.estimate}h{q.retry ? ' · retry '+q.retry : ''}
                      </div>
                    </div>
                    <div>
                      {q.ready
                        ? <span className="badge b-ok">ready</span>
                        : <span className="badge b-gate">blocked · {q.blockedBy}</span>}
                    </div>
                    <Confidence value={raid.confidence}/>
                    <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--color-text-muted)' }}>
                      {q.waitMin ? `${q.waitMin}m wait` : 'now'}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div>
        <div className="card" style={{ marginBottom:12 }}>
          <div className="h"><h3>Dispatch rules</h3><button className="btn sm ghost" onClick={()=>setModal('edit-rules')}>Edit</button></div>
          <div style={{ padding:'10px 16px' }}>
            <div className="kv-row" style={{ borderBottom:'none', padding:'4px 0' }}><label>Confidence threshold</label><span className="mono">≥ {threshold.toFixed(2)}</span></div>
            <div className="kv-row" style={{ borderBottom:'none', padding:'4px 0' }}><label>Max concurrent</label><span className="mono">{concurrent}</span></div>
            <div className="kv-row" style={{ borderBottom:'none', padding:'4px 0' }}><label>Auto-continue</label><span className="mono" style={{ color: autoContinue?'var(--color-brand-300)':'var(--color-text-muted)' }}>{autoContinue?'on':'off'}</span></div>
            <div className="kv-row" style={{ borderBottom:'none', padding:'4px 0' }}><label>Retry on fail</label><span className="mono">up to {retries}</span></div>
            <div className="kv-row" style={{ borderBottom:'none', padding:'4px 0' }}><label>Quiet hours</label><span className="mono">22:00 – 07:00</span></div>
          </div>
        </div>
        <div className="card">
          <div className="h"><h3>Recent dispatches</h3></div>
          <div style={{ padding:4 }}>
            {[
              ['NIU-214.2','13:42','ship'],
              ['NIU-199.2','13:28','ship'],
              ['NIU-183.4','13:11','deep-review'],
              ['NIU-214.1','12:49','ship'],
              ['NIU-199.1','12:30','ship'],
            ].map(([rid,t,wf],i)=> (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'auto 1fr auto', gap:8, padding:'7px 12px', borderTop: i?'1px solid var(--color-border-subtle)':'none', fontSize:12 }}>
                <span className="id-chip">{rid}</span>
                <span className="mono faint">wf: {wf}</span>
                <span className="mono faint">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal === 'apply-workflow' && (
        <Modal title="Apply workflow override" onClose={()=>setModal(null)}>
          <p className="desc" style={{ margin:'0 0 12px' }}>Override the workflow for the {picked.size} selected raid{picked.size>1?'s':''}. The saga's original workflow is preserved; this applies only to this dispatch.</p>
          <div className="wf-picker">
            {(window.TEMPLATES || []).map(t => (
              <button key={t.id} className="wf-pick-row" onClick={()=>{
                // apply to each selected raid's saga
                const next = { ...wfOverrides };
                filtered.forEach(q => { if (picked.has(q.id)) next[q.sagaId] = t.name; });
                setWfOverrides(next);
                flash(`Applied "${t.name}" to ${picked.size} raid${picked.size>1?'s':''}`);
                setModal(null);
              }}>
                <div>
                  <div style={{ fontWeight:500 }}>{t.name}</div>
                  <div className="mono faint" style={{ fontSize:10, marginTop:2 }}>{t.summary || (t.nodes?.length || 0)+' stages'}</div>
                </div>
                <span className="mono faint" style={{ fontSize:10 }}>v{t.version || '1.0'}</span>
              </button>
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
            <button className="btn sm ghost" onClick={()=>setModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}

      {modal === 'threshold' && (
        <ThresholdModal
          current={threshold}
          onClose={()=>setModal(null)}
          onApply={(v)=>{ setThreshold(v); flash(`Threshold → ${v.toFixed(2)}`); setModal(null); }}
        />
      )}

      {modal === 'edit-rules' && (
        <EditRulesModal
          threshold={threshold} concurrent={concurrent} autoContinue={autoContinue} retries={retries}
          onClose={()=>setModal(null)}
          onApply={(next)=>{
            setThreshold(next.threshold); setConcurrent(next.concurrent);
            setAutoContinue(next.autoContinue); setRetries(next.retries);
            flash('Dispatch rules updated');
            setModal(null);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// Modal primitives (dispatch-local)
function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="btn sm ghost icon-only" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
function ThresholdModal({ current, onClose, onApply }) {
  const [v, setV] = uS(current);
  return (
    <Modal title="Override dispatch threshold" onClose={onClose}>
      <p className="desc" style={{ margin:'0 0 16px' }}>Raids with confidence below this threshold stay queued. Lower it to dispatch more aggressively; raise it to be conservative.</p>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <input type="range" min="0" max="1" step="0.05" value={v} onChange={e=>setV(parseFloat(e.target.value))} style={{ flex:1 }}/>
        <div className="mono" style={{ fontSize:20, color:'var(--color-brand-300)', minWidth:60, textAlign:'right' }}>{v.toFixed(2)}</div>
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
        <button className="btn sm ghost" onClick={onClose}>Cancel</button>
        <button className="btn sm primary" onClick={()=>onApply(v)}>Apply</button>
      </div>
    </Modal>
  );
}
function EditRulesModal({ threshold, concurrent, autoContinue, retries, onClose, onApply }) {
  const [t, setT] = uS(threshold);
  const [c, setC] = uS(concurrent);
  const [a, setA] = uS(autoContinue);
  const [r, setR] = uS(retries);
  return (
    <Modal title="Edit dispatch rules" onClose={onClose}>
      <div className="kv-row"><label>Confidence threshold</label><input className="input mono" value={t} onChange={e=>setT(parseFloat(e.target.value)||0)} style={{ width:100 }}/></div>
      <div className="kv-row"><label>Max concurrent raids</label><input className="input mono" value={c} onChange={e=>setC(parseInt(e.target.value)||0)} style={{ width:100 }}/></div>
      <div className="kv-row"><label>Auto-continue</label><button className={`btn sm ${a?'primary':''}`} onClick={()=>setA(!a)}>{a?'on':'off'}</button></div>
      <div className="kv-row"><label>Retry on fail</label><input className="input mono" value={r} onChange={e=>setR(parseInt(e.target.value)||0)} style={{ width:100 }}/></div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
        <button className="btn sm ghost" onClick={onClose}>Cancel</button>
        <button className="btn sm primary" onClick={()=>onApply({ threshold:t, concurrent:c, autoContinue:a, retries:r })}>Save</button>
      </div>
    </Modal>
  );
}

// ───────────────── PLAN ─────────────────
function PlanView({ setTab }) {
  // Step machine: prompt → questions → raiding → draft → approved
  const [step, setStep] = uS('prompt'); // 'prompt' | 'questions' | 'raiding' | 'draft' | 'approved'
  const [prompt, setPrompt] = uS('');
  const [answers, setAnswers] = uS({});
  const [draft, setDraft] = uS(null);
  const [toast, setToast] = uS(null);
  const flash = (m) => { setToast(m); setTimeout(()=>setToast(null), 2200); };

  const questions = [
    { id:'repos',    label:'Which repos will this touch?',                  placeholder:'e.g. niuulabs/volundr', hint:'Comma-separate if more than one.' },
    { id:'base',     label:'Base branch?',                                   placeholder:'main', hint:'What the feature branch merges back into.' },
    { id:'scope',    label:'What does "done" look like? (acceptance criteria)', placeholder:'e.g. validator surfaces dead-letter warnings, covered by integration tests', hint:'Bullets or a paragraph — the raid will turn this into verifiable checks.', multiline:true },
    { id:'blast',    label:'Blast radius & flags',                           placeholder:'e.g. behind flokk.validation.enabled; touches dispatch path', hint:'Anything the reviewer needs to know up front.', multiline:true },
    { id:'workflow', label:'Apply which workflow?', kind:'workflow' },
  ];

  const startPlanningRaid = () => {
    setStep('raiding');
    setTimeout(() => {
      // Canned plan — in real life the planning raid fills this.
      setDraft({
        identifier: 'NIU-NEW',
        title: prompt.split('\n')[0].slice(0, 72) || 'Untitled saga',
        summary: prompt,
        repos: (answers.repos || 'niuulabs/volundr').split(',').map(r=>r.trim()),
        base: answers.base || 'main',
        branch: (prompt.toLowerCase().match(/\b[a-z0-9-]{6,}\b/) || ['new-saga'])[0],
        workflow: answers.workflow || 'ship',
        acceptance: [
          'Validator surfaces dead-letter warnings for unconsumed event types',
          'Cycle detection runs in O(V+E) and never false-positives on legitimate fan-out',
          'Integration tests cover override precedence (template → saga → dispatch)',
          'UI dead-letter badge visible on affected workflow nodes',
        ],
        subTasks: [
          { name:'Decompose subscription rules into validator inputs', phase:'Plan',   persona:'decomposer',   est:0.5, size:'S' },
          { name:'Subscription graph validator (produces / consumes, cycle detect)', phase:'Build', persona:'coding-agent', est:3.0, size:'M' },
          { name:'UI: surface dead-letter and starved-consumer warnings', phase:'Build', persona:'coding-agent', est:2.0, size:'M' },
          { name:'Integration tests for graph validator edge cases', phase:'Verify', persona:'qa-agent',       est:1.0, size:'S' },
          { name:'Arbitrated review',                                   phase:'Review', persona:'review-arbiter', est:0.5, size:'S' },
        ],
        reasoning: "The brief mentions subscription validation affecting the dispatch path, so Build splits into validator + UI to let them proceed independently — UI blocks on validator.ready. Verify covers the three edge cases called out (dead-letter, cycle, precedence). Review is arbitrated because changes touch dispatch.",
        risks: [
          { kind:'blast',    msg:'Touches dispatch — a buggy validator could block all dispatch. Recommend shipping behind flag.' },
          { kind:'untested', msg:'No existing tests for subscription graph — raid will need to author fixtures first.' },
        ],
      });
      setStep('draft');
    }, 2200);
  };

  const questionsDone = questions.filter(q => q.kind!=='workflow').every(q => (answers[q.id]||'').trim().length > 0);

  return (
    <div className="plan plan-v2">
      <div className="plan-col">
        {/* STEP: PROMPT */}
        {step === 'prompt' && (
          <div className="card plan-prompt">
            <div className="plan-step-head">
              <StepDots active={0}/>
              <div>
                <h3>What do you want to get done?</h3>
                <p className="muted" style={{ margin:'4px 0 0', fontSize:12 }}>Rough is fine. A tracker ID, a sentence, or a paragraph — a planning raid will ask clarifying questions, then draft a saga you can approve.</p>
              </div>
            </div>
            <div style={{ padding:'18px 20px 20px' }}>
              <textarea
                className="input"
                style={{ minHeight:140, fontSize:14, lineHeight:1.55 }}
                autoFocus
                placeholder={"e.g. NIU-214: subscription validation — surface dead-letter warnings when a persona has no downstream consumer…"}
                value={prompt}
                onChange={e=>setPrompt(e.target.value)}
              />
              <div className="plan-hints">
                <span className="hint-chip" onClick={()=>setPrompt('NIU-214: subscription validation — surface dead-letter warnings when a persona in a workflow has no downstream consumer for any of its produced event types.')}>+ Example: subscription validation</span>
                <span className="hint-chip" onClick={()=>setPrompt('Add a health check endpoint to the Tyr service that reports queue depth and active raid counts.')}>+ Example: simple endpoint</span>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:18, justifyContent:'flex-end' }}>
                <button className="btn primary" disabled={!prompt.trim()} onClick={()=>setStep('questions')}>Continue →</button>
              </div>
            </div>
          </div>
        )}

        {/* STEP: QUESTIONS */}
        {step === 'questions' && (
          <div className="card">
            <div className="plan-step-head">
              <StepDots active={1}/>
              <div>
                <h3>A few clarifying questions</h3>
                <p className="muted" style={{ margin:'4px 0 0', fontSize:12 }}>Sharpens the planning raid's output. Skip any and the raid will make assumptions — you'll see them in the draft.</p>
              </div>
            </div>
            <div style={{ padding:'18px 20px 20px' }}>
              <div className="plan-quote">
                <div className="eyebrow mono" style={{ marginBottom:4 }}>YOUR BRIEF</div>
                <div style={{ fontSize:12, lineHeight:1.55 }}>{prompt}</div>
              </div>

              {questions.map(q => (
                <div key={q.id} style={{ marginTop:16 }}>
                  <label className="plan-q-label">{q.label}</label>
                  {q.hint && <div className="plan-q-hint">{q.hint}</div>}
                  {q.kind === 'workflow' ? (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginTop:6 }}>
                      {(window.TEMPLATES || []).map(t => (
                        <button key={t.id} className={`wf-chip ${answers.workflow===t.name?'on':''}`} onClick={()=>setAnswers({ ...answers, workflow:t.name })}>
                          <div style={{ fontWeight:500, fontSize:12 }}>{t.name}</div>
                          <div className="mono faint" style={{ fontSize:10, marginTop:2 }}>v{t.version} · {t.nodes.filter(n=>n.kind==='stage').length} stages</div>
                        </button>
                      ))}
                    </div>
                  ) : q.multiline ? (
                    <textarea className="input" style={{ marginTop:6, minHeight:64 }} placeholder={q.placeholder} value={answers[q.id]||''} onChange={e=>setAnswers({ ...answers, [q.id]:e.target.value })}/>
                  ) : (
                    <input className="input mono" style={{ marginTop:6 }} placeholder={q.placeholder} value={answers[q.id]||''} onChange={e=>setAnswers({ ...answers, [q.id]:e.target.value })}/>
                  )}
                </div>
              ))}

              <div style={{ display:'flex', gap:8, marginTop:20, justifyContent:'space-between' }}>
                <button className="btn ghost" onClick={()=>setStep('prompt')}>← Back</button>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn ghost" onClick={startPlanningRaid}>Skip & plan</button>
                  <button className="btn primary" disabled={!questionsDone} onClick={startPlanningRaid}>Dispatch planning raid →</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP: RAIDING */}
        {step === 'raiding' && (
          <div className="card plan-raiding">
            <div className="plan-step-head">
              <StepDots active={2}/>
              <div>
                <h3>Planning raid in progress…</h3>
                <p className="muted" style={{ margin:'4px 0 0', fontSize:12 }}>A short-lived raid is reading the brief + answers and drafting the saga.</p>
              </div>
            </div>
            <div style={{ padding:'36px 20px 40px', display:'flex', flexDirection:'column', alignItems:'center', gap:18 }}>
              <RaidingAnim/>
              <div className="mono faint" style={{ fontSize:11, textAlign:'center', maxWidth:360, lineHeight:1.6 }}>
                ᚱ · decomposer — analyzing brief<br/>
                ᚱ · investigator — probing repo for affected modules<br/>
                ᚱ · mimir-indexer — pulling in prior-art sagas
              </div>
            </div>
          </div>
        )}

        {/* STEP: DRAFT */}
        {step === 'draft' && draft && (
          <>
            <div className="card">
              <div className="plan-step-head">
                <StepDots active={3}/>
                <div>
                  <h3>Draft saga — review before creation</h3>
                  <p className="muted" style={{ margin:'4px 0 0', fontSize:12 }}>Nothing's been created yet. Edit, add or remove sub-tasks, adjust the workflow — then approve to materialize the saga and start dispatching.</p>
                </div>
              </div>
              <div style={{ padding:'16px 20px' }}>
                <div className="draft-head">
                  <div>
                    <div className="eyebrow mono">PROPOSED TITLE</div>
                    <input className="input" style={{ marginTop:4, fontSize:15, fontWeight:500 }} value={draft.title} onChange={e=>setDraft({ ...draft, title:e.target.value })}/>
                  </div>
                  <div className="draft-meta mono faint">
                    <span>{draft.repos.join(', ')}</span>
                    <span>·</span>
                    <span>{draft.branch} → {draft.base}</span>
                    <span>·</span>
                    <span>workflow: <strong style={{ color:'var(--color-text-secondary)' }}>{draft.workflow}</strong></span>
                  </div>
                </div>

                <div className="draft-section">
                  <div className="eyebrow mono">SUMMARY</div>
                  <textarea className="input" style={{ marginTop:6, minHeight:72 }} value={draft.summary} onChange={e=>setDraft({ ...draft, summary:e.target.value })}/>
                </div>

                <div className="draft-section">
                  <div className="eyebrow mono">ACCEPTANCE CRITERIA · {draft.acceptance.length}</div>
                  <ul className="acceptance">
                    {draft.acceptance.map((a, i) => (
                      <li key={i}>
                        <span className="ac-check">✓</span>
                        <input className="ac-input" value={a} onChange={e=>{
                          const next = [...draft.acceptance]; next[i] = e.target.value;
                          setDraft({ ...draft, acceptance: next });
                        }}/>
                        <button className="btn sm ghost icon-only" onClick={()=>setDraft({ ...draft, acceptance: draft.acceptance.filter((_,k)=>k!==i) })}>×</button>
                      </li>
                    ))}
                  </ul>
                  <button className="btn sm ghost" onClick={()=>setDraft({ ...draft, acceptance: [...draft.acceptance, 'New criterion'] })}>+ Add criterion</button>
                </div>

                {draft.risks.length > 0 && (
                  <div className="draft-section">
                    <div className="eyebrow mono">RISKS FLAGGED BY PLANNING RAID</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
                      {draft.risks.map((r, i) => (
                        <div key={i} className="risk-row">
                          <span className="risk-kind">{r.kind}</span>
                          <span>{r.msg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="draft-section">
                  <div className="eyebrow mono">PLANNING-RAID REASONING</div>
                  <p className="muted" style={{ margin:'6px 0 0', fontSize:12, lineHeight:1.6 }}>{draft.reasoning}</p>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="h">
                <h3>Sub-tasks · {draft.subTasks.length}</h3>
                <span className="mono faint" style={{ fontSize:10 }}>each can become its own saga — or stay sub-tasks under this one</span>
              </div>
              <div style={{ padding:'8px 12px 12px' }}>
                {draft.subTasks.map((t, i) => (
                  <div key={i} className="decomp-raid" style={{ gridTemplateColumns:'auto 1fr auto auto auto' }}>
                    <PersonaAvatar personaId={t.persona}/>
                    <div>
                      <div style={{ fontSize:12, fontWeight:500 }}>{t.name}</div>
                      <div className="mono faint" style={{ fontSize:10, marginTop:2 }}>{t.phase} · {t.persona} · est {t.est}h</div>
                    </div>
                    <span className={`size-pill size-${t.size}`}>{t.size}</span>
                    <button className="btn sm ghost" onClick={()=>flash('Promote to its own saga (not wired in mock)')}>↗ Own saga</button>
                    <button className="btn sm ghost icon-only" onClick={()=>setDraft({ ...draft, subTasks: draft.subTasks.filter((_,k)=>k!==i) })}>×</button>
                  </div>
                ))}
                <button className="btn sm ghost" style={{ marginTop:8 }} onClick={()=>setDraft({ ...draft, subTasks:[...draft.subTasks, { name:'New sub-task', phase:'Build', persona:'coding-agent', est:1.0, size:'S' }] })}>+ Add sub-task</button>
              </div>
            </div>

            <div className="draft-actions">
              <button className="btn ghost" onClick={()=>setStep('questions')}>← Revise answers</button>
              <button className="btn ghost" onClick={()=>{ setStep('raiding'); setTimeout(startPlanningRaid, 200); }}>↻ Re-plan</button>
              <span style={{ flex:1 }}/>
              <button className="btn" onClick={()=>flash('Draft saved')}>Save as draft</button>
              <button className="btn primary" onClick={()=>{ setStep('approved'); flash('Saga created — dispatching first raids'); }}>↯ Approve & create saga</button>
            </div>
          </>
        )}

        {/* STEP: APPROVED */}
        {step === 'approved' && draft && (
          <div className="card plan-approved">
            <div style={{ padding:'40px 30px', textAlign:'center' }}>
              <div className="approved-glyph">✓</div>
              <h3 style={{ margin:'16px 0 4px', fontSize:18 }}>Saga created</h3>
              <p className="muted" style={{ margin:'0 0 20px', fontSize:12 }}>{draft.identifier} · {draft.title}</p>
              <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                <button className="btn" onClick={()=>{ setStep('prompt'); setPrompt(''); setAnswers({}); setDraft(null); }}>Plan another</button>
                <button className="btn primary" onClick={()=>setTab('sagas')}>Open in Sagas →</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: What-this-is / helper rail */}
      <div className="plan-col plan-rail">
        <div className="card">
          <div className="h"><h3>How Plan works</h3></div>
          <ol className="plan-how">
            <li className={step==='prompt'?'on':step==='questions'||step==='raiding'||step==='draft'||step==='approved'?'done':''}><span className="n">1</span> <span>Describe what you want done — rough is fine.</span></li>
            <li className={step==='questions'?'on':step==='raiding'||step==='draft'||step==='approved'?'done':''}><span className="n">2</span> <span>Answer a few clarifying questions.</span></li>
            <li className={step==='raiding'?'on':step==='draft'||step==='approved'?'done':''}><span className="n">3</span> <span>A short planning raid drafts the saga.</span></li>
            <li className={step==='draft'?'on':step==='approved'?'done':''}><span className="n">4</span> <span>Review the draft — tweak title, criteria, sub-tasks.</span></li>
            <li className={step==='approved'?'on':''}><span className="n">5</span> <span>Approve → saga created, first raids dispatched.</span></li>
          </ol>
        </div>

        <div className="card">
          <div className="h"><h3>What a planning raid produces</h3></div>
          <div style={{ padding:'12px 16px' }}>
            <ul className="bullet-list">
              <li>Draft title, summary, applied workflow</li>
              <li>Acceptance criteria (definition of done)</li>
              <li>Sub-task decomposition — each promotable to its own saga</li>
              <li>Risk flags the reviewer should know</li>
              <li>Reasoning trail — why the raid decomposed it this way</li>
            </ul>
          </div>
        </div>

        {step === 'draft' && draft && (
          <div className="card">
            <div className="h"><h3>Live recap</h3></div>
            <div style={{ padding:'10px 16px', fontSize:12, lineHeight:1.55 }}>
              <div><strong>Workflow</strong> · <span className="mono">{draft.workflow}</span></div>
              <div><strong>Phases</strong> · <span className="mono">{[...new Set(draft.subTasks.map(t=>t.phase))].length}</span></div>
              <div><strong>Sub-tasks</strong> · <span className="mono">{draft.subTasks.length}</span></div>
              <div><strong>Total est</strong> · <span className="mono">{draft.subTasks.reduce((a,t)=>a+t.est,0).toFixed(1)}h</span></div>
              <div><strong>Acceptance</strong> · <span className="mono">{draft.acceptance.length} criteria</span></div>
            </div>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// Planning-step indicator
function StepDots({ active }) {
  return (
    <div className="step-dots">
      {['1','2','3','4'].map((l, i) => (
        <React.Fragment key={i}>
          <div className={`step-dot ${i<active?'done':''} ${i===active?'on':''}`}>{i<active?'✓':l}</div>
          {i<3 && <div className={`step-line ${i<active?'done':''}`}/>}
        </React.Fragment>
      ))}
    </div>
  );
}

// Small animated placeholder during the planning raid
function RaidingAnim() {
  return (
    <div className="raiding-anim">
      <div className="ring r1"/>
      <div className="ring r2"/>
      <div className="ring r3"/>
      <div className="core">ᚱ</div>
    </div>
  );
}

// ───────────────── SETTINGS ─────────────────
function SettingsView({ sel, setSel }) {
  const sec = sel || 'general';
  return (
    <div className="page" style={{ padding:0 }}>
      <div className="settings-grid" style={{ padding:'var(--space-5) var(--space-6)' }}>
        <div></div>
        <div>
          {sec === 'general' && <>
            <div className="settings-sec">
              <h3>General</h3>
              <p className="desc">Core Týr service settings.</p>
              <div className="kv-row"><label>Service URL</label><span className="mono">https://tyr.niuu.internal</span></div>
              <div className="kv-row"><label>Owner ID</label><span className="mono">jonas@niuulabs.io</span></div>
              <div className="kv-row"><label>Event backbone</label><span className="mono">sleipnir · nats</span></div>
              <div className="kv-row"><label>Knowledge store</label><span className="mono">mímir · qdrant:/niuu</span></div>
              <div className="kv-row"><label>Default workflow</label><span className="mono">tpl-ship v1.4.2</span></div>
            </div>
          </>}
          {sec === 'dispatch' && <>
            <div className="settings-sec">
              <h3>Dispatch rules</h3>
              <p className="desc">How the dispatcher promotes queued raids into running ones.</p>
              <div className="kv-row"><label>Confidence threshold</label><input className="input mono" defaultValue="0.70" style={{ width:120 }}/></div>
              <div className="kv-row"><label>Max concurrent raids</label><input className="input mono" defaultValue="5" style={{ width:120 }}/></div>
              <div className="kv-row"><label>Auto-continue phases</label><window.Switch on={true} onChange={()=>{}}/></div>
              <div className="kv-row"><label>Retry on fail</label><input className="input mono" defaultValue="2" style={{ width:120 }}/></div>
              <div className="kv-row"><label>Quiet hours</label><input className="input mono" defaultValue="22:00–07:00 UTC" style={{ width:200 }}/></div>
              <div className="kv-row"><label>Escalate after (review)</label><input className="input mono" defaultValue="30m" style={{ width:120 }}/></div>
            </div>
          </>}
          {sec === 'integrations' && <>
            <div className="settings-sec">
              <h3>Integrations</h3>
              <p className="desc">Trackers, repos, secrets.</p>
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
          </>}
          {sec === 'personas' && <>
            <div className="settings-sec">
              <h3>Persona overrides</h3>
              <p className="desc">Workspace-level defaults applied to every workflow. Workflows can override further.</p>
              {window.PERSONAS.slice(0,5).map(p => (
                <div key={p.id} className="kv-row" style={{ gridTemplateColumns:'24px 1fr auto auto auto' }}>
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
          </>}
          {sec === 'gates' && <>
            <div className="settings-sec">
              <h3>Gates &amp; reviewers</h3>
              <p className="desc">Who can approve gates in workflows. Routing rules.</p>
              {['jonas@niuulabs.io','oskar@niuulabs.io','yngve@niuulabs.io'].map(who => (
                <div key={who} className="kv-row"><label>{who}</label><span className="mono">all gates · auto-forward after 30m</span></div>
              ))}
            </div>
          </>}
          {sec === 'notifications' && <>
            <div className="settings-sec">
              <h3>Notifications</h3>
              <p className="desc">Where Týr sends alerts.</p>
              <div className="kv-row"><label>Slack channel</label><span className="mono">#niuu-ops</span></div>
              <div className="kv-row"><label>Email digest</label><span className="mono">daily 08:00</span></div>
              <div className="kv-row"><label>On escalation</label><window.Switch on={true} onChange={()=>{}}/></div>
              <div className="kv-row"><label>On saga complete</label><window.Switch on={false} onChange={()=>{}}/></div>
            </div>
          </>}
          {sec === 'advanced' && <>
            <div className="settings-sec">
              <h3>Advanced</h3>
              <p className="desc">Danger zone.</p>
              <div className="kv-row"><label>Flush queue</label><button className="btn danger sm">Flush</button></div>
              <div className="kv-row"><label>Reset dispatcher</label><button className="btn danger sm">Reset</button></div>
              <div className="kv-row"><label>Rebuild confidence scores</label><button className="btn sm">Rebuild</button></div>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardView, SagasView, DispatchView, PlanView, SettingsView });
