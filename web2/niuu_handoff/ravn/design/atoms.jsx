/* global React */
// ─── Ravn atoms — avatars, dots, bars, bits ─────────────

const RVN_ROLE_SHAPE = {
  review: 'ring', arbiter: 'halo', qa: 'ring-dashed', build: 'square',
  plan: 'chevron', investigate: 'hex', observe: 'diamond', knowledge: 'dot-in-ring',
  coord: 'pentagon', autonomy: 'triangle', report: 'rounded', write: 'square-sm',
};

function PersonaShape({ shape, size=22, stroke=1.4 }) {
  const r = size/2 - stroke;
  const col = 'var(--brand-300)';
  const bg  = 'color-mix(in srgb, var(--brand-500) 14%, transparent)';
  const sw = { width:size, height:size, flex:'0 0 auto' };
  const S = size, H = S/2;
  switch(shape) {
    case 'ring':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><circle cx={H} cy={H} r={r} fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'ring-dashed':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><circle cx={H} cy={H} r={r} fill={bg} stroke={col} strokeWidth={stroke} strokeDasharray="2 2"/></svg>;
    case 'square':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><rect x={stroke} y={stroke} width={S-2*stroke} height={S-2*stroke} rx="2" fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'square-sm':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><rect x={S*0.2} y={S*0.2} width={S*0.6} height={S*0.6} fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'rounded':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><rect x={stroke} y={stroke+S*0.15} width={S-2*stroke} height={(S-2*stroke)-S*0.3} rx={S*0.18} fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'diamond':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><path d={`M${H} ${stroke} L${S-stroke} ${H} L${H} ${S-stroke} L${stroke} ${H} Z`} fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'triangle':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><path d={`M${H} ${stroke} L${S-stroke} ${S-stroke} L${stroke} ${S-stroke} Z`} fill={bg} stroke={col} strokeWidth={stroke}/></svg>;
    case 'chevron':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><path d={`M${stroke} ${S-stroke} L${H} ${stroke+S*0.1} L${S-stroke} ${S-stroke} L${H} ${S*0.66} Z`} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>;
    case 'hex':
      { const dx = S*0.18; return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><path d={`M${dx} ${H} L${H} ${stroke} L${S-dx} ${H} L${S-dx} ${S-stroke} L${H} ${S-stroke+0.001} L${dx} ${S-stroke} Z`} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>; }
    case 'pentagon':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><path d={`M${H} ${stroke} L${S-stroke} ${S*0.42} L${S*0.82} ${S-stroke} L${S*0.18} ${S-stroke} L${stroke} ${S*0.42} Z`} fill={bg} stroke={col} strokeWidth={stroke} strokeLinejoin="round"/></svg>;
    case 'halo':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><circle cx={H} cy={H} r={r} fill="none" stroke={col} strokeOpacity="0.35" strokeWidth={stroke} strokeDasharray="1 2"/><circle cx={H} cy={H} r={S*0.18} fill={col}/></svg>;
    case 'dot-in-ring':
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><circle cx={H} cy={H} r={r} fill={bg} stroke={col} strokeWidth={stroke}/><circle cx={H} cy={H} r={S*0.18} fill={col}/></svg>;
    default:
      return <svg style={sw} viewBox={`0 0 ${S} ${S}`}><circle cx={H} cy={H} r={r} fill={col}/></svg>;
  }
}

function PersonaAvatar({ name, size=22 }) {
  const p = window.RAVN_DATA?.PERSONA_BY_NAME[name];
  const role = p?.role || 'review';
  const letter = (p?.name || name || '·').charAt(0).toUpperCase();
  return (
    <span className="persona-av" title={name} style={{ width:size+2, height:size+2 }}>
      <PersonaShape shape={RVN_ROLE_SHAPE[role] || 'ring'} size={size}/>
      <span className="persona-av-letter" style={{ fontSize: Math.round(size*0.46) }}>{letter}</span>
    </span>
  );
}

