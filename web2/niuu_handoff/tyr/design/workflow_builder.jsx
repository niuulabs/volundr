/* global React, PERSONAS, PERSONA_BY_ID, TEMPLATES, DEFAULT_DRAFT,
          PersonaAvatar, StatusDot, Seg, validateWorkflow, workflowToYAML, highlightYAML */
const { useState: wuS, useEffect: wuE, useMemo: wuM, useRef: wuR, useCallback: wuC } = React;

// Port anchors (left/right middle) for a node box
function portPos(node) {
  const h = stageHeight(node);
  return {
    inX: node.x, inY: node.y + h/2,
    outX: node.x + nodeWidth(node), outY: node.y + h/2,
  };
}
function nodeWidth(n) {
  if (n.kind === 'stage') return 240;
  if (n.kind === 'gate') return 170;
  if (n.kind === 'cond') return 200;
  return 150;
}
function stageHeight(n) {
  if (n.kind === 'stage') return 52 + 30 * Math.max(1, (n.members||[]).length) + 26;
  if (n.kind === 'cond') return 72;
  if (n.kind === 'gate') return 72;
  return 56;
}

// Bezier path for an edge between two points
function edgePath(p1, p2) {
  const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
  return `M ${p1.x} ${p1.y} C ${p1.x+dx} ${p1.y}, ${p2.x-dx} ${p2.y}, ${p2.x} ${p2.y}`;
}

