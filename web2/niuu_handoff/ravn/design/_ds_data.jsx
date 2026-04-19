/* global React */
// ─── Flokk Observatory data — type registry + world mock ─────────

// Runes per Niuu DS — these are brand-tagged identity glyphs
const DS_RUNES = {
  volundr: 'ᚲ', tyr: 'ᛃ', ravn: 'ᚱ', mimir: 'ᛗ', bifrost: 'ᚨ',
  sleipnir: 'ᛖ', buri: 'ᛜ', hlidskjalf: 'ᛞ', flokk: 'ᚠ',
  skuld: 'ᚾ', valkyrie: 'ᛒ',
};

// ── Default type registry (seed) ────────────────────────────────
// Schema matches SDD §4.1
const DEFAULT_REGISTRY = {
  version: 7,
  updatedAt: '2026-04-15T09:24:11Z',
  types: [
    // Containers / realms
    { id: 'realm',        label: 'Realm',           rune: 'ᛞ', icon: 'globe',       shape: 'ring',         color: 'ice-100',   size: 18, border: 'solid',
      canContain: ['cluster','host','ravn_long','valkyrie','printer','vaettir','beacon'], parentTypes: [], category: 'topology',
      description: 'VLAN-scoped network zone — asgard, midgard, svartalfheim, etc. Every entity lives in exactly one realm.',
      fields: [
        { key: 'vlan',    label: 'VLAN',     type: 'number', required: true },
        { key: 'dns',     label: 'DNS zone', type: 'string', required: true },
        { key: 'purpose', label: 'Purpose',  type: 'string' },
      ] },
    { id: 'cluster',      label: 'Cluster',         rune: 'ᚲ', icon: 'layers',      shape: 'ring-dashed',  color: 'ice-200',   size: 14, border: 'dashed',
      canContain: ['service','raid','tyr','bifrost','volundr','valkyrie','mimir'], parentTypes: ['realm'], category: 'topology',
      description: 'Kubernetes cluster nested inside a realm. Valaskjálf, Valhalla, Nóatún, Eitri, Glitnir, Járnviðr.',
      fields: [
        { key: 'purpose', label: 'Purpose', type: 'string' },
        { key: 'nodes',   label: 'Nodes',   type: 'number' },
      ] },
    { id: 'host',         label: 'Host',            rune: 'ᚦ', icon: 'server',      shape: 'rounded-rect', color: 'slate-400', size: 22, border: 'solid',
      canContain: ['ravn_long','service'], parentTypes: ['realm'], category: 'hardware',
      description: 'Bare-metal or VM. DGX Sparks, Mac minis, EPYC boxes, user laptops.',
      fields: [
        { key: 'hw',      label: 'Hardware', type: 'string' },
        { key: 'os',      label: 'OS',       type: 'string' },
        { key: 'cores',   label: 'Cores',    type: 'number' },
        { key: 'ram',     label: 'RAM',      type: 'string' },
        { key: 'gpu',     label: 'GPU',      type: 'string' },
      ] },

    // Agents — ravens and valkyries
    { id: 'ravn_long',    label: 'Long-lived Ravn', rune: 'ᚱ', icon: 'bird',        shape: 'diamond',      color: 'brand',     size: 11, border: 'solid',
      canContain: [], parentTypes: ['host','cluster','realm'], category: 'agent',
      description: 'Persistent raven agent bound to a host or free-orbiting around Mímir. Persona, specialty, tool access.',
      fields: [
        { key: 'persona',   label: 'Persona',   type: 'select', options: ['thought','memory','strength','battle','noise','valkyrie'] },
        { key: 'specialty', label: 'Specialty', type: 'string' },
        { key: 'tokens',    label: 'Tokens',    type: 'number' },
      ] },
    { id: 'ravn_raid',    label: 'Raid Ravn',       rune: 'ᚲ', icon: 'bird',        shape: 'triangle',     color: 'ice-300',   size: 8,  border: 'solid',
      canContain: [], parentTypes: ['raid'], category: 'agent',
      description: 'Ephemeral raven conscripted into a raid. Coord, Reviewer, or Scholar role.',
      fields: [
        { key: 'role',       label: 'Role',       type: 'select', options: ['coord','reviewer','scholar'] },
        { key: 'confidence', label: 'Confidence', type: 'number' },
      ] },
    { id: 'skuld',        label: 'Skuld',           rune: 'ᛜ', icon: 'radio',       shape: 'hex',          color: 'ice-200',   size: 9,  border: 'solid',
      canContain: [], parentTypes: ['raid','cluster'], category: 'agent',
      description: 'WebSocket broker — pair-bonded to a raid for chat fan-out.',
      fields: [] },
    { id: 'valkyrie',     label: 'Valkyrie',        rune: 'ᛒ', icon: 'shield',      shape: 'chevron',      color: 'brand-400', size: 13, border: 'solid',
      canContain: [], parentTypes: ['cluster','realm'], category: 'agent',
      description: 'Autonomous guardian agent. Takes action at the cluster level — restarts, failovers, scale events.',
      fields: [
        { key: 'specialty', label: 'Specialty', type: 'string' },
        { key: 'autonomy',  label: 'Autonomy',  type: 'select', options: ['full','notify','restricted'] },
      ] },

    // Coordinators
    { id: 'tyr',          label: 'Týr',             rune: 'ᛃ', icon: 'git-branch',  shape: 'square',       color: 'brand',     size: 16, border: 'solid',
      canContain: [], parentTypes: ['cluster','realm'], category: 'coordinator',
      description: 'Saga / raid orchestrator. One per cluster; dispatches raids to coordinate work across Völundrs.',
      fields: [
        { key: 'activeSagas',  label: 'Active sagas', type: 'number' },
        { key: 'pendingRaids', label: 'Pending raids',type: 'number' },
        { key: 'mode',         label: 'Mode',         type: 'select', options: ['active','standby'] },
      ] },
    { id: 'bifrost',      label: 'Bifröst',         rune: 'ᚨ', icon: 'waves',       shape: 'pentagon',     color: 'brand',     size: 15, border: 'solid',
      canContain: ['model'], parentTypes: ['cluster','realm'], category: 'coordinator',
      description: 'LLM gateway. Routes inference to providers — Anthropic, OpenAI, Google, local Ollama, local vLLM.',
      fields: [
        { key: 'reqPerMin',    label: 'Req/min',      type: 'number' },
        { key: 'cacheHitRate', label: 'Cache hit %',  type: 'number' },
        { key: 'providers',    label: 'Providers',    type: 'tags' },
      ] },
    { id: 'volundr',      label: 'Völundr',         rune: 'ᚲ', icon: 'hammer',      shape: 'square',       color: 'brand',     size: 16, border: 'solid',
      canContain: [], parentTypes: ['cluster','realm'], category: 'coordinator',
      description: 'Session forge — spawns and manages remote development pods. Directly connected to Týrs.',
      fields: [
        { key: 'activeSessions', label: 'Active', type: 'number' },
        { key: 'maxSessions',    label: 'Max',    type: 'number' },
      ] },

    // Knowledge
    { id: 'mimir',        label: 'Mímir',           rune: 'ᛗ', icon: 'book-open',   shape: 'mimir',        color: 'ice-100',   size: 42, border: 'solid',
      canContain: ['mimir_sub'], parentTypes: ['cluster','realm'], category: 'knowledge',
      description: 'The well of knowledge. Primary indexer. All long-lived ravens read from and write to Mímir.',
      fields: [
        { key: 'pages',  label: 'Pages',  type: 'number' },
        { key: 'writes', label: 'Writes', type: 'number' },
      ] },
    { id: 'mimir_sub',    label: 'Sub-Mímir',       rune: 'ᛗ', icon: 'book-marked', shape: 'mimir-small',  color: 'ice-200',   size: 18, border: 'solid',
      canContain: [], parentTypes: ['mimir'], category: 'knowledge',
      description: 'Domain-scoped Mímir — code, ops, lore. Sits in orbit around the primary Mímir.',
      fields: [
        { key: 'purpose', label: 'Purpose', type: 'string' },
      ] },

    // Services and devices
    { id: 'service',      label: 'Service',         rune: 'ᛦ', icon: 'box',         shape: 'dot',          color: 'ice-300',   size: 8,  border: 'solid',
      canContain: [], parentTypes: ['cluster','host'], category: 'infrastructure',
      description: 'Kubernetes workload — Sleipnir, Keycloak, OpenBao, Cerbos, Harbor, Grafana, vLLM, Ollama, etc.',
      fields: [
        { key: 'svcType', label: 'Type', type: 'select', options: ['rabbitmq','auth','secrets','authz','database','inference','registry','gitops','dashboard','logs','traces','media','manufacturing','orchestrator'] },
      ] },
    { id: 'model',        label: 'LLM Model',       rune: 'ᛖ', icon: 'cpu',         shape: 'dot',          color: 'slate-300', size: 7,  border: 'solid',
      canContain: [], parentTypes: ['bifrost','realm'], category: 'knowledge',
      description: 'Inference endpoint behind Bifröst. External (Anthropic, OpenAI, Google) drawn as long threads; internal (vLLM, Ollama) short.',
      fields: [
        { key: 'provider',  label: 'Provider', type: 'string' },
        { key: 'location',  label: 'Location', type: 'select', options: ['internal','external'] },
      ] },
    { id: 'printer',      label: 'Resin Printer',   rune: 'ᛈ', icon: 'printer',     shape: 'square-sm',    color: 'slate-400', size: 10, border: 'solid',
      canContain: [], parentTypes: ['realm'], category: 'device',
      description: 'SLA resin printer on YDP WebSocket. Saturn 4 Ultras named after legendary weapons.',
      fields: [
        { key: 'model', label: 'Model', type: 'string' },
      ] },
    { id: 'vaettir',      label: 'Vættir Room Node',rune: 'ᚹ', icon: 'mic',         shape: 'square-sm',    color: 'slate-400', size: 9,  border: 'solid',
      canContain: [], parentTypes: ['realm'], category: 'device',
      description: 'ESP32 room presence node — mmWave, mic, speaker. Named for the locale it inhabits.',
      fields: [
        { key: 'sensors', label: 'Sensors', type: 'tags' },
      ] },
    { id: 'beacon',       label: 'Presence Beacon', rune: 'ᚠ', icon: 'wifi',        shape: 'dot',          color: 'slate-400', size: 5,  border: 'dashed',
      canContain: [], parentTypes: ['realm'], category: 'device',
      description: 'ESPresense BLE beacon — low-power wireless presence detection.',
      fields: [] },

    // Composite
    { id: 'raid',         label: 'Raid',            rune: 'ᚷ', icon: 'users',       shape: 'halo',         color: 'brand',     size: 50, border: 'dashed',
      canContain: ['ravn_raid','skuld'], parentTypes: ['cluster'], category: 'composite',
      description: 'Ephemeral flock — ravens dispatched by a Týr to execute a saga. Forms, works, dissolves.',
      fields: [
        { key: 'purpose',     label: 'Purpose',     type: 'string' },
        { key: 'state',       label: 'State',       type: 'select', options: ['forming','working','dissolving'] },
        { key: 'composition', label: 'Composition', type: 'tags' },
      ] },
  ],
};

