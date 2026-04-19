/* global React, RUNES */
const { useState: _useState0, useEffect: _useEffect0, useMemo: _useMemo0, useRef: _useRef0 } = React;

// ─── Status badge ────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    running:    { cls:'b-run',  label:'running' },
    merged:     { cls:'b-ok',   label:'merged' },
    review:     { cls:'b-warn', label:'review' },
    queued:     { cls:'b-warn', label:'queued' },
    pending:    { cls:'b-mute', label:'pending' },
    escalated:  { cls:'b-warn', label:'escalated' },
    failed:     { cls:'b-crit', label:'failed' },
    active:     { cls:'b-run',  label:'active' },
    complete:   { cls:'b-ok',   label:'complete' },
    gated:      { cls:'b-gate', label:'gated' },
  };
  const { cls, label } = map[status] || { cls:'b-mute', label:status };
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" style={{ background:'currentColor' }}/>
      {label}
    </span>
  );
}

// ─── Status dot ───────────────────────────────────────────────────
function StatusDot({ status, pulsing=false }) {
  const cls = {
    running:'sd-run', active:'sd-run',
    merged:'sd-ok', complete:'sd-ok',
    review:'sd-warn', queued:'sd-warn', escalated:'sd-warn', gated:'sd-warn',
    failed:'sd-crit', crit:'sd-crit',
    pending:'sd-mute', idle:'sd-mute'
  }[status] || 'sd-mute';
  return <span className={`sd ${cls} ${pulsing?'pulsing':''}`}/>;
}

// ─── Confidence badge ─────────────────────────────────────────────
function Confidence({ value }) {
  if (value == null || value === 0) return <span className="conf"><span className="conf-track"></span><span className="conf-num faint">—</span></span>;
  const pct = Math.round(value * 100);
  const tier = pct >= 80 ? 'hi' : pct >= 50 ? 'md' : 'lo';
  return (
    <span className="conf">
      <span className="conf-track"><span className={`conf-fill ${tier}`} style={{ width: pct+'%' }}/></span>
      <span className="conf-num">{pct}</span>
    </span>
  );
}

// ─── Pipe viz cell ────────────────────────────────────────────────
function Pipe({ saga, width=18 }) {
  const cells = [];
  saga.phases.forEach(ph => {
    ph.raids.forEach(r => {
      const map = { merged:'ok', running:'run', review:'warn', queued:'warn', pending:'pend', escalated:'warn', failed:'crit', gated:'gate' };
      cells.push({ kind: map[r.status] || 'pend', title:`${r.name} (${r.status})` });
    });
  });
  return (
    <span className="pipe" style={{ display:'flex', gap:2 }}>
      {cells.map((c,i)=> <span key={i} className={`pipe-cell ${c.kind}`} title={c.title} style={{ minWidth: width }}/>)}
    </span>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────
function Sparkline({ data, height=28, color='#7dd3fc', fill=true }) {
  if (!data || !data.length) return null;
  const w = 120, h = height;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1 || 1);
  const pts = data.map((d,i) => [i*step, h - ((d - min) / range) * h * 0.9 - h*0.05]);
  const d = pts.map((p,i)=> `${i===0?'M':'L'}${p[0]} ${p[1]}`).join(' ');
  const area = `${d} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={area} fill={color} opacity="0.12"/>}
      <path d={d} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Role glyph — shape per role, ice-mono color ─────────────────
// Replaces per-persona colors. Differentiation = shape + letter.
const ROLE_SHAPES = {
  Plan:   'ring-dashed',
  Build:  'square-solid',
  Verify: 'chevron',
  Review: 'diamond',
  Gate:   'hex',
  Audit:  'triangle',
  Ship:   'pentagon',
  Index:  'halo',
  Report: 'dot-in-ring',
};

function RoleShape({ shape, size=22, stroke=1.4 }) {
  const s = size, c = s/2, r = s/2 - stroke;
  const col = 'var(--brand-300)';
  const bg  = 'color-mix(in srgb, var(--brand-500) 14%, transparent)';
  switch (shape) {
    case 'ring-dashed':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><circle cx={c} cy={c} r={r} fill={bg} stroke={col} strokeWidth={stroke} strokeDasharray="2.2 2"/></svg>;
    case 'square-solid':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><rect x={stroke} y={stroke} width={s-2*stroke} height={s-2*stroke} rx="2" fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'chevron':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><path d={`M ${stroke} ${stroke} L ${s-stroke*2} ${c} L ${stroke} ${s-stroke} Z`} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>;
    case 'diamond':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><path d={`M ${c} ${stroke} L ${s-stroke} ${c} L ${c} ${s-stroke} L ${stroke} ${c} Z`} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>;
    case 'hex': {
      const a = Math.PI/3; const pts = [0,1,2,3,4,5].map(i => [c + r*Math.cos(a*i - Math.PI/2), c + r*Math.sin(a*i - Math.PI/2)]);
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><path d={'M '+pts.map(p=>p.join(' ')).join(' L ')+' Z'} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>;
    }
    case 'triangle':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><path d={`M ${c} ${stroke} L ${s-stroke} ${s-stroke} L ${stroke} ${s-stroke} Z`} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>;
    case 'pentagon': {
      const pts = [0,1,2,3,4].map(i => [c + r*Math.cos(2*Math.PI*i/5 - Math.PI/2), c + r*Math.sin(2*Math.PI*i/5 - Math.PI/2)]);
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><path d={'M '+pts.map(p=>p.join(' ')).join(' L ')+' Z'} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>;
    }
    case 'halo':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><circle cx={c} cy={c} r={r} fill="none" stroke={col} strokeWidth={stroke*0.7} opacity="0.5"/><circle cx={c} cy={c} r={r*0.55} fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'dot-in-ring':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><circle cx={c} cy={c} r={r} fill="none" stroke={col} strokeWidth={stroke}/><circle cx={c} cy={c} r={r*0.35} fill={col}/></svg>;
    default:
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><circle cx={c} cy={c} r={r} fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
  }
}

// ─── Persona avatar — role-shape + letter, ice-mono ──────────────
function PersonaAvatar({ personaId, size=22 }) {
  const p = window.PERSONA_BY_ID[personaId];
  if (!p) return <span className="persona-av" style={{ width:size, height:size }}><span className="letter">?</span></span>;
  const shape = ROLE_SHAPES[p.role] || 'square-solid';
  return (
    <span className="persona-av" style={{ width:size, height:size }} title={`${p.name} · ${p.role}`}>
      <RoleShape shape={shape} size={size}/>
      <span className="letter" style={{ fontSize: Math.round(size*0.42)+'px' }}>{p.letter}</span>
    </span>
  );
}

// ─── Switch ──────────────────────────────────────────────────────
function Switch({ on, onChange }) {
  return <button className={`switch ${on?'on':''}`} onClick={()=>onChange(!on)} aria-pressed={on}/>;
}

// ─── Seg ──────────────────────────────────────────────────────────
function Seg({ value, options, onChange }) {
  return (
    <div className="tweak-seg">
      {options.map(o => (
        <button key={o.value} className={value===o.value?'on':''} onClick={()=>onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

Object.assign(window, { StatusBadge, StatusDot, Confidence, Pipe, Sparkline, PersonaAvatar, RoleShape, ROLE_SHAPES, Switch, Seg });
