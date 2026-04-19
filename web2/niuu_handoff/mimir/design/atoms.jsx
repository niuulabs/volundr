/* global React */
// ─── Mímir atoms — reusable small components ──────────────────────

const { useState, useMemo, useEffect, useRef, useCallback } = React;
const D = window.MIMIR_DATA;

function Chip({ children, tone='default' }) {
  return <span className={`mm-chip ${tone}`}>{children}</span>;
}

function ConfidenceBar({ level }) {
  const pct = level === 'high' ? '92' : level === 'medium' ? '64' : '28';
  return (
    <span className={`mm-conf-bar ${level}`}>
      <span className="track"><span className="fill" /></span>
      <span className="pct">{level} · {pct}</span>
    </span>
  );
}

function StateDot({ state }) {
  return <span className={`mm-state-dot ${state}`} />;
}

function MountDot({ status }) {
  return <span className={`dot ${status !== 'healthy' ? status : ''}`} />;
}

// A chip showing mount origin — used all over to stamp provenance.
function MountChip({ name, role }) {
  const mount = D.MOUNTS.find(m=>m.name===name);
  const r = role || mount?.role || 'local';
  return (
    <span className="mm-chip mount" title={mount?.host||''}>
      <span className="mm-chip-k">mount</span> {name}
      <span style={{color:'var(--color-text-faint)',marginLeft:4}}>·</span>
      <span className={`mm-chip-k`} style={{color:'var(--brand-300)'}}>{r}</span>
    </span>
  );
}

function RavnGlyph({ name, size=36 }) {
  const r = D.RAVNS.find(x=>x.name===name || x.id===name);
  const init = r ? r.name.slice(0,2) : (name||'?').slice(0,2);
  return (
    <span className="glyph" style={{width:size, height:size, fontSize: Math.round(size*0.5)}}>
      {init}
    </span>
  );
}

// convert category path → short label
function catLabel(path) {
  if (!path) return '';
  const parts = path.split('/');
  return parts[0];
}

window.MIMIR_ATOMS = { Chip, ConfidenceBar, StateDot, MountDot, MountChip, RavnGlyph, catLabel };
