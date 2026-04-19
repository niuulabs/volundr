/* global React */
// ─── Flokk Observatory — Registry editor tab (pluggable) ──────────

const { useState, useMemo } = React;

function RegistryView({ registry, setRegistry }) {
  const [tab, setTab] = useState('types');
  const [selectedId, setSelectedId] = useState(registry.types[0]?.id);
  const [search, setSearch] = useState('');
  const selected = registry.types.find(t=>t.id===selectedId);

  const filtered = useMemo(()=>{
    if (!search) return registry.types;
    const q = search.toLowerCase();
    return registry.types.filter(t => t.label.toLowerCase().includes(q) || t.id.includes(q) || t.description.toLowerCase().includes(q));
  }, [registry.types, search]);

  const byCategory = useMemo(()=>{
    const m = new Map();
    filtered.forEach(t=>{
      if(!m.has(t.category)) m.set(t.category,[]);
      m.get(t.category).push(t);
    });
    return m;
  }, [filtered]);

  const updateType = (id, patch) => {
    setRegistry(r => ({
      ...r,
      updatedAt: new Date().toISOString(),
      types: r.types.map(t => t.id===id ? {...t, ...patch} : t),
    }));
  };

  return (
    <div className="registry">
      <div className="registry-main">
        <div className="registry-head">
          <div className="registry-title">
            <h2>Entity type registry</h2>
            <p>Every node that appears in the Observatory canvas is an instance of one of these types. Edit a type here and the canvas re-renders. This is the source of truth referenced by the SDD at <code style={{color:'var(--brand-300)'}}>§4.1</code>.</p>
          </div>
          <div className="registry-version">
            <span>rev</span><strong>{registry.version}</strong>
            <span style={{color:'var(--color-text-faint)'}}>·</span>
            <span>{registry.types.length} types</span>
          </div>
        </div>

        <div className="registry-tabs">
          <button className={`registry-tab ${tab==='types'?'active':''}`} onClick={()=>setTab('types')}>Types</button>
          <button className={`registry-tab ${tab==='json'?'active':''}`} onClick={()=>setTab('json')}>JSON</button>
          <button className={`registry-tab ${tab==='containment'?'active':''}`} onClick={()=>setTab('containment')}>Containment</button>
          <div style={{flex:1}} />
          {tab==='types' && (
            <input className="field-input" placeholder="filter types…"
              value={search} onChange={e=>setSearch(e.target.value)}
              style={{marginBottom:4, height:32, width:220}} />
          )}
        </div>

        {tab==='types' && (
          <div>
            {[...byCategory.entries()].map(([cat, ts])=>(
              <div key={cat} style={{marginBottom:'var(--space-5)'}}>
                <div className="section-head" style={{marginTop:0}}>{cat} <span style={{fontFamily:'var(--font-mono)',color:'var(--color-text-faint)',fontWeight:400}}>· {ts.length}</span></div>
                <div className="type-grid">
                  {ts.map(t=>(
                    <div key={t.id} className={`type-card ${selectedId===t.id?'selected':''}`} onClick={()=>setSelectedId(t.id)}>
                      <div className="type-swatch">
                        <window.ShapeSvg shape={t.shape} color={t.color} size={22} />
                      </div>
                      <div className="type-name">
                        {t.label}
                        <span style={{fontFamily:'var(--font-mono)',color:'var(--color-brand)',fontSize:12,fontWeight:700}}>{t.rune}</span>
                      </div>
                      <div className="type-desc">{t.description.split('.')[0]}.</div>
                      <div className="type-meta">
                        <div className="type-id">{t.id}</div>
                        <div>shape · <strong style={{color:'var(--color-text-secondary)'}}>{t.shape}</strong></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab==='json' && (
          <div className="json-view">
{JSON.stringify(registry, null, 2)}
          </div>
        )}

        {tab==='containment' && (
          <ContainmentGraph registry={registry} onSelect={setSelectedId} selectedId={selectedId} setRegistry={setRegistry} />
        )}
      </div>

      <div className="inspector-panel">
        {!selected && <div className="inspector-empty">Select a type to edit.</div>}
        {selected && <TypeInspector type={selected} registry={registry} onChange={patch=>updateType(selected.id,patch)} />}
      </div>
    </div>
  );
}

function TypeInspector({ type, registry, onChange }) {
  const SHAPES = ['dot','ring','ring-dashed','rounded-rect','diamond','triangle','hex','chevron','square','square-sm','pentagon','halo','mimir','mimir-small'];
  const COLORS = ['brand','ice-100','ice-200','ice-300','brand-400','slate-300','slate-400'];
  const ICONS = ['globe','layers','server','bird','radio','shield','git-branch','waves','hammer','book-open','book-marked','box','cpu','printer','mic','wifi','users','zap','activity','database','cloud'];
  const ALL_IDS = registry.types.map(t=>t.id);

  return (
    <>
      <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',marginBottom:'var(--space-4)'}}>
        <div style={{width:48,height:48,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--color-bg-tertiary)',borderRadius:'var(--radius-md)',border:'1px solid var(--color-border-subtle)'}}>
          <window.ShapeSvg shape={type.shape} color={type.color} size={30} />
        </div>
        <div style={{flex:1}}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--color-text-muted)',textTransform:'uppercase',letterSpacing:'0.07em'}}>Type · {type.category}</div>
          <div style={{fontSize:'var(--text-lg)',fontWeight:600,letterSpacing:'-0.015em',display:'flex',alignItems:'center',gap:8}}>
            {type.label}
            <span style={{fontFamily:'var(--font-mono)',color:'var(--color-brand)',fontSize:16,fontWeight:700,textShadow:'0 0 10px color-mix(in srgb, var(--color-brand) 45%, transparent)'}}>{type.rune}</span>
          </div>
          <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--brand-300)',marginTop:2}}>{type.id}</div>
        </div>
      </div>

      <div className="field">
        <label className="field-label">Label</label>
        <input className="field-input" value={type.label} onChange={e=>onChange({label:e.target.value})} />
      </div>
      <div className="field">
        <label className="field-label">Description</label>
        <textarea className="field-textarea" style={{minHeight:80}} value={type.description} onChange={e=>onChange({description:e.target.value})} />
      </div>

      <div className="section-head">Visual</div>

      <div className="field">
        <label className="field-label">Shape</label>
        <div className="shape-grid">
          {SHAPES.map(s=>(
            <div key={s} className={`shape-cell ${type.shape===s?'on':''}`} title={s} onClick={()=>onChange({shape:s})}>
              <window.ShapeSvg shape={s} color={type.color} size={18} />
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">Color</label>
        <div className="color-swatches" style={{gridTemplateColumns:'repeat(7,1fr)'}}>
          {COLORS.map(c=>{
            const resolved = c==='brand' ? 'var(--color-brand)'
              : c.startsWith('ice-') || c.startsWith('brand-') ? `var(--brand-${c.split('-')[1]})`
              : c==='slate-400' ? 'var(--color-text-muted)' : 'var(--color-text-secondary)';
            return <div key={c} className={`color-swatch ${type.color===c?'on':''}`} style={{background:resolved}} title={c} onClick={()=>onChange({color:c})} />;
          })}
        </div>
      </div>

      <div className="field">
        <label className="field-label">Icon hint (for lists)</label>
        <div className="icon-grid">
          {ICONS.map(i=>(
            <div key={i} className={`icon-cell ${type.icon===i?'on':''}`} title={i} onClick={()=>onChange({icon:i})}>
              <window.Icon name={i} size={14} />
            </div>
          ))}
        </div>
      </div>

      <div className="field" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'var(--space-3)'}}>
        <div>
          <label className="field-label">Rune</label>
          <input className="field-input" style={{fontFamily:'var(--font-mono)',textAlign:'center',fontSize:18}} value={type.rune} onChange={e=>onChange({rune:e.target.value.slice(0,2)})} />
        </div>
        <div>
          <label className="field-label">Size</label>
          <input className="field-input" type="number" value={type.size} onChange={e=>onChange({size:+e.target.value})} />
        </div>
      </div>

      <div className="section-head">Containment</div>

      <div className="field">
        <label className="field-label">Can contain</label>
        <div className="chip-group">
          {ALL_IDS.filter(id=>id!==type.id).map(id=>(
            <div key={id} className={`chip ${type.canContain.includes(id)?'on':''}`}
              onClick={()=>onChange({
                canContain: type.canContain.includes(id)
                  ? type.canContain.filter(x=>x!==id)
                  : [...type.canContain, id]
              })}>{id}</div>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">Can live inside</label>
        <div className="chip-group">
          {ALL_IDS.filter(id=>id!==type.id).map(id=>(
            <div key={id} className={`chip ${type.parentTypes.includes(id)?'on':''}`}
              onClick={()=>onChange({
                parentTypes: type.parentTypes.includes(id)
                  ? type.parentTypes.filter(x=>x!==id)
                  : [...type.parentTypes, id]
              })}>{id}</div>
          ))}
        </div>
      </div>

      <div className="section-head">Fields</div>

      {type.fields.length===0 && <div style={{fontSize:12,color:'var(--color-text-muted)',fontFamily:'var(--font-mono)'}}>— no fields —</div>}
      {type.fields.map((f,i)=>(
        <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 80px 30px',gap:6,marginBottom:6,alignItems:'center'}}>
          <input className="field-input" style={{height:28,fontSize:11,padding:'4px 8px'}} value={f.label} onChange={e=>{
            const fields = [...type.fields]; fields[i] = {...f, label:e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g,'_')}; onChange({fields});
          }} />
          <select className="field-select" style={{height:28,fontSize:11,padding:'4px 8px'}} value={f.type} onChange={e=>{
            const fields = [...type.fields]; fields[i] = {...f, type:e.target.value}; onChange({fields});
          }}>
            {['string','number','select','tags','boolean'].map(t=><option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn ghost" style={{padding:'4px 8px',fontSize:11}} onClick={()=>{
            const fields = [...type.fields]; fields.splice(i,1); onChange({fields});
          }}>×</button>
        </div>
      ))}
      <button className="btn" style={{marginTop:4}} onClick={()=>onChange({fields:[...type.fields,{key:'newField',label:'New field',type:'string'}]})}>+ add field</button>
    </>
  );
}

// Simple containment graph visualisation — SVG tree of parentTypes → canContain
function ContainmentGraph({ registry, onSelect, selectedId, setRegistry }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [invalid, setInvalid] = useState(false);

  // Build hierarchy depth: entities with no parentTypes are roots
  const byId = new Map(registry.types.map(t=>[t.id,t]));
  const roots = registry.types.filter(t=>t.parentTypes.length===0);

  // Does `descendantId` appear anywhere beneath `ancestorId` in the canContain DAG?
  const isDescendant = (ancestorId, descendantId) => {
    if (ancestorId === descendantId) return true;
    const seen = new Set();
    const walk = (id) => {
      if (seen.has(id)) return false; seen.add(id);
      const t = byId.get(id); if (!t) return false;
      for (const c of t.canContain) {
        if (c === descendantId) return true;
        if (walk(c)) return true;
      }
      return false;
    };
    return walk(ancestorId);
  };

  const reparent = (childId, newParentId) => {
    setRegistry(r => {
      const updatedAt = new Date().toISOString();
      const types = r.types.map(t => {
        let next = t;
        // Remove child from any previous parents' canContain lists
        if (next.canContain.includes(childId) && next.id !== newParentId) {
          next = { ...next, canContain: next.canContain.filter(id => id !== childId) };
        }
        // Add child to new parent's canContain (if not already there)
        if (next.id === newParentId && !next.canContain.includes(childId)) {
          next = { ...next, canContain: [...next.canContain, childId] };
        }
        // Rewrite child's parentTypes to just the new parent (single-parent tree)
        if (next.id === childId) {
          next = { ...next, parentTypes: [newParentId] };
        }
        return next;
      });
      return { ...r, types, updatedAt, version: r.version + 1 };
    });
  };

  const handleDragStart = (e, id) => {
    setDragId(id); setInvalid(false);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch {}
  };
  const handleDragOver = (e, targetId) => {
    if (!dragId) return;
    const bad = isDescendant(dragId, targetId) || dragId === targetId;
    e.dataTransfer.dropEffect = bad ? 'none' : 'move';
    e.preventDefault();
    if (overId !== targetId || invalid !== bad) { setOverId(targetId); setInvalid(bad); }
  };
  const handleDragLeave = (e, targetId) => {
    if (overId === targetId) { setOverId(null); setInvalid(false); }
  };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    const bad = isDescendant(dragId, targetId) || dragId === targetId;
    if (!bad && dragId && targetId) reparent(dragId, targetId);
    setDragId(null); setOverId(null); setInvalid(false);
  };
  const handleDragEnd = () => { setDragId(null); setOverId(null); setInvalid(false); };

  const renderNode = (t, depth=0) => {
    const children = t.canContain.map(id=>byId.get(id)).filter(Boolean);
    const isOver = overId === t.id;
    const isDragging = dragId === t.id;
    const canDrop = dragId && !isDescendant(dragId, t.id) && dragId !== t.id;
    const cls = [
      'tree-node',
      selectedId===t.id && 'selected',
      isDragging && 'dragging',
      isOver && (invalid ? 'drop-invalid' : 'drop-target'),
      canDrop && !isOver && 'drop-ok',
    ].filter(Boolean).join(' ');
    return (
      <div key={t.id} style={{marginLeft: depth*20}}>
        <div
          className={cls}
          draggable
          onDragStart={(e)=>handleDragStart(e, t.id)}
          onDragOver={(e)=>handleDragOver(e, t.id)}
          onDragLeave={(e)=>handleDragLeave(e, t.id)}
          onDrop={(e)=>handleDrop(e, t.id)}
          onDragEnd={handleDragEnd}
          onClick={()=>onSelect(t.id)}
        >
          <span className="tree-grip" aria-hidden>⋮⋮</span>
          <span style={{width:18,display:'inline-flex',justifyContent:'center'}}><window.ShapeSvg shape={t.shape} color={t.color} size={14}/></span>
          <span className="tree-rune">{t.rune}</span>
          <span className="tree-name">{t.label}</span>
          <span className="tree-meta">{t.id}</span>
        </div>
        {children.length>0 && (
          <div className="tree-children">
            {children.map(c=>renderNode(c, depth+1))}
          </div>
        )}
      </div>
    );
  };

  // Orphans: types whose parentTypes reference something that isn't in canContain anywhere.
  // (Mostly happens mid-edit; shown as roots so they remain reachable.)
  const reachable = new Set();
  const markReachable = (t) => {
    if (!t || reachable.has(t.id)) return;
    reachable.add(t.id);
    t.canContain.forEach(id => markReachable(byId.get(id)));
  };
  roots.forEach(markReachable);
  const orphans = registry.types.filter(t => !reachable.has(t.id) && t.parentTypes.length>0);

  return (
    <div>
      <div className="containment-hint">
        <strong>Drag</strong> a type onto another to reparent it. The <code>canContain</code> edge moves from the old parent to the new; <code>parentTypes</code> on the child updates. Cycles are blocked.
      </div>
      <div className="tree">
        {roots.map(r=>renderNode(r))}
        {orphans.length > 0 && (
          <div className="tree-orphans">
            <div className="tree-orphan-label">orphans — parent missing</div>
            {orphans.map(o=>renderNode(o))}
          </div>
        )}
      </div>
    </div>
  );
}

window.RegistryView = RegistryView;