// ──────────────────────────────────────────
//  LIBRARY (left panel) — personas, stages, conds
// ──────────────────────────────────────────
function Library({ onDragStart }) {
  const [q, setQ] = wuS('');
  const filtered = PERSONAS.filter(p =>
    !q || p.name.includes(q.toLowerCase()) || p.role.toLowerCase().includes(q.toLowerCase())
  );
  const grouped = {};
  filtered.forEach(p => { (grouped[p.role] = grouped[p.role]||[]).push(p); });

  return (
    <div className="wf-lib">
      <div className="wf-lib-head">
        <h3>Library</h3>
        <button className="btn sm ghost" title="New persona">+</button>
      </div>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--color-border-subtle)' }}>
        <input className="input" placeholder="Search personas…" value={q} onChange={e=>setQ(e.target.value)}/>
      </div>
      <div className="wf-lib-body">
        <div>
          <div className="wf-lib-section-title"><span>Blocks</span></div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <div className="stage-pill" draggable onDragStart={e=>onDragStart(e,{kind:'stage'})}>◆ Stage</div>
            <div className="cond-pill" draggable onDragStart={e=>onDragStart(e,{kind:'cond'})}>? Condition</div>
            <div className="gate-pill" draggable onDragStart={e=>onDragStart(e,{kind:'gate'})}>⌘ Human gate</div>
            <div className="stage-pill" draggable onDragStart={e=>onDragStart(e,{kind:'end'})}>● End</div>
          </div>
        </div>
        {Object.entries(grouped).map(([role, items]) => (
          <div key={role}>
            <div className="wf-lib-section-title"><span>{role}</span><span className="mono faint">{items.length}</span></div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {items.map(p => (
                <div key={p.id} className="persona-card" draggable
                  onDragStart={e=>onDragStart(e,{kind:'stage', newMember:{persona:p.id, budget:40}})}
                  title={`${p.summary}\nconsumes: ${p.consumes.join(', ')}\nproduces: ${p.produces.join(', ')}`}>
                  <PersonaAvatar personaId={p.id} size={24}/>
                  <div>
                    <div className="name">{p.name}</div>
                    <div className="role">{p.role.toLowerCase()}</div>
                  </div>
                  <span className="mono faint" style={{ fontSize:9 }}>⇆</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────
//  INSPECTOR (right panel) — selected node editor
// ──────────────────────────────────────────
function Inspector({ node, onChange, onDelete, validation, wf }) {
  const [tab, setTab] = wuS('config');
  if (!node) {
    // show workflow meta
    return (
      <div className="wf-insp">
        <div className="wf-insp-head"><h3>Workflow</h3></div>
        <div className="wf-insp-body">
          <label className="eyebrow">NAME</label>
          <input className="input" style={{ marginTop:4 }} value={wf.name} onChange={e=>onChange({ ...wf, name: e.target.value })}/>
          <label className="eyebrow" style={{ marginTop:12, display:'block' }}>DESCRIPTION</label>
          <textarea className="input" style={{ marginTop:4 }} value={wf.description||''} onChange={e=>onChange({ ...wf, description: e.target.value })}/>
          <hr className="sep"/>
          <label className="eyebrow">VERSION</label>
          <div className="mono" style={{ marginTop:4 }}>v{wf.version || '0.1.0'}</div>
          <hr className="sep"/>
          <label className="eyebrow">SUMMARY</label>
          <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginTop:6, lineHeight:1.55 }}>
            {wf.nodes.filter(n=>n.kind==='stage').length} stages ·
            {' '}{wf.nodes.filter(n=>n.kind==='gate').length} gates ·
            {' '}{wf.nodes.filter(n=>n.kind==='cond').length} conditions ·
            {' '}{wf.edges.length} edges
          </div>
          <div style={{ marginTop:10, display:'flex', gap:6 }}>
            <span className="badge b-crit" style={{ opacity: validation.summary.errs?1:.3 }}>{validation.summary.errs} err</span>
            <span className="badge b-warn" style={{ opacity: validation.summary.warns?1:.3 }}>{validation.summary.warns} warn</span>
          </div>
        </div>
      </div>
    );
  }

  const updateMember = (idx, patch) => {
    const members = [...(node.members||[])];
    members[idx] = { ...members[idx], ...patch };
    onChange({ ...node, members });
  };
  const removeMember = (idx) => {
    const members = (node.members||[]).filter((_,i)=>i!==idx);
    onChange({ ...node, members });
  };
  const addMember = (personaId) => {
    const members = [...(node.members||[]), { persona: personaId, budget: 40 }];
    onChange({ ...node, members });
  };

  const nodeIssues = validation.issues.filter(i => i.node_id === node.id);

  return (
    <div className="wf-insp">
      <div className="wf-insp-head">
        <h3>
          {node.kind === 'stage' && '◆ Stage'}
          {node.kind === 'gate' && '⌘ Gate'}
          {node.kind === 'cond' && '? Condition'}
          {node.kind === 'trigger' && '⚡ Trigger'}
          {node.kind === 'end' && '● End'}
          <span className="mono faint" style={{ fontSize:10, marginLeft:'auto' }}>{node.id}</span>
        </h3>
      </div>
      {node.kind === 'stage' && (
        <div className="wf-insp-tabs">
          <button className={tab==='config'?'active':''} onClick={()=>setTab('config')}>Config</button>
          <button className={tab==='flock'?'active':''} onClick={()=>setTab('flock')}>Flock</button>
          <button className={tab==='valid'?'active':''} onClick={()=>setTab('valid')}>Validate</button>
        </div>
      )}
      <div className="wf-insp-body">
        {node.kind === 'stage' && tab==='config' && (
          <>
            <label className="eyebrow">NAME</label>
            <input className="input mono" style={{ marginTop:4 }} value={node.name||''} onChange={e=>onChange({ ...node, name: e.target.value })}/>
            <label className="eyebrow" style={{ marginTop:12, display:'block' }}>EXECUTION</label>
            <div style={{ marginTop:4 }}>
              <Seg value={node.mode||'parallel'} options={[{value:'parallel',label:'parallel'},{value:'sequential',label:'sequential'}]} onChange={v=>onChange({ ...node, mode: v })}/>
            </div>
            <label className="eyebrow" style={{ marginTop:12, display:'block' }}>MAX CONCURRENT</label>
            <input className="input mono" style={{ marginTop:4, width:120 }} defaultValue="3"/>
            {(validation.inbound[node.id]||[]).length > 1 && (
              <>
                <hr className="sep"/>
                <label className="eyebrow">JOIN MODE · {(validation.inbound[node.id]||[]).length} INCOMING BRANCHES</label>
                <div style={{ marginTop:6 }}>
                  <Seg
                    value={node.joinMode || 'all'}
                    options={[
                      {value:'all',   label:'all'},
                      {value:'any',   label:'any'},
                      {value:'merge', label:'merge'},
                    ]}
                    onChange={v=>onChange({ ...node, joinMode: v })}/>
                </div>
                <div className="muted" style={{ fontSize:11, marginTop:6, lineHeight:1.5 }}>
                  <b style={{ color:'var(--color-text-secondary)' }}>all</b> — wait for every branch to complete (default).{' '}
                  <b style={{ color:'var(--color-text-secondary)' }}>any</b> — first branch wins, others are cancelled.{' '}
                  <b style={{ color:'var(--color-text-secondary)' }}>merge</b> — deduplicate duplicate events across branches.
                </div>
                <div style={{ marginTop:10, padding:'8px 10px', background:'var(--color-bg-tertiary)', border:'1px solid var(--color-border-subtle)', borderRadius:6 }}>
                  <div className="eyebrow" style={{ marginBottom:4 }}>INCOMING FROM</div>
                  {(validation.inbound[node.id]||[]).map(upId => {
                    const up = wf.nodes.find(x=>x.id===upId);
                    return (
                      <div key={upId} className="mono" style={{ fontSize:11, color:'var(--color-text-secondary)', padding:'2px 0' }}>
                        ← {up?.name || up?.label || upId} <span className="faint">· {up?.kind}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
        {node.kind === 'stage' && tab==='flock' && (
          <>
            <label className="eyebrow">PERSONAS IN THIS STAGE</label>
            <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:6 }}>
              {(node.members||[]).map((m, i) => {
                const p = PERSONA_BY_ID[m.persona];
                const myIssues = nodeIssues.filter(x => x.member_index === i);
                return (
                  <div key={i} style={{ border:'1px solid var(--color-border-subtle)', borderRadius:8, padding:10, background:'var(--color-bg-tertiary)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <PersonaAvatar personaId={m.persona}/>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:600 }}>{p?.name}</div>
                        <div className="mono faint" style={{ fontSize:10 }}>{p?.role}</div>
                      </div>
                      <button className="btn sm ghost" onClick={()=>removeMember(i)}>×</button>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:6, marginTop:8, fontSize:11 }}>
                      <span className="muted">budget</span>
                      <input className="input mono" style={{ padding:'2px 6px', fontSize:11 }} value={m.budget} onChange={e=>updateMember(i,{budget:parseInt(e.target.value)||0})}/>
                    </div>
                    <div style={{ marginTop:8 }}>
                      <div className="mono faint" style={{ fontSize:10, marginBottom:3 }}>CONSUMES</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                        {p?.consumes.map(e => <span key={e} className="sub-tag">{e}</span>)}
                      </div>
                      <div className="mono faint" style={{ fontSize:10, marginTop:6, marginBottom:3 }}>PRODUCES</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                        {p?.produces.map(e => {
                          const isDead = myIssues.some(x => x.code==='dead-publisher' && x.event===e);
                          return <span key={e} className={`sub-tag ${isDead?'missing':'pub'}`}>{e}</span>;
                        })}
                      </div>
                    </div>
                    {myIssues.length > 0 && (
                      <div style={{ marginTop:8, padding:6, borderRadius:4, background:'color-mix(in srgb, var(--color-critical) 12%, transparent)', border:'1px solid var(--color-critical-bo)', fontSize:11 }}>
                        {myIssues.map((iss, k) => (
                          <div key={k} style={{ display:'flex', gap:6, color:'var(--color-critical-fg)', marginTop: k?6:0 }}>
                            <span>⚠</span>
                            <div>{iss.msg}<div className="mono faint" style={{ fontSize:10, marginTop:2 }}>{iss.fix}</div></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <hr className="sep"/>
            <label className="eyebrow">ADD PERSONA</label>
            <select className="input" style={{ marginTop:6 }} onChange={e=>{ if (e.target.value) { addMember(e.target.value); e.target.value=''; } }}>
              <option value="">Select a persona…</option>
              {PERSONAS.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
            </select>
          </>
        )}
        {node.kind === 'stage' && tab==='valid' && (
          <ValidationDetail issues={nodeIssues}/>
        )}
        {node.kind === 'cond' && (
          <>
            <label className="eyebrow">NAME</label>
            <input className="input" style={{ marginTop:4 }} value={node.name||''} onChange={e=>onChange({ ...node, name: e.target.value })}/>
            <label className="eyebrow" style={{ marginTop:12, display:'block' }}>EXPRESSION</label>
            <textarea className="input mono" style={{ marginTop:4, minHeight:80 }} value={node.expr||''} onChange={e=>onChange({ ...node, expr: e.target.value })} placeholder="stages.review.verdict == pass"/>
            <div className="muted" style={{ fontSize:11, marginTop:6 }}>Tyr's <code>condition_evaluator</code> accepts expressions over prior stage verdicts, confidence scores, and event payloads.</div>
          </>
        )}
        {node.kind === 'gate' && (
          <>
            <label className="eyebrow">GATE NAME</label>
            <input className="input" style={{ marginTop:4 }} value={node.name||''} onChange={e=>onChange({ ...node, name: e.target.value })}/>
            <label className="eyebrow" style={{ marginTop:12, display:'block' }}>APPROVERS</label>
            <input className="input mono" style={{ marginTop:4 }} defaultValue="jonas@niuulabs.io"/>
            <label className="eyebrow" style={{ marginTop:12, display:'block' }}>AUTO-FORWARD AFTER</label>
            <input className="input mono" style={{ marginTop:4 }} defaultValue="30m"/>
          </>
        )}
        {node.kind === 'trigger' && (
          <>
            <label className="eyebrow">LABEL</label>
            <input className="input" style={{ marginTop:4 }} value={node.label||''} onChange={e=>onChange({ ...node, label: e.target.value })}/>
            <label className="eyebrow" style={{ marginTop:12, display:'block' }}>SOURCE EVENT</label>
            <select className="input" style={{ marginTop:4 }} defaultValue="manual">
              <option value="manual">manual dispatch</option>
              <option value="tracker.issue.ingested">tracker.issue.ingested</option>
              <option value="code.changed">code.changed</option>
              <option value="schedule">schedule</option>
            </select>
          </>
        )}
        {(node.kind === 'stage' || node.kind === 'cond' || node.kind === 'gate') && (
          <>
            <hr className="sep"/>
            <button className="btn danger sm" onClick={onDelete}>Delete node</button>
          </>
        )}
      </div>
    </div>
  );
}

function ValidationDetail({ issues }) {
  if (!issues.length) return (
    <div style={{ padding:16, textAlign:'center' }}>
      <div className="eyebrow" style={{ color:'#86efac' }}>✓ valid</div>
      <div className="muted" style={{ fontSize:12, marginTop:6 }}>All subscriptions resolve.</div>
    </div>
  );
  return (
    <div>
      {issues.map((iss, i) => (
        <div key={i} className={`validation-item ${iss.severity}`} style={{ position:'relative', marginBottom:8, background:'var(--color-bg-tertiary)', backdropFilter:'none' }}>
          <span className="lbl">{iss.severity === 'err' ? '●ERR' : '▲WRN'}</span>
          <div>
            <div>{iss.msg}</div>
            {iss.fix && <div className="mono faint" style={{ fontSize:10, marginTop:3 }}>{iss.fix}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────
//  GRAPH CANVAS (variant A) — node-graph DAG
// ──────────────────────────────────────────
function GraphCanvas({ wf, setWf, selectedId, setSelectedId }) {
  const [drag, setDrag] = wuS(null); // {id, offx, offy}
  const [dropGhost, setDropGhost] = wuS(null);
  const [view, setView] = wuS({ x: 0, y: 0, z: 1 });
  const [pan, setPan] = wuS(null); // {startX, startY, origX, origY}
  const wrapRef = wuR(null);
  const graphW = 2400, graphH = 1400;

  const updateNode = (id, patch) => {
    setWf({ ...wf, nodes: wf.nodes.map(n => n.id===id ? { ...n, ...patch } : n) });
  };

  // ─── zoom & pan ───
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const applyZoom = (factor, cx, cy) => {
    setView(v => {
      const z2 = clamp(v.z * factor, 0.3, 2.5);
      // keep the pivot (cx,cy) stable in viewport
      const ratio = z2 / v.z;
      return {
        z: z2,
        x: cx - (cx - v.x) * ratio,
        y: cy - (cy - v.y) * ratio,
      };
    });
  };
  const recenter = wuC(() => {
    if (!wrapRef.current || !wf.nodes.length) return;
    const w = wrapRef.current.clientWidth, h = wrapRef.current.clientHeight;
    // bounding box of nodes
    const minX = Math.min(...wf.nodes.map(n=>n.x));
    const minY = Math.min(...wf.nodes.map(n=>n.y));
    const maxX = Math.max(...wf.nodes.map(n=>n.x + nodeWidth(n)));
    const maxY = Math.max(...wf.nodes.map(n=>n.y + stageHeight(n)));
    const bw = maxX - minX + 80, bh = maxY - minY + 80;
    const z = clamp(Math.min(w / bw, h / bh, 1), 0.3, 1.2);
    setView({
      z,
      x: (w - bw * z) / 2 - (minX - 40) * z,
      y: (h - bh * z) / 2 - (minY - 40) * z,
    });
  }, [wf.nodes]);
  wuE(() => { recenter(); }, []); // initial fit
  const resetZoom = () => setView({ x: 0, y: 0, z: 1 });

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // require modifier so scroll still works
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    applyZoom(e.deltaY < 0 ? 1.12 : 1/1.12, cx, cy);
  };

  const onMouseDownNode = (e, n) => {
    e.stopPropagation();
    setSelectedId(n.id);
    setDrag({ id: n.id, startClientX: e.clientX, startClientY: e.clientY, origNx: n.x, origNy: n.y });
  };
  const onMouseDownBg = (e) => {
    if (e.target !== e.currentTarget && !e.target.classList.contains('wf-graph')) return;
    setSelectedId(null);
    setPan({ startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y });
  };
  const onMouseMove = (e) => {
    if (drag) {
      const dx = (e.clientX - drag.startClientX) / view.z;
      const dy = (e.clientY - drag.startClientY) / view.z;
      updateNode(drag.id, {
        x: Math.max(0, Math.round((drag.origNx + dx) / 10) * 10),
        y: Math.max(0, Math.round((drag.origNy + dy) / 10) * 10),
      });
    } else if (pan) {
      setView(v => ({ ...v, x: pan.origX + (e.clientX - pan.startX), y: pan.origY + (e.clientY - pan.startY) }));
    }
  };
  const onMouseUp = () => { setDrag(null); setPan(null); };

  const onDragOver = (e) => {
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    const gx = (e.clientX - rect.left - view.x) / view.z;
    const gy = (e.clientY - rect.top - view.y) / view.z;
    setDropGhost({ x: gx - 120, y: gy - 30 });
  };
  const onDrop = (e) => {
    e.preventDefault();
    const payload = JSON.parse(e.dataTransfer.getData('application/json')||'{}');
    const rect = wrapRef.current.getBoundingClientRect();
    const gx = (e.clientX - rect.left - view.x) / view.z;
    const gy = (e.clientY - rect.top - view.y) / view.z;
    const id = payload.kind[0] + Math.random().toString(36).slice(2,6);
    const newNode = { id, kind: payload.kind, x: Math.round((gx-120)/10)*10, y: Math.round((gy-30)/10)*10, name: payload.kind + ' ' + wf.nodes.filter(n=>n.kind===payload.kind).length };
    if (payload.kind==='stage') newNode.members = payload.newMember ? [payload.newMember] : [];
    if (payload.kind==='cond') newNode.expr = '';
    setWf({ ...wf, nodes: [...wf.nodes, newNode] });
    setSelectedId(id);
    setDropGhost(null);
  };

  const validation = wuM(()=>validateWorkflow(wf), [wf]);

  return (
    <div
      ref={wrapRef}
      className="wf-canvas-wrap wf-canvas-interactive"
      style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', cursor: pan ? 'grabbing' : 'default' }}
      onDragOver={onDragOver} onDrop={onDrop}
      onMouseDown={onMouseDownBg}
      onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onWheel={onWheel}>
      {/* dot-grid background stays fixed (not transformed) so it reads as a "canvas" */}
      <div className="wf-grid-bg" aria-hidden="true"/>

      <div
        className="wf-graph"
        style={{
          width: graphW, height: graphH,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          transformOrigin: '0 0',
          position: 'absolute', left: 0, top: 0,
        }}>
        <svg className="wf-edges" width={graphW} height={graphH}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#7dd3fc" />
            </marker>
          </defs>
          {wf.edges.map((e, i) => {
            const from = wf.nodes.find(n=>n.id===e.from); const to = wf.nodes.find(n=>n.id===e.to);
            if (!from || !to) return null;
            const fp = portPos(from), tp = portPos(to);
            const invalid = validation.issues.some(iss => iss.node_id === e.to && iss.code === 'starved-consumer');
            const cls = e.cond ? 'cond' : invalid ? 'invalid' : 'solid';
            return (
              <g key={i}>
                <path d={edgePath({x:fp.outX,y:fp.outY},{x:tp.inX,y:tp.inY})} className={cls} markerEnd="url(#arr)"/>
                {e.label && (()=>{
                  const mx=(fp.outX+tp.inX)/2, my=(fp.outY+tp.inY)/2-4;
                  return <g>
                    <rect x={mx-18} y={my-10} width={36} height={16} rx={3} fill="#27272a" stroke="#3f3f46"/>
                    <text x={mx} y={my+1} fill="#a1a1aa" fontSize="10" fontFamily="JetBrains Mono" textAnchor="middle">{e.label}</text>
                  </g>;
                })()}
              </g>
            );
          })}
        </svg>

        {wf.nodes.map(n => {
          const invalid = validation.issues.some(x => x.node_id === n.id);
          const inCount = (validation.inbound[n.id]||[]).length;
          const isFanIn = inCount > 1;
          const joinMode = n.joinMode || 'all';
          return (
            <div key={n.id}
              className={`wf-node kind-${n.kind} ${selectedId===n.id?'selected':''} ${invalid?'invalid':''}`}
              style={{ left:n.x, top:n.y, width: nodeWidth(n) }}
              onMouseDown={e=>onMouseDownNode(e,n)}
              onClick={e=>{ e.stopPropagation(); setSelectedId(n.id); }}>
              {isFanIn && (n.kind==='stage' || n.kind==='gate') && (
                <span className={`fan-in-badge join-${joinMode}`} title={`Fan-in · ${inCount} branches · join=${joinMode}`}>
                  ⋈ {inCount} · {joinMode}
                </span>
              )}
              <div className="hdr">
                <span className="rune">
                  {n.kind==='trigger'?'⚡':n.kind==='stage'?'◆':n.kind==='cond'?'?':n.kind==='gate'?'⌘':'●'}
                </span>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {n.kind==='stage' ? (n.name||'stage') :
                   n.kind==='cond'  ? (n.name||'condition') :
                   n.kind==='gate'  ? (n.name||'human gate') :
                   n.kind==='trigger' ? (n.label||'trigger') :
                   (n.label||'end')}
                </span>
              </div>
              {n.kind==='stage' && (
                <div className="body">
                  <div className="stage-parts">
                    {(n.members||[]).map((m, idx) => {
                      const p = PERSONA_BY_ID[m.persona];
                      const hasIssue = validation.issues.some(x => x.node_id===n.id && x.member_index===idx && x.severity==='warn');
                      return (
                        <div key={idx} className={`stage-part ${hasIssue?'missing-pub':''}`}>
                          <PersonaAvatar personaId={m.persona} size={18}/>
                          <span>{p?.name}</span>
                          <span className="muted">{m.budget}</span>
                        </div>
                      );
                    })}
                    {(n.members||[]).length === 0 && (
                      <div className="stage-part" style={{ opacity:.5 }}><span/><span className="mono faint">no personas</span><span/></div>
                    )}
                  </div>
                  <div className="meta-row">
                    <span>{n.mode||'parallel'}</span>
                    <span style={{ marginLeft:'auto' }}>{(n.members||[]).length} ravens</span>
                  </div>
                </div>
              )}
              {n.kind==='cond' && (
                <div className="body"><span className="mono" style={{ color:'#e9d5ff' }}>{n.expr || 'expr …'}</span></div>
              )}
              {n.kind==='gate' && (
                <div className="body"><span>approvers · jonas</span></div>
              )}
              {n.kind==='trigger' && (
                <div className="body"><span className="mono">{n.source||'manual'}</span></div>
              )}
              {n.kind==='end' && null}
              <div className="ports l"><div className="port"/></div>
              <div className="ports r"><div className="port"/></div>
            </div>
          );
        })}
        {dropGhost && <div className="wf-drop-ghost" style={{ left:dropGhost.x, top:dropGhost.y, width:240, height:80 }}/>}
      </div>

      {/* Zoom controls — bottom-right of canvas */}
      <div className="wf-zoom">
        <button className="wf-zoom-btn" title="Zoom in (Ctrl +)" onClick={()=>{
          const rect = wrapRef.current.getBoundingClientRect();
          applyZoom(1.2, rect.width/2, rect.height/2);
        }}>+</button>
        <button className="wf-zoom-btn" title="Zoom out (Ctrl −)" onClick={()=>{
          const rect = wrapRef.current.getBoundingClientRect();
          applyZoom(1/1.2, rect.width/2, rect.height/2);
        }}>−</button>
        <div className="wf-zoom-pct" title="Current zoom">{Math.round(view.z * 100)}%</div>
        <button className="wf-zoom-btn" title="Fit all nodes" onClick={recenter}>⛶</button>
        <button className="wf-zoom-btn" title="Reset to 100%" onClick={resetZoom}>1:1</button>
      </div>
      <div className="wf-zoom-hint mono faint">⌘/ctrl + scroll to zoom · drag bg to pan</div>
    </div>
  );
}

// ──────────────────────────────────────────
//  PIPELINE CANVAS (variant B) — vertical stages
// ──────────────────────────────────────────
function PipelineCanvas({ wf, setWf, selectedId, setSelectedId }) {
  const validation = wuM(()=>validateWorkflow(wf), [wf]);
  // topological-ish ordering — follow edges from trigger
  const byId = Object.fromEntries(wf.nodes.map(n=>[n.id,n]));
  const outs = {}; wf.nodes.forEach(n => outs[n.id] = []); wf.edges.forEach(e => outs[e.from] && outs[e.from].push(e.to));
  const order = [];
  const seen = new Set();
  const start = wf.nodes.find(n=>n.kind==='trigger') || wf.nodes[0];
  const queue = [start.id];
  while (queue.length) { const id = queue.shift(); if (seen.has(id)) continue; seen.add(id); order.push(id); (outs[id]||[]).forEach(x=>queue.push(x)); }
  wf.nodes.forEach(n => { if (!seen.has(n.id)) order.push(n.id); });

  return (
    <div className="wf-canvas-wrap" style={{ flex:1, minHeight:0, position:'relative' }}>
      <div className="wf-canvas">
        <div className="wf-pipe-canvas">
          {order.map((id, idx) => {
            const n = byId[id]; if (!n) return null;
            const isLast = idx === order.length - 1;
            const invalid = validation.issues.some(x => x.node_id === n.id);

            if (n.kind === 'trigger') return (
              <React.Fragment key={n.id}>
                <div className={`wf-pipe-stage ${selectedId===n.id?'selected':''}`} style={{ background:'var(--color-bg-tertiary)' }} onClick={()=>setSelectedId(n.id)}>
                  <div className="h"><h4>⚡ {n.label}</h4><span className="chip mono">trigger</span></div>
                </div>
                {!isLast && <div className="wf-pipe-connector"/>}
              </React.Fragment>
            );

            if (n.kind === 'end') return (
              <React.Fragment key={n.id}>
                <div className={`wf-pipe-stage ${selectedId===n.id?'selected':''}`} style={{ background:'var(--color-bg-tertiary)' }} onClick={()=>setSelectedId(n.id)}>
                  <div className="h"><h4>● {n.label || 'end'}</h4><span className="chip mono">end</span></div>
                </div>
              </React.Fragment>
            );

            if (n.kind === 'cond') return (
              <React.Fragment key={n.id}>
                <div className={`wf-pipe-stage ${selectedId===n.id?'selected':''} ${invalid?'invalid':''}`} style={{ background:'color-mix(in srgb, #a855f7 8%, var(--color-bg-secondary))' }} onClick={()=>setSelectedId(n.id)}>
                  <div className="h"><h4>? {n.name}</h4><span className="chip mono">condition</span></div>
                  <div className="mono" style={{ fontSize:11, color:'#e9d5ff' }}>{n.expr}</div>
                </div>
                {!isLast && <div className="wf-pipe-connector"/>}
              </React.Fragment>
            );

            if (n.kind === 'gate') return (
              <React.Fragment key={n.id}>
                <div className={`wf-pipe-stage ${selectedId===n.id?'selected':''}`} style={{ background:'color-mix(in srgb, #a855f7 10%, var(--color-bg-secondary))', borderColor:'color-mix(in srgb, #a855f7 35%, transparent)' }} onClick={()=>setSelectedId(n.id)}>
                  <div className="h"><h4>⌘ {n.name}</h4><span className="chip mono">human gate</span></div>
                  <div className="mono faint" style={{ fontSize:11 }}>approvers · jonas@niuulabs.io</div>
                </div>
                {!isLast && <div className="wf-pipe-connector"/>}
              </React.Fragment>
            );

            // stage
            return (
              <React.Fragment key={n.id}>
                <div className={`wf-pipe-stage ${selectedId===n.id?'selected':''} ${invalid?'invalid':''}`} onClick={()=>setSelectedId(n.id)}>
                  <div className="h">
                    <h4>◆ {n.name}</h4>
                    <div style={{ display:'flex', gap:6 }}>
                      <span className="chip mono">{n.mode||'parallel'}</span>
                      <span className="chip mono">{(n.members||[]).length} ravens</span>
                    </div>
                  </div>
                  <div className={`wf-pipe-parts ${(n.members||[]).length===1?'single':''}`}>
                    {(n.members||[]).map((m, i) => {
                      const p = PERSONA_BY_ID[m.persona];
                      const myIssues = validation.issues.filter(x => x.node_id===n.id && x.member_index===i);
                      const hasDead = myIssues.some(x => x.code==='dead-publisher');
                      return (
                        <div key={i} className={`wf-pipe-part ${hasDead?'missing-pub':''}`}>
                          <PersonaAvatar personaId={m.persona} size={22}/>
                          <div>
                            <div className="name">{p?.name}</div>
                            <div className="mono faint" style={{ fontSize:10, marginTop:1 }}>{p?.produces.join(' · ')}</div>
                          </div>
                          <span className="mono faint" style={{ fontSize:10 }}>b{m.budget}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {!isLast && <div className="wf-pipe-connector"/>}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────
//  YAML VIEW — read-only live preview
// ──────────────────────────────────────────
function YamlCanvas({ wf }) {
  const yaml = wuM(()=>workflowToYAML(wf), [wf]);
  const html = wuM(()=>highlightYAML(yaml), [yaml]);
  return (
    <div className="wf-yaml" style={{ flex:1, minHeight:0, overflow:'auto' }} dangerouslySetInnerHTML={{ __html: html }}/>
  );
}

// ──────────────────────────────────────────
//  VALIDATION PANEL — collapsible pill w/ scrollable expansion
// ──────────────────────────────────────────
function ValidationPanel({ validation, setSelectedId }) {
  const [open, setOpen] = wuS(false);
  const { errs, warns } = validation.summary;
  const clean = errs === 0 && warns === 0;
  const state = errs > 0 ? 'err' : warns > 0 ? 'warn' : 'ok';

  return (
    <div className={`wf-valid-panel state-${state} ${open?'open':''}`}>
      <button className="wf-valid-header" onClick={()=>setOpen(!open)} title={open?'Collapse':'Expand'}>
        <span className="wf-valid-dot"/>
        {clean ? (
          <><span className="wf-valid-label">all subscriptions resolve</span><span className="wf-valid-sub mono">ready</span></>
        ) : (
          <>
            {errs > 0 && <span className="wf-valid-chip err"><span className="mono">err</span>{errs}</span>}
            {warns > 0 && <span className="wf-valid-chip warn"><span className="mono">warn</span>{warns}</span>}
            <span className="wf-valid-sub mono">{open?'hide':'review'}</span>
          </>
        )}
        <span className="wf-valid-carat">{open ? '▾' : '▸'}</span>
      </button>
      {open && !clean && (
        <div className="wf-valid-list">
          {validation.issues.map((iss, i) => (
            <div key={i} className={`wf-valid-row ${iss.severity}`}>
              <span className="lbl mono">{iss.severity === 'err' ? 'ERR' : 'WRN'}</span>
              <div className="body">
                <div className="msg">{iss.msg}</div>
                {iss.fix && <div className="fix mono faint">{iss.fix}</div>}
                {iss.code && <div className="code mono faint">[{iss.code}]</div>}
              </div>
              <div className="acts">
                {iss.node_id && <button className="btn sm ghost" onClick={()=>setSelectedId(iss.node_id)}>Focus</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────
//  WORKFLOWS VIEW (outer)
// ──────────────────────────────────────────
function WorkflowsView({ templates, setTemplates, activeTemplateId, setActiveTemplateId }) {
  const [viewMode, setViewMode] = wuS('graph'); // graph | pipeline | yaml
  const [wf, setWf] = wuS(() => {
    if (activeTemplateId === 'draft') return DEFAULT_DRAFT;
    const t = templates.find(x=>x.id===activeTemplateId); return t ? { ...t } : DEFAULT_DRAFT;
  });
  const [selectedId, setSelectedId] = wuS(null);

  wuE(()=>{
    if (activeTemplateId === 'draft') setWf(DEFAULT_DRAFT);
    else {
      const t = templates.find(x=>x.id===activeTemplateId);
      if (t) setWf({ ...t });
    }
    setSelectedId(null);
  }, [activeTemplateId]);

  const validation = wuM(()=>validateWorkflow(wf), [wf]);

  const onLibDragStart = (e, payload) => {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
  };

  const selectedNode = wf.nodes.find(n => n.id === selectedId);
  const updateNode = (patched) => setWf({ ...wf, nodes: wf.nodes.map(n => n.id===patched.id ? patched : n) });
  const deleteNode = () => {
    setWf({ ...wf, nodes: wf.nodes.filter(n => n.id !== selectedId), edges: wf.edges.filter(e => e.from !== selectedId && e.to !== selectedId) });
    setSelectedId(null);
  };

  return (
    <div className="wf-shell" style={{ height:'100%' }}>
      <Library onDragStart={onLibDragStart}/>
      <div className="wf-center">
        {/* Single unified toolbar — in flow, not floating */}
        <div className="wf-toolbar">
          <input className="wf-name-input" value={wf.name} onChange={e=>setWf({ ...wf, name: e.target.value })}/>
          <span className="chip mono">v{wf.version || '0.1.0'}</span>
          <span className="sep"/>
          <div className="wf-viewmode">
            <button className={viewMode==='graph'?'active':''} onClick={()=>setViewMode('graph')}>Graph</button>
            <button className={viewMode==='pipeline'?'active':''} onClick={()=>setViewMode('pipeline')}>Pipeline</button>
            <button className={viewMode==='yaml'?'active':''} onClick={()=>setViewMode('yaml')}>YAML</button>
          </div>
          <div className="wf-toolbar-spacer"/>
          <button className="btn sm ghost" title="Undo">↶</button>
          <button className="btn sm ghost" title="Redo">↷</button>
          <span className="sep"/>
          <button className="btn sm ghost" title="Diff against last save">Diff</button>
          <button className="btn sm ghost">History</button>
          <button className="btn sm">Save as…</button>
          <button className="btn sm primary" disabled={validation.hasErrors} title={validation.hasErrors?'Fix errors first':'Test with mock inputs'}>▶ Test</button>
          <button className="btn sm primary" disabled={validation.hasErrors}>↯ Dispatch</button>
        </div>

        {/* canvas area fills remaining space */}
        <div className="wf-canvas-wrap">
          {viewMode === 'graph'    && <GraphCanvas    wf={wf} setWf={setWf} selectedId={selectedId} setSelectedId={setSelectedId}/>}
          {viewMode === 'pipeline' && <PipelineCanvas wf={wf} setWf={setWf} selectedId={selectedId} setSelectedId={setSelectedId}/>}
          {viewMode === 'yaml'     && <YamlCanvas     wf={wf}/>}

          {/* validation bar — collapsible pill */}
          {viewMode !== 'yaml' && (
            <ValidationPanel validation={validation} setSelectedId={setSelectedId}/>
          )}
        </div>
      </div>
      <Inspector node={selectedNode} onChange={(selectedNode?updateNode:(newWf)=>setWf(newWf))} onDelete={deleteNode} validation={validation} wf={wf}/>
    </div>
  );
}

Object.assign(window, { WorkflowsView });
