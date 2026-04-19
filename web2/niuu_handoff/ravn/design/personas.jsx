/* global React, RAVN_DATA, PersonaAvatar, StateBadge, Seg, Kbd */
// ─── Ravn personas page — catalog + editor with real tools / events / fan-in ──

const { useState: usePr, useMemo: usePrm, useRef: usePrr, useEffect: usePre } = React;

function PersonasView({ ctx }) {
  const { selectedPersona, selectPersona } = ctx;
  const { PERSONAS, PERSONA_BY_NAME, PERSONA_YAML } = window.RAVN_DATA;

  // "new" is a transient in-memory persona, keyed under a sentinel name
  const [drafts, setDrafts] = usePr({});    // { [name]: partialPersona }
  const [showNew, setShowNew] = usePr(false);

  const p = drafts[selectedPersona] || PERSONA_BY_NAME[selectedPersona] || PERSONAS[0];
  const [mode, setMode] = usePr('form'); // form | yaml | subs

  const yaml = PERSONA_YAML[p.name] || fallbackYaml(p);
  const validation = validatePersona(p);

  const patchPersona = (partial) => {
    setDrafts(d => ({...d, [p.name]: { ...p, ...partial } }));
  };

  return (
    <div className="pr-root">
      {/* Header */}
      <div className="pr-head">
        <div className="pr-head-l">
          <PersonaAvatar name={p.name} size={40}/>
          <div>
            <div className="pr-name mono">{p.name}</div>
            <div className="pr-sub mono dim">
              role: <strong className="fg">{p.role}</strong>
              <span className="sep">·</span>
              {p.builtin ? 'builtin' : 'user-defined'}
              {p.hasOverride && <> <span className="sep">·</span> <span className="pr-ovr">override applied</span></>}
              {drafts[p.name] && <> <span className="sep">·</span> <span className="pr-dirty">unsaved</span></>}
            </div>
            {/* Where this persona is loaded from */}
            <div className="pr-origin mono sm">
              <span className="dim">loaded from</span>
              <code>{p.source || PERSONA_BY_NAME[p.name]?.source || '— unsaved draft —'}</code>
              {p.override && <>
                <span className="dim">then overridden by</span>
                <code className="pr-ovr-path">{p.override}</code>
              </>}
            </div>
          </div>
        </div>
        <div className="pr-head-r">
          <Seg options={[{value:'form',label:'form'},{value:'yaml',label:'yaml'},{value:'subs',label:'subscriptions'}]} value={mode} onChange={setMode}/>
          {p.hasOverride && <button className="btn btn-sm">revert override</button>}
          <button className="btn btn-sm" onClick={()=>setShowNew(true)}>+ new persona</button>
          <button className="btn btn-sm">clone as…</button>
          <button className={`btn btn-sm ${drafts[p.name] ? 'btn-primary':''}`}>save</button>
        </div>
      </div>

      {/* Validation banner */}
      {validation.issues.length > 0 && (
        <div className={`pr-valbar ${validation.level}`}>
          <span className="mono">{validation.level==='error'?'⊘':'⚠'}</span>
          <span className="mono sm">{validation.issues.length} issue{validation.issues.length===1?'':'s'}</span>
          <span className="sep">·</span>
          {validation.issues.map((v,i) => (
            <span key={i} className="pr-valitem"><strong className="mono sm">{v.key}</strong>: {v.msg}</span>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="pr-body">
        {mode === 'form' && <PersonaForm p={p} onChange={patchPersona}/>}
        {mode === 'yaml' && <PersonaYaml yaml={yaml}/>}
        {mode === 'subs' && <PersonaSubs p={p}/>}
      </div>

      {/* New-persona wizard */}
      {showNew && <NewPersonaModal
        onClose={()=>setShowNew(false)}
        onCreate={(persona)=>{
          setDrafts(d => ({...d, [persona.name]: persona}));
          selectPersona(persona.name);
          setShowNew(false);
        }}
      />}
    </div>
  );
}

// ─── FORM editor ──
function PersonaForm({ p, onChange }) {
  const { FAN_IN_BY_ID, FAN_IN_STRATEGIES, EVENT_CATALOG, INJECT_CATALOG, TOOLS_BY_GROUP, TOOL_BY_ID } = window.RAVN_DATA;

  return (
    <div className="pr-form">
      <section className="pr-sec">
        <div className="pr-sec-head"><h4>Identity</h4><span className="pr-sec-sub mono dim">What this persona is for.</span></div>
        <div className="pr-sec-body">
          <Field k="name" v={p.name} mono readOnly/>
          <Field k="role" v={p.role} mono onChange={v=>onChange({role:v})}/>
          <Field k="description" v={p.desc} wide onChange={v=>onChange({desc:v})}/>
        </div>
      </section>

      <section className="pr-sec">
        <div className="pr-sec-head"><h4>Runtime</h4><span className="pr-sec-sub mono dim">Iteration budget, permissions and LLM config.</span></div>
        <div className="pr-sec-body pr-grid-3">
          <NumField k="iteration_budget" v={p.iterationBudget} onChange={v=>onChange({iterationBudget:v})}/>
          <SelectField k="permission_mode" v={p.permissionMode}
            options={['restricted','normal','yolo']}
            onChange={v=>onChange({permissionMode:v})}/>
          <SelectField k="llm.alias" v={p.llm.alias}
            options={['haiku-primary','sonnet-primary','opus-primary','local-qwen']}
            onChange={v=>onChange({llm:{...p.llm,alias:v}})}/>
          <ToggleField k="llm.thinking" v={p.llm.thinking} onChange={v=>onChange({llm:{...p.llm,thinking:v}})}/>
          <NumField k="llm.max_tokens" v={p.llm.maxTokens} step={1024} onChange={v=>onChange({llm:{...p.llm,maxTokens:v}})}/>
        </div>
      </section>

      {/* Tool access — real picker */}
      <ToolAccessSection p={p} onChange={onChange}/>

      {/* Produces / Consumes — real event pickers + schema editor */}
      <ProducesSection p={p} onChange={onChange}/>
      <ConsumesSection p={p} onChange={onChange}/>

      {/* Fan-in — strategy selector + per-strategy fields */}
      <FanInSection p={p} onChange={onChange}/>
    </div>
  );
}

// ─── Tool access ─────────────────────────────────────
function ToolAccessSection({ p, onChange }) {
  const { TOOL_BY_ID } = window.RAVN_DATA;
  const [picker, setPicker] = usePr(null); // 'allow' | 'deny' | null
  const allowed = new Set(p.allowedTools);
  const forbidden = new Set(p.forbiddenTools);

  const addTo = (bucket, id) => {
    if (bucket==='allow') {
      onChange({
        allowedTools: Array.from(new Set([...p.allowedTools, id])),
        forbiddenTools: p.forbiddenTools.filter(t=>t!==id),
      });
    } else {
      onChange({
        forbiddenTools: Array.from(new Set([...p.forbiddenTools, id])),
        allowedTools: p.allowedTools.filter(t=>t!==id),
      });
    }
    setPicker(null);
  };
  const removeFrom = (bucket, id) => {
    if (bucket==='allow') onChange({ allowedTools: p.allowedTools.filter(t=>t!==id) });
    else onChange({ forbiddenTools: p.forbiddenTools.filter(t=>t!==id) });
  };

  const destructiveAllowed = p.allowedTools.filter(t => TOOL_BY_ID[t]?.destructive);

  return (
    <section className="pr-sec">
      <div className="pr-sec-head">
        <h4>Tool access</h4>
        <span className="pr-sec-sub mono dim">
          Enforced at dispatch. Destructive tools ({destructiveAllowed.length} granted) require
          <strong className="fg"> permission_mode ≥ normal</strong>.
        </span>
      </div>
      <div className="pr-sec-body">
        <div className="pr-tools">
          <div className="pr-tools-head">
            <span className="mono dim sm">allowed <span className="fg">({p.allowedTools.length})</span></span>
            <button className="pr-tools-add" onClick={()=>setPicker(picker==='allow'?null:'allow')}>
              {picker==='allow' ? '× close picker' : '+ grant tool'}
            </button>
          </div>
          <div className="chip-row">
            {p.allowedTools.map(t => {
              const def = TOOL_BY_ID[t];
              return (
                <span key={t} className={`chip chip-tool allow mono ${def?.destructive?'danger':''}`} title={def?.desc || t}>
                  {def?.destructive && <span className="chip-risk">⚠</span>}
                  {t}
                  <button className="chip-x" onClick={()=>removeFrom('allow',t)}>×</button>
                </span>
              );
            })}
            {p.allowedTools.length === 0 && <span className="mono dim sm">— no tools granted —</span>}
          </div>
          {picker==='allow' && <ToolPicker excluded={allowed} onPick={(id)=>addTo('allow',id)}/>}
        </div>

        <div className="pr-tools">
          <div className="pr-tools-head">
            <span className="mono dim sm">forbidden <span className="fg">({p.forbiddenTools.length})</span></span>
            <button className="pr-tools-add" onClick={()=>setPicker(picker==='deny'?null:'deny')}>
              {picker==='deny' ? '× close picker' : '+ deny tool'}
            </button>
          </div>
          <div className="chip-row">
            {p.forbiddenTools.map(t => (
              <span key={t} className="chip chip-tool deny mono" title={TOOL_BY_ID[t]?.desc || t}>
                {t}
                <button className="chip-x" onClick={()=>removeFrom('deny',t)}>×</button>
              </span>
            ))}
            {p.forbiddenTools.length === 0 && <span className="mono dim sm">— none —</span>}
          </div>
          {picker==='deny' && <ToolPicker excluded={forbidden} onPick={(id)=>addTo('deny',id)}/>}
        </div>
      </div>
    </section>
  );
}

function ToolPicker({ excluded, onPick }) {
  const { TOOLS_BY_GROUP, TOOL_BY_ID } = window.RAVN_DATA;
  const [q, setQ] = usePr('');
  const groups = Object.keys(TOOLS_BY_GROUP);
  return (
    <div className="pr-picker">
      <input className="pr-picker-q input mono" placeholder="filter tools…" value={q} onChange={e=>setQ(e.target.value)}/>
      <div className="pr-picker-groups">
        {groups.map(g => {
          const items = TOOLS_BY_GROUP[g].filter(t => !excluded.has(t.id) && (!q || t.id.includes(q) || t.desc.toLowerCase().includes(q.toLowerCase())));
          if (items.length === 0) return null;
          return (
            <div key={g} className="pr-picker-group">
              <div className="pr-picker-g-head mono dim sm">{g}</div>
              <div className="pr-picker-items">
                {items.map(t => (
                  <button key={t.id} className={`pr-picker-item ${t.destructive?'danger':''}`} onClick={()=>onPick(t.id)}>
                    <span className="mono">{t.id}</span>
                    {t.destructive && <span className="pr-risk-pill">destructive</span>}
                    <span className="pr-picker-desc">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Produces (emit) ─────────────────────────────────
function ProducesSection({ p, onChange }) {
  const { EVENT_CATALOG, EVENT_NAMES } = window.RAVN_DATA;
  const ev = p.produces?.event;
  const catalog = ev && EVENT_CATALOG[ev];
  const [editingSchema, setEditingSchema] = usePr(false);

  const setEvent = (name) => onChange({ produces: { ...(p.produces||{}), event: name, schema: p.produces?.schema || catalog?.schema || {} } });
  const setSchema = (schema) => onChange({ produces: { ...(p.produces||{}), schema } });

  return (
    <section className="pr-sec">
      <div className="pr-sec-head">
        <h4>Produces</h4>
        <span className="pr-sec-sub mono dim">The event this persona emits on a successful iteration.</span>
      </div>
      <div className="pr-sec-body">
        <div className="pr-ev-row">
          <span className="pr-ev-k mono dim sm">event_type</span>
          <EventPicker value={ev} onChange={setEvent} allowNew/>
          {catalog && (
            <span className="pr-ev-tags">
              <span className={`pr-ev-kind kind-${catalog.kind}`}>{catalog.kind}</span>
              {catalog.source && <span className="mono dim sm">src: <strong className="fg">{catalog.source}</strong></span>}
            </span>
          )}
        </div>
        {catalog && <div className="pr-ev-desc mono sm dim">{catalog.desc}</div>}

        <div className="pr-ev-row">
          <span className="pr-ev-k mono dim sm">schema</span>
          <button className="btn btn-sm" onClick={()=>setEditingSchema(x=>!x)}>{editingSchema?'done':'edit'}</button>
        </div>
        <SchemaEditor schema={p.produces?.schema || {}} editing={editingSchema} onChange={setSchema}/>
      </div>
    </section>
  );
}

// ─── Consumes (subscriptions + injects) ──────────────
function ConsumesSection({ p, onChange }) {
  const { EVENT_CATALOG, INJECT_CATALOG } = window.RAVN_DATA;
  const events = p.consumes?.events || [];
  const injects = p.consumes?.injects || [];
  const [showInjectPicker, setShowInjectPicker] = usePr(false);

  const addEvent = (name) => onChange({ consumes: { events: Array.from(new Set([...events, name])), injects } });
  const rmEvent = (name) => onChange({ consumes: { events: events.filter(e=>e!==name), injects } });
  const addInject = (name) => { onChange({ consumes: { events, injects: Array.from(new Set([...injects, name])) } }); setShowInjectPicker(false); };
  const rmInject = (name) => onChange({ consumes: { events, injects: injects.filter(i=>i!==name) } });

  return (
    <section className="pr-sec">
      <div className="pr-sec-head">
        <h4>Consumes</h4>
        <span className="pr-sec-sub mono dim">Events this persona listens for, and the context it wants loaded.</span>
      </div>
      <div className="pr-sec-body">
        {/* Event subscriptions */}
        <div className="pr-cs-block">
          <div className="pr-tools-head">
            <span className="mono dim sm">event_types <span className="fg">({events.length})</span></span>
          </div>
          <div className="chip-row">
            {events.map(e => {
              const c = EVENT_CATALOG[e];
              return (
                <span key={e} className={`chip chip-event mono ${c?.kind?'kind-'+c.kind:''}`} title={c?.desc || e}>
                  {c && <span className="chip-evkind mono">{c.kind==='ingress'?'↓':c.kind==='cron'?'⧗':c.kind==='gateway'?'⇄':'↔'}</span>}
                  {e}
                  <button className="chip-x" onClick={()=>rmEvent(e)}>×</button>
                </span>
              );
            })}
            <EventPicker value={null} onChange={addEvent} asChip allowNew/>
          </div>
        </div>

        {/* Injects */}
        <div className="pr-cs-block">
          <div className="pr-tools-head">
            <span className="mono dim sm">injects <span className="fg">({injects.length})</span> <span className="dim">· context bundled into the system prompt</span></span>
            <button className="pr-tools-add" onClick={()=>setShowInjectPicker(v=>!v)}>{showInjectPicker?'× close':'+ inject'}</button>
          </div>
          <div className="chip-row">
            {injects.map(i => (
              <span key={i} className="chip chip-inject mono" title={INJECT_CATALOG[i]}>
                {i}
                <button className="chip-x" onClick={()=>rmInject(i)}>×</button>
              </span>
            ))}
            {injects.length === 0 && <span className="mono dim sm">— none —</span>}
          </div>
          {showInjectPicker && (
            <div className="pr-picker">
              <div className="pr-picker-items">
                {Object.keys(INJECT_CATALOG).filter(i => !injects.includes(i)).map(i => (
                  <button key={i} className="pr-picker-item" onClick={()=>addInject(i)}>
                    <span className="mono">{i}</span>
                    <span className="pr-picker-desc">{INJECT_CATALOG[i]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Fan-in ───────────────────────────────────────────
function FanInSection({ p, onChange }) {
  const { FAN_IN_BY_ID, FAN_IN_STRATEGIES, EVENT_CATALOG, EVENT_NAMES } = window.RAVN_DATA;
  const strategy = p.fanIn?.strategy || 'merge';
  const strat = FAN_IN_BY_ID[strategy] || FAN_IN_STRATEGIES[0];
  const params = p.fanIn?.params || {};
  const contributesTo = p.fanIn?.contributesTo || '';

  // Peer producers (same event) + listeners (the arbiter that consumes it)
  const peers = (p.produces?.event) ? window.RAVN_DATA.PERSONAS.filter(pp => pp.name !== p.name && pp.produces?.event === p.produces.event) : [];
  const arbiter = (p.produces?.event) ? window.RAVN_DATA.PERSONAS.find(pp => pp.consumes?.events?.includes(p.produces.event) && pp.role==='arbiter') : null;

  return (
    <section className="pr-sec">
      <div className="pr-sec-head">
        <h4>Fan-in</h4>
        <span className="pr-sec-sub mono dim">How Týr combines this persona's output with others emitting the same event.</span>
      </div>
      <div className="pr-sec-body">
        <div className="pr-fi-strat">
          {FAN_IN_STRATEGIES.map(s => (
            <button key={s.id}
              className={`pr-fi-card ${strategy===s.id?'active':''}`}
              onClick={()=>onChange({ fanIn: { ...(p.fanIn||{}), strategy: s.id, params: seedParams(s) } })}>
              <div className="pr-fi-name mono">{s.label}</div>
              <div className="pr-fi-desc">{s.desc}</div>
            </button>
          ))}
        </div>

        {/* Per-strategy fields */}
        {strat.fields && strat.fields.length > 0 && strat.fields[0].type !== 'none' && (
          <div className="pr-fi-params">
            {strat.fields.map(f => f.type === 'none' ? null : (
              <label key={f.key} className="pr-field">
                <span className="pr-field-k mono dim">{f.label || f.key}</span>
                <input className="input mono"
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={params[f.key] ?? f.default ?? ''}
                  onChange={e=>onChange({ fanIn: { ...(p.fanIn||{}), params: { ...params, [f.key]: f.type==='number' ? Number(e.target.value) : e.target.value } } })}
                />
              </label>
            ))}
          </div>
        )}

        {/* Contributes to — arbiter event */}
        <div className="pr-fi-contrib">
          <span className="pr-field-k mono dim">contributes_to <span className="dim">· the composite event this feeds</span></span>
          <div className="pr-fi-contrib-row">
            <EventPicker value={contributesTo || null}
              onChange={v=>onChange({ fanIn: { ...(p.fanIn||{}), contributesTo: v || '' } })}
              allowEmpty placeholder="(direct emit — no composite)"/>
            {arbiter && (
              <span className="pr-fi-arbiter mono sm">
                <span className="dim">will be merged by</span>
                <PersonaAvatar name={arbiter.name} size={16}/>
                <strong className="fg">{arbiter.name}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Peer preview */}
        <div className="pr-fi-peers">
          <div className="mono dim sm">peers emitting <code className="mono fg">{p.produces?.event || '—'}</code></div>
          <div className="chip-row">
            {peers.length === 0 && <span className="mono dim sm">none — this persona emits solo</span>}
            {peers.map(pp => (
              <span key={pp.name} className="pr-fi-peer">
                <PersonaAvatar name={pp.name} size={14}/>
                <span className="mono sm">{pp.name}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
function seedParams(strategy) {
  const o = {};
  for (const f of (strategy.fields||[])) if (f.default !== undefined) o[f.key] = f.default;
  return o;
}

// ─── Event picker ──
function EventPicker({ value, onChange, asChip=false, allowNew=false, allowEmpty=false, placeholder }) {
  const { EVENT_NAMES, EVENT_CATALOG } = window.RAVN_DATA;
  const [open, setOpen] = usePr(false);
  const [q, setQ] = usePr('');
  const ref = usePrr(null);
  usePre(()=>{
    const onDoc = (e)=>{ if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return ()=>document.removeEventListener('click', onDoc);
  },[]);

  const items = EVENT_NAMES.filter(e => !q || e.includes(q));
  const isNew = q && !EVENT_NAMES.includes(q);

  const btn = asChip
    ? <button className="chip chip-add mono" onClick={()=>setOpen(v=>!v)}>+ add</button>
    : <button className="pr-ev-trigger mono" onClick={()=>setOpen(v=>!v)}>
        {value || <span className="dim">{placeholder || '— choose event —'}</span>}
        <span className="dim">▾</span>
      </button>;

  return (
    <div className="pr-evp" ref={ref}>
      {btn}
      {open && (
        <div className="pr-evp-menu">
          <input className="pr-evp-q input mono" placeholder="filter or type new event…" value={q} onChange={e=>setQ(e.target.value)} autoFocus/>
          <div className="pr-evp-list">
            {allowEmpty && (
              <button className="pr-evp-item" onClick={()=>{ onChange(''); setOpen(false); }}>
                <span className="mono dim">(none — direct emit)</span>
              </button>
            )}
            {items.map(e => {
              const c = EVENT_CATALOG[e];
              return (
                <button key={e} className="pr-evp-item" onClick={()=>{ onChange(e); setOpen(false); setQ(''); }}>
                  <span className={`pr-ev-kind kind-${c?.kind}`}>{c?.kind || 'new'}</span>
                  <span className="mono">{e}</span>
                  <span className="pr-evp-desc">{c?.desc}</span>
                </button>
              );
            })}
            {allowNew && isNew && (
              <button className="pr-evp-item pr-evp-new" onClick={()=>{ onChange(q); setOpen(false); setQ(''); }}>
                <span className="pr-ev-kind kind-new">new</span>
                <span className="mono">{q}</span>
                <span className="pr-evp-desc">Create a new event name. Nothing will consume it until a persona subscribes.</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schema editor ─────────────────────────────────
function SchemaEditor({ schema, editing, onChange }) {
  const entries = Object.entries(schema);
  if (!editing) {
    if (entries.length === 0) return <div className="rv-empty-mini">no schema — payload is opaque</div>;
    return (
      <div className="pr-schema mono sm">
        {entries.map(([k,v]) => <div key={k}><span className="k">{k}</span>: <span className="v">{v}</span></div>)}
      </div>
    );
  }
  const setAt = (idx, key, val) => {
    const next = {};
    entries.forEach(([k,v],i)=>{
      if (i===idx) next[key] = val;
      else next[k] = v;
    });
    onChange(next);
  };
  const rm = (k) => {
    const next = {...schema}; delete next[k]; onChange(next);
  };
  const add = () => onChange({ ...schema, ['field_'+(entries.length+1)]: 'string' });
  return (
    <div className="pr-schema-edit">
      {entries.map(([k,v], i) => (
        <div key={i} className="pr-schema-row">
          <input className="input mono sm" value={k} onChange={e=>setAt(i, e.target.value, v)}/>
          <span className="mono dim">:</span>
          <select className="input mono sm" value={v} onChange={e=>setAt(i, k, e.target.value)}>
            {['string','number','bool','array','object'].map(t=><option key={t}>{t}</option>)}
          </select>
          <button className="chip-x" onClick={()=>rm(k)}>×</button>
        </div>
      ))}
      <button className="pr-tools-add" onClick={add}>+ field</button>
    </div>
  );
}

// ─── Small field primitives ──
function Field({ k, v, mono, wide, readOnly, onChange }) {
  return (
    <label className={`pr-field ${wide?'wide':''}`}>
      <span className="pr-field-k mono dim">{k}</span>
      <input className={`input ${mono?'mono':''}`} value={v || ''}
        readOnly={readOnly}
        onChange={e=>onChange && onChange(e.target.value)}/>
    </label>
  );
}
function NumField({ k, v, onChange, step=1 }) {
  return (
    <label className="pr-field">
      <span className="pr-field-k mono dim">{k}</span>
      <input className="input mono" type="number" step={step} value={v} onChange={e=>onChange && onChange(Number(e.target.value))}/>
    </label>
  );
}
function SelectField({ k, v, options, onChange }) {
  return (
    <label className="pr-field">
      <span className="pr-field-k mono dim">{k}</span>
      <select className="input mono" value={v} onChange={e=>onChange && onChange(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}
function ToggleField({ k, v, onChange }) {
  return (
    <label className="pr-field">
      <span className="pr-field-k mono dim">{k}</span>
      <button className={`pr-toggle ${v?'on':''}`} onClick={()=>onChange && onChange(!v)} type="button">
        <span className="pr-toggle-knob"/>
        <span className="pr-toggle-label mono sm">{v?'true':'false'}</span>
      </button>
    </label>
  );
}

// ─── YAML editor (with syntax highlighting) ──
function PersonaYaml({ yaml }) {
  const html = usePrm(() => highlightYaml(yaml), [yaml]);
  return (
    <div className="pr-yaml-wrap">
      <div className="pr-yaml-head mono dim sm">persona.yaml <span className="sep">·</span> <Kbd>ctrl-s</Kbd> save · <Kbd>ctrl-/</Kbd> fold</div>
      <pre className="pr-yaml" dangerouslySetInnerHTML={{__html: html}}/>
    </div>
  );
}
function highlightYaml(src) {
  const lines = src.split('\n');
  return lines.map(line => {
    if (/^\s*#/.test(line)) return `<span class="yc">${esc(line)}</span>`;
    const m = line.match(/^(\s*)([A-Za-z_][\w.-]*)(\s*:)(.*)$/);
    if (m) {
      let val = m[4];
      if (/^\s*(\[.*\]|\{.*\})\s*$/.test(val)) val = val.replace(/([A-Za-z_][\w.-]*)/g, '<span class="yv">$1</span>');
      else if (/^\s*[\d.]+\s*$/.test(val)) val = `<span class="yn">${esc(val)}</span>`;
      else if (/^\s*(true|false|null)\s*$/.test(val)) val = `<span class="yb">${esc(val)}</span>`;
      else if (val.trim()) val = `<span class="ys">${esc(val)}</span>`;
      return `${esc(m[1])}<span class="yk">${esc(m[2])}</span><span class="yp">${esc(m[3])}</span>${val}`;
    }
    const dm = line.match(/^(\s*-\s+)(.*)$/);
    if (dm) return `${esc(dm[1])}<span class="ys">${esc(dm[2])}</span>`;
    return esc(line);
  }).join('\n');
}
function esc(s) { return s.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

// ─── Subscriptions visualisation ──
function PersonaSubs({ p }) {
  const { PERSONAS, EVENT_CATALOG } = window.RAVN_DATA;
  const upstream = (p.consumes?.events || []).map(ev => {
    const producers = PERSONAS.filter(pp => pp.produces?.event === ev).map(pp=>pp.name);
    return { event: ev, producers, catalog: EVENT_CATALOG[ev] };
  });
  const downstream = p.produces?.event ? (() => {
    const consumers = PERSONAS.filter(pp => pp.consumes?.events?.includes(p.produces.event)).map(pp=>pp.name);
    return { event: p.produces.event, consumers, catalog: EVENT_CATALOG[p.produces.event] };
  })() : null;

  return (
    <div className="pr-subs">
      <section className="pr-subs-col">
        <h4>Upstream <span className="mono dim sm">— events this persona consumes</span></h4>
        {upstream.length === 0 && <div className="rv-empty-mini">No upstream subscriptions. This persona is a trigger-entry.</div>}
        {upstream.map(u => (
          <div key={u.event} className="pr-subs-card">
            <div className="pr-subs-event">
              <span className={`chip chip-event mono ${u.catalog?.kind?'kind-'+u.catalog.kind:''}`}>{u.event}</span>
              {u.catalog?.kind && <span className={`pr-ev-kind kind-${u.catalog.kind}`}>{u.catalog.kind}</span>}
              {u.producers.length === 0 && u.catalog?.kind !== 'ingress' && u.catalog?.kind !== 'cron' && u.catalog?.kind !== 'gateway' && <span className="badge warn sm">no producer</span>}
            </div>
            {u.producers.length > 0 && (
              <div className="pr-subs-prodlist">
                <span className="mono dim sm">from:</span>
                {u.producers.map(prod => (
                  <span key={prod} className="pr-subs-chip">
                    <PersonaAvatar name={prod} size={14}/>
                    <span className="mono">{prod}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="pr-subs-center">
        <div className="pr-subs-self">
          <PersonaAvatar name={p.name} size={48}/>
          <div className="pr-subs-self-name mono">{p.name}</div>
          <div className="pr-subs-self-sub mono dim sm">{p.role}</div>
        </div>
      </section>

      <section className="pr-subs-col">
        <h4>Downstream <span className="mono dim sm">— personas that listen for this</span></h4>
        {!downstream && <div className="rv-empty-mini">This persona does not produce an event.</div>}
        {downstream && (
          <div className="pr-subs-card">
            <div className="pr-subs-event">
              <span className={`chip chip-event mono ${downstream.catalog?.kind?'kind-'+downstream.catalog.kind:''}`}>{downstream.event}</span>
              {downstream.consumers.length === 0 && <span className="badge warn sm">orphan · no listener</span>}
            </div>
            {downstream.consumers.length > 0 && (
              <div className="pr-subs-prodlist">
                <span className="mono dim sm">to:</span>
                {downstream.consumers.map(c => (
                  <span key={c} className="pr-subs-chip">
                    <PersonaAvatar name={c} size={14}/>
                    <span className="mono">{c}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── NEW PERSONA wizard ─────────────────────────────────────────
function NewPersonaModal({ onClose, onCreate }) {
  const { PERSONAS, PERSONA_SOURCES } = window.RAVN_DATA;
  const [step, setStep] = usePr('start'); // start | blank | clone
  const [name, setName] = usePr('');
  const [role, setRole] = usePr('write');
  const [desc, setDesc] = usePr('');
  const [cloneFrom, setCloneFrom] = usePr('reviewer');
  const [target, setTarget] = usePr('user'); // source root

  const nameError = (() => {
    if (!name) return null;
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) return 'lowercase, hyphens only, starts with a letter';
    if (PERSONAS.some(p=>p.name === name)) return 'already exists';
    return null;
  })();

  const create = () => {
    if (!name || nameError) return;
    const source = target === 'user' ? `~/.config/niuu/personas/${name.replace(/-/g,'_')}.yaml`
                 : target === 'workspace' ? `$REPO/.niuu/personas/${name.replace(/-/g,'_')}.yaml`
                 : `volundr/src/ravn/personas/${name.replace(/-/g,'_')}.yaml`;

    let base;
    if (step === 'clone') {
      const src = PERSONAS.find(p=>p.name === cloneFrom);
      base = JSON.parse(JSON.stringify(src));
    } else {
      base = {
        iterationBudget: 8, permissionMode: 'restricted',
        allowedTools: ['read'], forbiddenTools: ['write','bash','apply_patch'],
        llm: { alias:'sonnet-primary', thinking:false, maxTokens:4096 },
        produces: { event: name.replace(/-/g,'_')+'.done', schema: {} },
        consumes: { events: [], injects: [] },
        fanIn: { strategy:'merge', contributesTo:'', params:{} },
      };
    }
    onCreate({
      ...base, name, role, desc: desc || base.desc || '',
      builtin: target === 'builtin', hasOverride: false, source,
    });
  };

  return (
    <div className="pr-modal-overlay" onClick={onClose}>
      <div className="pr-modal" onClick={e=>e.stopPropagation()}>
        <div className="pr-modal-head">
          <h3>New persona</h3>
          <button className="btn btn-sm" onClick={onClose}>× close</button>
        </div>

        {step === 'start' && (
          <div className="pr-modal-body">
            <div className="pr-np-start">
              <button className="pr-np-card" onClick={()=>setStep('blank')}>
                <div className="pr-np-card-t mono">blank persona</div>
                <div className="pr-np-card-d">Start with minimal defaults — read-only, restricted, sonnet, no subscriptions.</div>
              </button>
              <button className="pr-np-card" onClick={()=>setStep('clone')}>
                <div className="pr-np-card-t mono">clone existing</div>
                <div className="pr-np-card-d">Duplicate a persona's tools, events and fan-in; rename it and tweak.</div>
              </button>
            </div>
          </div>
        )}

        {step !== 'start' && (
          <div className="pr-modal-body">
            {step === 'clone' && (
              <label className="pr-field">
                <span className="pr-field-k mono dim">clone_from</span>
                <select className="input mono" value={cloneFrom} onChange={e=>setCloneFrom(e.target.value)}>
                  {PERSONAS.map(p=><option key={p.name} value={p.name}>{p.name} · {p.role}</option>)}
                </select>
              </label>
            )}

            <label className="pr-field">
              <span className="pr-field-k mono dim">name</span>
              <input className="input mono" value={name} onChange={e=>setName(e.target.value.toLowerCase())} placeholder="e.g. release-herald" autoFocus/>
              {nameError && <span className="pr-np-err mono sm">{nameError}</span>}
            </label>

            <label className="pr-field">
              <span className="pr-field-k mono dim">role</span>
              <select className="input mono" value={role} onChange={e=>setRole(e.target.value)}>
                {['review','arbiter','qa','build','plan','investigate','observe','knowledge','coord','autonomy','report','write'].map(r=><option key={r}>{r}</option>)}
              </select>
            </label>

            <label className="pr-field wide">
              <span className="pr-field-k mono dim">description</span>
              <input className="input" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="One-line purpose — what does this persona do?"/>
            </label>

            <div className="pr-field wide">
              <span className="pr-field-k mono dim">save to</span>
              <div className="pr-np-target">
                {PERSONA_SOURCES.map(s => (
                  <button key={s.id}
                    className={`pr-np-src ${target===s.id?'active':''}`}
                    onClick={()=>setTarget(s.id)}>
                    <div className="pr-np-src-t mono">{s.kind}</div>
                    <div className="pr-np-src-p mono sm">{s.path}</div>
                    <div className="pr-np-src-d">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="pr-modal-foot">
          {step !== 'start' && <button className="btn btn-sm" onClick={()=>setStep('start')}>← back</button>}
          <div style={{flex:1}}/>
          <button className="btn btn-sm" onClick={onClose}>cancel</button>
          {step !== 'start' && (
            <button className="btn btn-sm btn-primary" onClick={create} disabled={!name || !!nameError}>create</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──
function validatePersona(p) {
  const issues = [];
  if (!p.produces?.event) issues.push({ key:'produces.event', msg:'persona must emit an event', level:'warn' });
  if (p.consumes?.events?.length === 0 && !p.produces?.event?.startsWith('cron.')) {
    issues.push({ key:'consumes.events', msg:'no upstream — persona will never fire', level:'warn' });
  }
  if (p.iterationBudget > 30) issues.push({ key:'iteration_budget', msg:'very high iteration budget — consider a cap', level:'warn' });
  if (p.permissionMode === 'normal' && (p.allowedTools.includes('bash') || p.allowedTools.includes('apply_patch'))) {
    issues.push({ key:'permission_mode', msg:'normal mode + destructive tools — confirm exposure', level:'warn' });
  }
  // Destructive tools under restricted are impossible; surface as error
  if (p.permissionMode === 'restricted') {
    const { TOOL_BY_ID } = window.RAVN_DATA;
    const bad = p.allowedTools.filter(t => TOOL_BY_ID[t]?.destructive);
    if (bad.length) issues.push({ key:'permission_mode', msg:`restricted mode blocks: ${bad.join(', ')}`, level:'error' });
  }
  const PERSONAS = window.RAVN_DATA.PERSONAS;
  if (p.produces?.event) {
    const hasListener = PERSONAS.some(pp => pp.consumes?.events?.includes(p.produces.event));
    const catalog = window.RAVN_DATA.EVENT_CATALOG[p.produces.event];
    if (!hasListener && catalog?.kind !== 'cron') issues.push({ key:'produces.event', msg:`nobody consumes "${p.produces.event}" — orphan emitter`, level:'error' });
  }
  const level = issues.some(i=>i.level==='error') ? 'error' : 'warn';
  return { issues, level };
}

function fallbackYaml(p) {
  return `name: ${p.name}
description: ${p.desc}
system_prompt_template: |
  ## Identity
  (Not overridden — inherits from builtin template.)

allowed_tools: [${p.allowedTools.join(', ')}]
forbidden_tools: [${p.forbiddenTools.join(', ')}]
permission_mode: ${p.permissionMode}
iteration_budget: ${p.iterationBudget}

llm:
  primary_alias: ${p.llm.alias}
  thinking_enabled: ${p.llm.thinking}
  max_tokens: ${p.llm.maxTokens}

produces:
  event_type: ${p.produces?.event || ''}

consumes:
  event_types: [${(p.consumes?.events||[]).join(', ')}]
  injects: [${(p.consumes?.injects||[]).join(', ')}]

fan_in:
  strategy: ${p.fanIn?.strategy || 'merge'}
  contributes_to: ${p.fanIn?.contributesTo || ''}
${Object.entries(p.fanIn?.params||{}).map(([k,v])=>`  ${k}: ${v}`).join('\n')}
`;
}

window.PersonasView = PersonasView;
