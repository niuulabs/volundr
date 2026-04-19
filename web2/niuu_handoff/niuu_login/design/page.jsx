/* global React */
// ─── Niuu login page ──────────────────────────────────────
// One page, six logo variants via a Tweak selector below.
// All use ice-blue brand palette.

const VARIANTS = [
  { id:'knot',     name:'Knot — braided N',        Logo: window.LogoKnot,     tag:'agentic infrastructure, braided' },
  { id:'tree',     name:'Yggdrasil — world-tree',  Logo: window.LogoTree,     tag:'every realm, one trunk' },
  { id:'stars',    name:'Constellation',           Logo: window.LogoStars,    tag:'agents aligned' },
  { id:'runering', name:'Rune ring',               Logo: window.LogoRuneRing, tag:'the flokk, in orbit' },
  { id:'flokk',    name:'Flokk — paired hex',      Logo: window.LogoFlokk,    tag:'two flocks, one flight' },
  { id:'stack',    name:'Naudhiz stack',           Logo: window.LogoStack,    tag:'need · bind · build' },
];

const AMBIENTS = [
  { id:'topology',      name:'Topology graph',   C: window.AmbientTopology },
  { id:'constellation', name:'Star field',       C: window.AmbientConstellation },
  { id:'lattice',       name:'Rune lattice',     C: window.AmbientLattice },
];

function NiuuLogin() {
  const [variant, setVariant] = React.useState(() => localStorage.getItem('niuu.logo') || 'knot');
  const [ambient, setAmbient] = React.useState(() => localStorage.getItem('niuu.amb') || 'topology');
  React.useEffect(()=>localStorage.setItem('niuu.logo', variant), [variant]);
  React.useEffect(()=>localStorage.setItem('niuu.amb', ambient), [ambient]);

  const V = VARIANTS.find(v => v.id === variant) || VARIANTS[0];
  const A = AMBIENTS.find(a => a.id === ambient) || AMBIENTS[0];
  const Logo = V.Logo;
  const AmbC = A.C;

  return (
    <div className="niuu-login" data-theme="ice">
      <AmbC/>

      {/* top-left build line */}
      <div className="niuu-build mono">
        <span className="niuu-build-dot"/> niuu · build 2026.04.18-7f3a2c · valaskjálf
      </div>

      {/* floating card */}
      <main className="niuu-card">
        <div className="niuu-mark">
          <Logo size={72} stroke={1.6} glow/>
        </div>
        <h1 className="niuu-word">
          <window.NiuuWordmark size={44}/>
        </h1>
        <p className="niuu-tag mono">{V.tag}</p>

        <div className="niuu-divider">
          <span>sign in</span>
        </div>

        <div className="niuu-auth">
          <button className="niuu-btn primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>Continue with passkey</span>
            <span className="niuu-kbd mono">↵</span>
          </button>

          <div className="niuu-oauth-row">
            <button className="niuu-btn ghost">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.1.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.3 0 .32.22.69.83.57C20.57 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z"/></svg>
              <span>GitHub</span>
            </button>
            <button className="niuu-btn ghost">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path fill="#e0f2fe" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#bae6fd" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#7dd3fc" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18a10.97 10.97 0 0 0 0 9.86l3.66-2.84z"/>
                <path fill="#38bdf8" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
              <span>Google</span>
            </button>
          </div>
        </div>

        <div className="niuu-foot mono">
          <span className="dim">no account?</span>
          <a href="#" className="niuu-link">request access</a>
        </div>
      </main>

      {/* TWEAKS — floating selector for logo / ambient */}
      <aside className="niuu-tweaks">
        <div className="niuu-tweak-label mono">logo</div>
        <div className="niuu-tweak-grid">
          {VARIANTS.map(v => {
            const L = v.Logo;
            return (
              <button key={v.id}
                className={`niuu-tweak-btn ${variant===v.id?'on':''}`}
                onClick={()=>setVariant(v.id)}
                title={v.name}>
                <L size={28} stroke={1.4}/>
              </button>
            );
          })}
        </div>
        <div className="niuu-tweak-label mono" style={{marginTop:12}}>ambient</div>
        <div className="niuu-tweak-row">
          {AMBIENTS.map(a=>(
            <button key={a.id}
              className={`niuu-tweak-chip mono ${ambient===a.id?'on':''}`}
              onClick={()=>setAmbient(a.id)}>
              {a.id}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

Object.assign(window, { NiuuLogin });
