/* global React */
// ─── Völundr atoms — tiny primitives reused across pages ──────

const { useMemo: useAm, useEffect: useAe, useState: useAs, useRef: useAr } = React;

// ── StatusDot / StatusPill ────────────────────────────────────
function StatusDot({ status, size=7 }) {
  const meta = window.VOL_DATA.STATUS_META[status] || window.VOL_DATA.STATUS_META.stopped;
  const pulsing = status === 'active' || status === 'booting';
  return (
    <span className={`v-dot ${pulsing?'pulsing':''}`}
          style={{ width:size, height:size, background:meta.dot }}/>
  );
}

function StatusPill({ status, activity, dotOnly }) {
  const meta = window.VOL_DATA.STATUS_META[status] || window.VOL_DATA.STATUS_META.stopped;
  const detail = activity === 'tool_executing' ? ' · tool' : activity === 'idle' ? ' · idle' : '';
  if (dotOnly) {
    return (
      <span className={`v-pill v-pill-${status} v-pill-dotonly`} title={`${meta.label}${detail}`}>
        <StatusDot status={status}/>
      </span>
    );
  }
  return (
    <span className={`v-pill v-pill-${status}`}>
      <StatusDot status={status}/>
      <span>{meta.label}{detail}</span>
    </span>
  );
}

// ── Source label (git repo@branch · or local-mount path) ─
function SourceLabel({ source, short=false }) {
  if (!source) return <span className="dim mono">—</span>;
  if (source.type === 'git') {
    const [org, repo] = source.repo.split('/');
    const href = source.url || `https://github.com/${source.repo}/tree/${source.branch}`;
    return (
      <a className="v-source mono" href={href} target="_blank" rel="noreferrer"
         title={`open ${source.repo}@${source.branch}`}>
        <span className="v-source-icon" aria-hidden>❯</span>
        {short ? <span>{repo}</span> : <><span className="dim">{org}/</span><span>{repo}</span></>}
        <span className="dim">@</span><span className="v-source-branch">{source.branch}</span>
      </a>
    );
  }
  return (
    <span className="v-source mono" title={source.path}>
      <span className="v-source-icon v-mount" aria-hidden>⌂</span>
      <span>{source.path}</span>
    </span>
  );
}

// ── ClusterChip — named forge/cluster w/ kind ────
function ClusterChip({ id }) {
  const c = window.VOL_DATA.CLUSTER_BY_ID[id];
  if (!c) return <span className="dim mono">—</span>;
  return (
    <span className={`v-cluster v-cluster-${c.kind}`}>
      <span className="v-cluster-name">{c.name}</span>
      <span className="v-cluster-kind mono dim">{c.kind}</span>
    </span>
  );
}

// ── ModelChip — shows alias, with tier color ────
function ModelChip({ alias }) {
  const m = window.VOL_DATA.MODEL_BY_ALIAS[alias];
  if (!m) return <span className="mono dim">{alias}</span>;
  return (
    <span className={`v-model v-model-${m.tier}`} title={`${m.label} · ${m.provider} · ${m.ctx} · ${m.cost}`}>
      <span className="v-model-tier"/>
      <span className="mono">{alias}</span>
    </span>
  );
}

// ── CliBadge — CLI tool identity ─
function CliBadge({ cli, compact=false }) {
  const t = window.VOL_DATA.CLI_TOOLS[cli];
  if (!t) return null;
  // Brand-neutral: one restrained chip treatment for all CLIs.
  // Identity stays in the rune + label, not in a vendor color.
  return (
    <span className="v-cli">
      <span className="v-cli-rune mono">{t.rune}</span>
      {!compact && <span className="v-cli-label">{t.label}</span>}
    </span>
  );
}

// ── Meter — utilisation bar (cpu/mem/gpu) ─
function Meter({ used, limit, unit='', label, critical=0.85 }) {
  if (used == null || limit == null) {
    return (
      <div className="v-meter v-meter-empty">
        {label && <div className="v-meter-label"><span>{label}</span><span className="dim mono">—</span></div>}
        <div className="v-meter-bar"><div className="v-meter-fill" style={{width:'0%'}}/></div>
      </div>
    );
  }
  const pct = Math.min(1, used/limit);
  const level = pct >= critical ? 'hot' : pct >= 0.6 ? 'warm' : 'cool';
  return (
    <div className={`v-meter v-meter-${level}`}>
      {label && <div className="v-meter-label">
        <span>{label}</span>
        <span className="mono dim">{used}<span className="op">/</span>{limit}{unit}</span>
      </div>}
      <div className="v-meter-bar">
        <div className="v-meter-fill" style={{ width: `${(pct*100).toFixed(1)}%` }}/>
      </div>
    </div>
  );
}

