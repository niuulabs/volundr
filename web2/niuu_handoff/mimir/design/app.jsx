/* global React, ReactDOM */
// ─── Mímir · Flokk shell mount ─────────────────────────────────────

const { Shell, makePlaceholder } = window.FlokkShell;
const { DEFAULT_REGISTRY, DS_RUNES } = window.FlokkData;

// Lean stubs for sibling plugins so the shell rail renders correctly.
// makePlaceholder returns a component; the shell calls descriptor.render(ctx)
// so each stub's render is a function that yields the placeholder element.
function stub(t, s, d) {
  const C = makePlaceholder(t, s, d);
  return () => <C />;
}

function App() {
  const [registry, setRegistry] = React.useState(DEFAULT_REGISTRY);

  const plugins = React.useMemo(()=>[
    { id:'observatory', rune: DS_RUNES.flokk,    title:'Flokk · Observatory', subtitle:'live topology & entity registry',
      render: stub('Observatory plugin', 'topology & registry', 'Full build lives in the Observatory workspace. This stub keeps the rail wiring honest.') },
    { id:'tyr',         rune: DS_RUNES.tyr,      title:'Týr',       subtitle:'saga & raid orchestration',
      render: stub('Týr plugin', 'saga orchestration', 'Týr UI — dispatch, planning, sessions. Lives in its own workspace.') },
    { id:'bifrost',     rune: DS_RUNES.bifrost,  title:'Bifröst',   subtitle:'LLM gateway',
      render: stub('Bifröst plugin', 'llm gateway', 'Route inspector, provider fan-out, cache analytics.') },
    { id:'volundr',     rune: DS_RUNES.volundr,  title:'Völundr',   subtitle:'session forge',
      render: stub('Völundr plugin', 'dev pod forge', 'Forge, attach, tear down remote dev sessions.') },
    window.MimirPlugin,   // ← the live one
    { id:'valkyrie',    rune: DS_RUNES.valkyrie, title:'Valkyrie',  subtitle:'guardian agents',
      render: stub('Valkyrie plugin', 'guardian agents', 'Per-cluster autonomous agent console.') },
  ], []);

  // Force Mímir active on first load; honour localStorage thereafter.
  React.useEffect(()=>{
    if (!localStorage.getItem('flokk.active')) localStorage.setItem('flokk.active', 'mimir');
  }, []);

  return <Shell plugins={plugins} registry={registry} setRegistry={setRegistry} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