// ── Shape swatch for registry editor ────────────────────────────
// Returns an SVG element the UI can render inline.
function ShapeSvg({ shape, color, size = 20 }) {
  const s = size;
  const c = `var(--${color || 'brand'}, currentColor)`.replace('var(--brand,', 'var(--color-brand,');
  const resolved = color && color.startsWith('ice-') ? `var(--brand-${color.split('-')[1]})`
                 : color === 'brand' ? 'var(--color-brand)'
                 : color && color.startsWith('brand-') ? `var(--brand-${color.split('-')[1]})`
                 : color && color.startsWith('slate-') ? `var(--color-text-${color === 'slate-400' ? 'muted' : 'secondary'})`
                 : 'var(--color-brand)';
  const props = { width: s, height: s, viewBox: '-10 -10 20 20', xmlns: 'http://www.w3.org/2000/svg' };
  switch(shape) {
    case 'ring':
      return <svg {...props}><circle cx="0" cy="0" r="7" fill="none" stroke={resolved} strokeWidth="1.4" /></svg>;
    case 'ring-dashed':
      return <svg {...props}><circle cx="0" cy="0" r="7" fill="none" stroke={resolved} strokeWidth="1.2" strokeDasharray="2 2" /></svg>;
    case 'rounded-rect':
      return <svg {...props}><rect x="-7" y="-5" width="14" height="10" rx="2" fill="none" stroke={resolved} strokeWidth="1.4" /></svg>;
    case 'diamond':
      return <svg {...props}><path d="M0,-7 L7,0 L0,7 L-7,0 Z" fill={resolved} opacity="0.85" /></svg>;
    case 'triangle':
      return <svg {...props}><path d="M0,-7 L6,5 L-6,5 Z" fill={resolved} /></svg>;
    case 'hex':
      return <svg {...props}><path d="M-6,-3.5 L0,-7 L6,-3.5 L6,3.5 L0,7 L-6,3.5 Z" fill="none" stroke={resolved} strokeWidth="1.4" /></svg>;
    case 'chevron':
      return <svg {...props}><path d="M-6,5 L0,-6 L6,5 L0,2 Z" fill={resolved} /></svg>;
    case 'square':
      return <svg {...props}><rect x="-6" y="-6" width="12" height="12" rx="1" fill={resolved} /></svg>;
    case 'square-sm':
      return <svg {...props}><rect x="-5" y="-5" width="10" height="10" fill="none" stroke={resolved} strokeWidth="1.4" /></svg>;
    case 'pentagon':
      return <svg {...props}><path d="M0,-7 L6.6,-2.2 L4.1,5.6 L-4.1,5.6 L-6.6,-2.2 Z" fill={resolved} /></svg>;
    case 'halo':
      return <svg {...props}><circle cx="0" cy="0" r="7" fill="none" stroke={resolved} strokeWidth="1" strokeDasharray="1 2" /><circle cx="0" cy="0" r="2.5" fill={resolved} /></svg>;
    case 'mimir':
    case 'mimir-small':
      return <svg {...props}><circle cx="0" cy="0" r="5" fill="var(--color-bg-primary)" stroke={resolved} strokeWidth="1.4" /><text x="0" y="1" fontSize="5" fill={resolved} textAnchor="middle" dominantBaseline="middle" fontFamily="monospace">ᛗ</text></svg>;
    case 'dot':
    default:
      return <svg {...props}><circle cx="0" cy="0" r="4" fill={resolved} /></svg>;
  }
}

window.FlokkData = { DEFAULT_REGISTRY, DS_RUNES };
window.ShapeSvg = ShapeSvg;