// ── Sparkline — inline SVG sparkline ────
function Sparkline({ values, width=120, height=26, stroke='var(--brand-400)', fill='color-mix(in srgb, var(--brand-400) 15%, transparent)' }) {
  if (!values || !values.length) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const span = Math.max(1, max - min);
  const step = width / Math.max(1, values.length - 1);
  const pts = values.map((v,i) => `${(i*step).toFixed(1)},${(height - ((v-min)/span) * (height-2) - 1).toFixed(1)}`).join(' ');
  const area = `M 0,${height} L ${pts} L ${width},${height} Z`;
  const line = `M ${pts}`;
  return (
    <svg className="v-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={area} fill={fill} stroke="none"/>
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── RelTime — "3m ago" etc. Re-computed each mount ─
function relTime(ts) {
  if (!ts) return '—';
  const d = Math.max(0, Date.now() - ts);
  if (d < 60*1000)    return `${Math.floor(d/1000)}s ago`;
  if (d < 3600*1000)  return `${Math.floor(d/60000)}m ago`;
  if (d < 86400*1000) return `${Math.floor(d/3600000)}h ago`;
  return `${Math.floor(d/86400000)}d ago`;
}
function RelTime({ t }) { return <span className="mono dim">{relTime(t)}</span>; }

// ── Segment — flat toggle control ────
function Segment({ value, onChange, options }) {
  return (
    <div className="v-seg">
      {options.map(o => (
        <button key={o.value} className={`v-seg-opt ${value===o.value?'active':''}`}
                onClick={()=>onChange(o.value)}>
          {o.icon && <span className="v-seg-icon">{o.icon}</span>}
          {o.label}
          {o.count!=null && <span className="v-seg-count mono">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── IconBtn — ghost icon button with hover label ─
function IconBtn({ children, title, onClick, variant='ghost', danger=false, disabled=false }) {
  return (
    <button className={`v-iconbtn ${variant} ${danger?'danger':''}`}
            title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// ── MoneyUSD — always prints `$NN.NN` in mono ─
function money(cents) {
  const d = cents/100;
  if (d >= 1000) return `$${(d/1000).toFixed(1)}k`;
  return `$${d.toFixed(2)}`;
}
function tokens(n) {
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}k`;
  return `${n}`;
}

// ── SVG ICONS — lucide-ish, stroke currentColor ─
const Icon = {
  plus: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>,
  play: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z"/></svg>,
  stop: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>,
  x:    (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>,
  chev: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>,
  chevLeft: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>,
  chevDown: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>,
  search: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>,
  refresh: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>,
  archive: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4"/></svg>,
  trash: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6"/></svg>,
  copy: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>,
  link: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>,
  term: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 7 4 4-4 4M12 15h8"/></svg>,
  chat: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  code: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>,
  diff: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v12M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9v6a4 4 0 0 1-4 4h-2"/></svg>,
  file: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>,
  chronicle: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M4 7h16M4 12h16M4 17h16"/></svg>,
  git: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8 6h3a4 4 0 0 1 4 4"/></svg>,
  mount: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12 12 3l9 9M5 10v10h14V10M9 20v-6h6v6"/></svg>,
  cpu: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>,
  gpu: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="10" rx="1"/><circle cx="8" cy="12" r="2.2"/><circle cx="16" cy="12" r="2.2"/></svg>,
  mem: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="1"/><path d="M7 10v4M11 10v4M15 10v4M19 10v4"/></svg>,
  spark: (p={}) => <svg {...p} width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 2.2 6.6 6.6 2.2-6.6 2.2L12 22l-2.2-8.8L3.2 11l6.6-2.2z"/></svg>,
  anvil: (p={}) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h12a3 3 0 0 1 3 3v1H9a4 4 0 0 1-4-4z"/><path d="M11 12v3M9 15h4M8 18h8M7 21h10"/></svg>,
};

window.VOL_ATOMS = { StatusDot, StatusPill, SourceLabel, ClusterChip, ModelChip, CliBadge, Meter, Sparkline, RelTime, Segment, IconBtn, Icon, money, tokens, relTime };
Object.assign(window, { StatusDot, StatusPill, SourceLabel, ClusterChip, ModelChip, CliBadge, Meter, Sparkline, RelTime, Segment, IconBtn, Icon });
