/* global React */
// ─── Niuu logo explorations ─────────────────────────────────
// All use currentColor so they inherit from the ice-blue brand-500 (#38bdf8).
// Mono-weight line work. Designed at 56px viewBox; scale via font-size/width.
//
// Variants explored:
//   1. Knot      — two interlocked N's as a Norse-knot braid
//   2. Yggdrasil — vertical world-tree axis, three realm planes
//   3. Stars     — "niuu" rendered as connect-the-dots constellation
//   4. Runering  — ring of 8 entity runes around a central ᚾ
//   5. Flokk     — interlocking hexagons, flight metaphor
//   6. Stack     — stacked ᚾ (naudhiz, "need"), the rune for N

function LogoKnot({ size=56, stroke=1.6, glow=false }) {
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden
         style={{ filter: glow ? 'drop-shadow(0 0 8px currentColor)' : undefined }}>
      <g fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
        {/* left N */}
        <path d="M10 44 V12 L28 38 V14"/>
        {/* right N, interlocking */}
        <path d="M46 44 V16 L28 42 V14" opacity="0.85"/>
        {/* braid crossings — two subtle under/over marks */}
        <circle cx="28" cy="28" r="1.6" fill="currentColor"/>
      </g>
    </svg>
  );
}

function LogoTree({ size=56, stroke=1.4, glow=false }) {
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden
         style={{ filter: glow ? 'drop-shadow(0 0 8px currentColor)' : undefined }}>
      <g fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round">
        {/* trunk */}
        <path d="M28 6 V50"/>
        {/* three realm planes — Asgard, Midgard, Svartalfheim */}
        <path d="M14 14 H42" opacity="0.5"/>
        <path d="M10 28 H46"/>
        <path d="M16 42 H40" opacity="0.6"/>
        {/* branch diagonals */}
        <path d="M28 14 L16 24 M28 14 L40 24" opacity="0.6"/>
        <path d="M28 28 L12 38 M28 28 L44 38" opacity="0.4"/>
        {/* nodes */}
        <circle cx="28" cy="6"  r="1.8" fill="currentColor"/>
        <circle cx="28" cy="28" r="2.4" fill="currentColor"/>
        <circle cx="28" cy="50" r="1.8" fill="currentColor"/>
        <circle cx="14" cy="14" r="1.2" fill="currentColor"/>
        <circle cx="42" cy="14" r="1.2" fill="currentColor"/>
        <circle cx="10" cy="28" r="1.2" fill="currentColor"/>
        <circle cx="46" cy="28" r="1.2" fill="currentColor"/>
      </g>
    </svg>
  );
}

function LogoStars({ size=56, stroke=1.2, glow=false }) {
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden
         style={{ filter: glow ? 'drop-shadow(0 0 6px currentColor)' : undefined }}>
      <g fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" opacity="0.7">
        {/* n */}
        <path d="M6 38 V22 L14 38 V22"/>
        {/* i dot + stem */}
        <path d="M22 22 V38"/>
        {/* u */}
        <path d="M30 22 V34 Q30 38 34 38 H34 Q38 38 38 34 V22"/>
        {/* u */}
        <path d="M42 22 V34 Q42 38 46 38 Q50 38 50 34 V22"/>
      </g>
      <g fill="currentColor">
        {[[6,38],[6,22],[14,22],[14,38],[22,38],[22,22],[22,16],[30,22],[34,38],[38,22],[42,22],[46,38],[50,22]].map((p,i)=>
          <circle key={i} cx={p[0]} cy={p[1]} r={i%3===0?1.6:1} opacity={i%3===0?1:0.6}/>
        )}
      </g>
    </svg>
  );
}

function LogoRuneRing({ size=56, stroke=1.3, glow=false }) {
  // 8 safe runes from DS_RUNES around a central ᚾ (Naudhiz = N of niuu)
  const runes = ['ᚲ','ᛃ','ᚱ','ᛗ','ᚨ','ᛖ','ᚠ','ᛒ'];
  const R = 22;
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden
         style={{ filter: glow ? 'drop-shadow(0 0 8px currentColor)' : undefined }}>
      <circle cx="28" cy="28" r={R} fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.35"/>
      <circle cx="28" cy="28" r="12" fill="none" stroke="currentColor" strokeWidth={stroke} opacity="0.7"/>
      {runes.map((r, i) => {
        const a = (i / runes.length) * Math.PI * 2 - Math.PI / 2;
        const x = 28 + R * Math.cos(a);
        const y = 28 + R * Math.sin(a) + 2;
        return (
          <text key={i} x={x} y={y} textAnchor="middle"
                fontFamily="JetBrainsMono NF, monospace" fontSize="7"
                fill="currentColor" opacity="0.55">{r}</text>
        );
      })}
      <text x="28" y="33" textAnchor="middle"
            fontFamily="JetBrainsMono NF, monospace" fontSize="16"
            fill="currentColor" fontWeight="600">ᚾ</text>
    </svg>
  );
}

function LogoFlokk({ size=56, stroke=1.5, glow=false }) {
  // two interlocking hexagons — flight/group metaphor
  const hex = (cx, cy) => {
    const pts = [];
    for (let i=0;i<6;i++){
      const a = (i/6)*Math.PI*2 - Math.PI/2;
      pts.push(`${cx+14*Math.cos(a)},${cy+14*Math.sin(a)}`);
    }
    return pts.join(' ');
  };
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden
         style={{ filter: glow ? 'drop-shadow(0 0 8px currentColor)' : undefined }}>
      <g fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round">
        <polygon points={hex(22, 28)} opacity="0.9"/>
        <polygon points={hex(34, 28)} opacity="0.7"/>
        <circle cx="28" cy="28" r="2" fill="currentColor"/>
      </g>
    </svg>
  );
}

function LogoStack({ size=56, stroke=1.6, glow=false }) {
  // Stacked naudhiz — three offset crossed lines
  return (
    <svg viewBox="0 0 56 56" width={size} height={size} aria-hidden
         style={{ filter: glow ? 'drop-shadow(0 0 8px currentColor)' : undefined }}>
      <g fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round">
        {/* vertical staves */}
        <path d="M14 10 V46"/>
        <path d="M28 10 V46"/>
        <path d="M42 10 V46"/>
        {/* cross-strokes (naudhiz tick) */}
        <path d="M14 22 L22 14" opacity="0.9"/>
        <path d="M28 30 L36 22"/>
        <path d="M42 38 L50 30" opacity="0.9"/>
      </g>
    </svg>
  );
}

// ── Wordmark — "niuu" in the brand type, paired with a mark ──
function NiuuWordmark({ size=28 }) {
  return (
    <span style={{
      fontFamily: 'Inter, sans-serif',
      fontSize: size, fontWeight: 300,
      letterSpacing: '-0.04em',
      color: 'var(--color-text-primary)',
      lineHeight: 1,
    }}>
      <span style={{ fontWeight: 500 }}>n</span>iuu
    </span>
  );
}

Object.assign(window, {
  LogoKnot, LogoTree, LogoStars, LogoRuneRing, LogoFlokk, LogoStack,
  NiuuWordmark,
});
