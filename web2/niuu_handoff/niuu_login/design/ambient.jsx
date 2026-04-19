/* global React */
// ─── Ambient background canvases ────────────────────────────
// Each is a full-bleed SVG/canvas that sits behind the login card.
// Dark, subtle, slow-moving. Ice-blue palette.

// ── Topology — soft node graph, faint pulses ─────────────────
function AmbientTopology() {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    let w, h, nodes, raf;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = c.width = c.clientWidth * dpr;
      h = c.height = c.clientHeight * dpr;
      ctx.scale(dpr, dpr);
      seed();
    };
    const N = 28;
    const seed = () => {
      nodes = Array.from({length: N}, () => ({
        x: Math.random() * c.clientWidth,
        y: Math.random() * c.clientHeight,
        vx: (Math.random()-0.5) * 0.08,
        vy: (Math.random()-0.5) * 0.08,
        r: 1 + Math.random() * 1.6,
        pulse: Math.random() * Math.PI * 2,
      }));
    };
    const draw = () => {
      const W = c.clientWidth, H = c.clientHeight;
      ctx.clearRect(0,0,W,H);
      // edges
      for (let i=0;i<nodes.length;i++) {
        for (let j=i+1;j<nodes.length;j++) {
          const a=nodes[i], b=nodes[j];
          const dx=a.x-b.x, dy=a.y-b.y;
          const d=Math.sqrt(dx*dx+dy*dy);
          if (d<180) {
            ctx.strokeStyle = `rgba(125,211,252,${0.08*(1-d/180)})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
          }
        }
      }
      // nodes
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x<0||n.x>W) n.vx*=-1;
        if (n.y<0||n.y>H) n.vy*=-1;
        n.pulse += 0.01;
        const p = 0.5 + 0.5*Math.sin(n.pulse);
        ctx.fillStyle = `rgba(186,230,253,${0.35+0.35*p})`;
        ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    resize(); draw();
    const onR = () => { ctx.setTransform(1,0,0,1,0,0); resize(); };
    window.addEventListener('resize', onR);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onR); };
  }, []);
  return <canvas ref={canvasRef} className="niuu-amb"/>;
}

// ── Constellation — static stars + slow shimmer ──────────────
function AmbientConstellation() {
  const stars = React.useMemo(() => {
    const out = [];
    for (let i=0;i<80;i++) {
      out.push({
        x: Math.random()*100, y: Math.random()*100,
        r: 0.4 + Math.random()*1.2,
        d: 2 + Math.random()*4,
        delay: Math.random()*4,
      });
    }
    return out;
  }, []);
  return (
    <svg className="niuu-amb" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="glow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#09090b" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#glow)"/>
      {stars.map((s,i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#bae6fd">
          <animate attributeName="opacity"
                   values="0.2;0.9;0.2"
                   dur={`${s.d}s`}
                   begin={`${s.delay}s`}
                   repeatCount="indefinite"/>
        </circle>
      ))}
    </svg>
  );
}

// ── Lattice — rotating faint rune circle, minimal ────────────
function AmbientLattice() {
  return (
    <svg className="niuu-amb" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="latGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.08"/>
          <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.02"/>
          <stop offset="100%" stopColor="#09090b" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="800" height="600" fill="url(#latGlow)"/>
      <g transform="translate(400 300)" stroke="rgba(186,230,253,0.14)" fill="none">
        {/* concentric rings */}
        <circle r="120" strokeWidth="0.6"/>
        <circle r="200" strokeWidth="0.6"/>
        <circle r="280" strokeWidth="0.5" strokeDasharray="2 4"/>
        <circle r="380" strokeWidth="0.4" strokeDasharray="4 8"/>
        {/* spoke ticks */}
        {Array.from({length:12},(_,i)=>{
          const a = (i/12)*Math.PI*2;
          const x1 = 200*Math.cos(a), y1 = 200*Math.sin(a);
          const x2 = 280*Math.cos(a), y2 = 280*Math.sin(a);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="0.6"/>;
        })}
        {/* rotating rune band */}
        <g>
          <animateTransform attributeName="transform" type="rotate"
                            from="0" to="360" dur="220s" repeatCount="indefinite"/>
          {['ᚲ','ᛃ','ᚱ','ᛗ','ᚨ','ᛖ','ᚠ','ᛒ','ᛞ','ᛜ','ᚾ','ᚲ'].map((r,i)=>{
            const a = (i/12)*Math.PI*2;
            const x = 340*Math.cos(a), y = 340*Math.sin(a);
            return (
              <text key={i} x={x} y={y+4} textAnchor="middle"
                    fontFamily="JetBrainsMono NF, monospace" fontSize="12"
                    fill="rgba(186,230,253,0.3)">{r}</text>
            );
          })}
        </g>
      </g>
    </svg>
  );
}

Object.assign(window, { AmbientTopology, AmbientConstellation, AmbientLattice });