// ─── status dot + badge ──
function StateDot({ state, size=8 }) {
  const cls = { active:'ok', idle:'mute', suspended:'warn', failed:'err' }[state] || 'mute';
  return <span className={`state-dot ${cls} ${state==='active'?'pulse':''}`} style={{ width:size, height:size }}/>;
}
function StateBadge({ state }) {
  const cls = { active:'ok', idle:'mute', suspended:'warn', failed:'err', completed:'mute' }[state] || 'mute';
  return <span className={`badge ${cls}`}><StateDot state={state==='completed'?'idle':state}/><span>{state}</span></span>;
}

// ─── Budget bar ──
function BudgetBar({ spent, cap, warnAt=80, showLabel=false, size='md' }) {
  const pct = cap > 0 ? (spent/cap)*100 : 0;
  const warn = pct >= warnAt;
  const over = pct >= 100;
  const cls = over ? 'err' : warn ? 'warn' : 'ok';
  return (
    <div className={`budget-bar ${size} ${cls}`}>
      <div className="budget-track">
        <div className="budget-fill" style={{ width: Math.min(100, pct) + '%' }}/>
        {warnAt > 0 && <div className="budget-warn-mark" style={{ left: warnAt + '%' }}/>}
      </div>
      {showLabel && (
        <div className="budget-label">
          <span className="budget-spent">${spent.toFixed(2)}</span>
          <span className="budget-divider">/</span>
          <span className="budget-cap">${cap.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Sparkline (line) ──
function Sparkline({ values, w=120, h=28, strokeColor='var(--brand-300)', fill=true }) {
  if (!values || !values.length) return null;
  const max = Math.max(...values, 0.001);
  const min = 0;
  const pad = 2;
  const pts = values.map((v,i) => {
    const x = pad + (i/(values.length-1))*(w-2*pad);
    const y = pad + (1 - (v-min)/(max-min||1))*(h-2*pad);
    return [x,y];
  });
  const d = pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const area = d + ` L${pts[pts.length-1][0].toFixed(1)},${h-pad} L${pts[0][0].toFixed(1)},${h-pad} Z`;
  return (
    <svg width={w} height={h} style={{display:'block'}}>
      {fill && <path d={area} fill="color-mix(in srgb, var(--brand-300) 14%, transparent)"/>}
      <path d={d} fill="none" stroke={strokeColor} strokeWidth="1.2"/>
    </svg>
  );
}

// ─── Mount chip (primary / archive / read-only) ──
function MountChip({ name, role, priority }) {
  const roleCls = role === 'primary' ? 'prim' : role === 'archive' ? 'arch' : 'ro';
  return (
    <span className={`mount-chip ${roleCls}`} title={`${name} (${role}${priority?` · p${priority}`:''})`}>
      <span className="mount-chip-dot"/>
      <span className="mount-chip-name">{name}</span>
      <span className="mount-chip-role">{role}</span>
    </span>
  );
}

// ─── Kbd-style inline token ──
function Kbd({ children }) { return <span className="kbd">{children}</span>; }

// ─── Deployment glyph ──
const DEPLOY_GLYPH = {
  k8s: '◇', systemd: '◈', pi: '◆', mobile: '▲', ephemeral: '◌',
};
function DeployBadge({ deployment }) {
  return (
    <span className="deploy-badge" title={deployment}>
      <span className="deploy-glyph">{DEPLOY_GLYPH[deployment] || '◌'}</span>
      <span>{deployment}</span>
    </span>
  );
}

// ─── Inline metric ──
function Metric({ label, value, accent=false }) {
  return (
    <span className={`metric-inline ${accent?'accent':''}`}>
      <span className="metric-k">{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

// ─── Segmented control ──
function Seg({ options, value, onChange, size='md' }) {
  return (
    <div className={`seg seg-${size}`}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : (o.label || o.value);
        return (
          <button key={v} className={`seg-btn ${v===value?'active':''}`} onClick={()=>onChange(v)}>{l}</button>
        );
      })}
    </div>
  );
}

// expose
Object.assign(window, {
  PersonaShape, PersonaAvatar,
  StateDot, StateBadge,
  BudgetBar, Sparkline,
  MountChip, DeployBadge, Metric, Seg, Kbd,
  RVN_ROLE_SHAPE,
});
