/* global React */
const { useState, useMemo, useEffect, useRef, useCallback } = React;

// ───── RUNES (safe set — no excluded ones) ─────
const RUNES = {
  tyr: 'ᛃ',        // Jera — harvest/cycles
  observatory: 'ᛞ',// Dagaz — clarity
  volundr: 'ᚲ',    // Kenaz — forge
  ravn: 'ᚱ',       // Raidho — journey
  mimir: 'ᛗ',      // Mannaz — self/knowledge
  bifrost: 'ᚨ',    // Ansuz — divine speech
  sleipnir: 'ᛖ',   // Ehwaz — horse
  buri: 'ᛜ',       // Ingwaz — gestation
  valkyrie: 'ᛒ',   // Berkanan
};

// ───── PERSONA LIBRARY (mirrors src/ravn/personas/*.yaml) ─────
// event-type in/out drives the subscription graph. If a stage's persona
// produces an event no downstream persona consumes → dead-letter warning.
const PERSONAS = [
  { id:'decomposer',  name:'decomposer',   role:'Plan',    color:'#7dd3fc', letter:'D',
    consumes:['saga.requested','tracker.issue.ingested'],
    produces:['saga.decomposed'],
    summary:'Breaks a tracker issue into phases and raids.' },
  { id:'coding-agent', name:'coding-agent', role:'Build',   color:'#bae6fd', letter:'C',
    consumes:['raid.ready','raid.retry'],
    produces:['code.changed','raid.attempted'],
    summary:'Implements a raid: writes code, commits to the raid branch, opens a PR.' },
  { id:'coder',       name:'coder',        role:'Build',   color:'#93c5fd', letter:'C',
    consumes:['raid.ready'],
    produces:['code.changed'],
    summary:'Minimal coding persona — code only, no PR handling.' },
  { id:'qa-agent',    name:'qa-agent',     role:'Verify',  color:'#a7f3d0', letter:'Q',
    consumes:['code.changed','qa.requested'],
    produces:['qa.completed'],
    summary:'Runs the full test suite and emits a pass/fail verdict.' },
  { id:'reviewer',    name:'reviewer',     role:'Review',  color:'#c4b5fd', letter:'R',
    consumes:['code.changed','review.requested'],
    produces:['review.completed'],
    summary:'Structured code review — severity-ranked findings, verdict.' },
  { id:'review-arbiter', name:'review-arbiter', role:'Gate', color:'#f9a8d4', letter:'A',
    consumes:['review.completed','qa.completed'],
    produces:['review.arbitrated'],
    summary:'Fuses reviewer + QA verdicts into one binding gate verdict.' },
  { id:'security-auditor', name:'security-auditor', role:'Audit', color:'#fca5a5', letter:'S',
    consumes:['code.changed','security.requested'],
    produces:['security.audited'],
    summary:'Static-analysis + dependency + secret-scan audit.' },
  { id:'health-auditor', name:'health-auditor', role:'Audit', color:'#fdba74', letter:'H',
    consumes:['health.requested'],
    produces:['health.audited'],
    summary:'System health probe across the flock.' },
  { id:'verifier',    name:'verifier',     role:'Verify',  color:'#86efac', letter:'V',
    consumes:['review.arbitrated','verify.requested'],
    produces:['verify.completed'],
    summary:'Live behavioural verification (runs the thing).' },
  { id:'ship-agent',  name:'ship-agent',   role:'Ship',    color:'#fcd34d', letter:'S',
    consumes:['verify.completed','release.requested'],
    produces:['release.cut'],
    summary:'Version bump + changelog + release PR.' },
  { id:'investigator',name:'investigator', role:'Plan',    color:'#f0abfc', letter:'I',
    consumes:['investigate.requested'],
    produces:['investigation.completed'],
    summary:'Deep-dive research into a bug/repo/system.' },
  { id:'mimir-curator',name:'mimir-curator',role:'Index',  color:'#a5f3fc', letter:'M',
    consumes:['raid.completed','chronicle.emitted'],
    produces:['mimir.indexed'],
    summary:'Writes chronicles + artefacts into the Mímir index.' },
  { id:'reporter',    name:'reporter',     role:'Report',  color:'#fde68a', letter:'R',
    consumes:['saga.completed','raid.merged'],
    produces:['report.emitted'],
    summary:'Human-readable summary + metrics roll-up.' },
  { id:'retro-analyst',name:'retro-analyst',role:'Report', color:'#fdba74', letter:'R',
    consumes:['saga.completed'],
    produces:['retro.completed'],
    summary:'Post-saga retrospective analysis.' },
  { id:'raid-executor',name:'raid-executor',role:'Build',  color:'#a7f3d0', letter:'X',
    consumes:['raid.ready'],
    produces:['raid.attempted'],
    summary:'Generic raid executor — dispatches to Völundr session.' },
];

const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map(p=>[p.id,p]));

// Stage kinds — building blocks of the pipeline
const STAGE_KINDS = [
  { id:'trigger',   label:'Trigger',    rune:'⚡', desc:'Saga entry point' },
  { id:'stage',     label:'Stage',      rune:'◆', desc:'A flock of personas running in parallel or sequence' },
  { id:'gate',      label:'Human gate', rune:'⌘', desc:'Pause for human approval' },
  { id:'cond',      label:'Condition',  rune:'?', desc:'Branch on verdict / metric' },
  { id:'end',       label:'End',        rune:'●', desc:'Saga completion' },
];

// ───── SAGA MOCK DATA ─────
const now = Date.now();
const ago = (mins) => new Date(now - mins*60000).toISOString();
const fmtAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime())/1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
};

const SAGAS = [
  { id:'saga-01', identifier:'NIU-214', name:'Flokk subscription validation',
    status:'running', confidence:0.82, tracker:'linear', repos:['niuulabs/volundr'],
    branch:'niu-214-sub-validation', base:'main', created:ago(260),
    phases:[
      { id:'p1', number:1, name:'Plan', status:'complete', confidence:0.95, raids:[
        { id:'r1a', identifier:'NIU-214.1', name:'Decompose subscription rules', status:'merged', confidence:0.95, persona:'decomposer', estimate:0.5 },
      ]},
      { id:'p2', number:2, name:'Build', status:'active', confidence:0.78, raids:[
        { id:'r2a', identifier:'NIU-214.2', name:'Implement subscription graph', status:'running', confidence:0.78, persona:'coding-agent', estimate:3 },
        { id:'r2b', identifier:'NIU-214.3', name:'Surface dead-letter warnings in UI', status:'review', confidence:0.72, persona:'coding-agent', estimate:2 },
      ]},
      { id:'p3', number:3, name:'Verify', status:'pending', confidence:0, raids:[
        { id:'r3a', identifier:'NIU-214.4', name:'Integration tests for graph validator', status:'pending', confidence:0, persona:'qa-agent', estimate:1 },
      ]},
      { id:'p4', number:4, name:'Ship', status:'pending', confidence:0, raids:[
        { id:'r4a', identifier:'NIU-214.5', name:'Release cut', status:'pending', confidence:0, persona:'ship-agent', estimate:0.25 },
      ]},
    ] },
  { id:'saga-02', identifier:'NIU-199', name:'Observatory canvas realms overlay',
    status:'running', confidence:0.71, tracker:'linear', repos:['niuulabs/volundr'],
    branch:'niu-199-realms-overlay', base:'main', created:ago(1440),
    phases:[
      { id:'p1', number:1, name:'Plan', status:'complete', confidence:0.9, raids:[
        { id:'r1a', identifier:'NIU-199.1', name:'Sketch realm boundary model', status:'merged', confidence:0.9, persona:'decomposer', estimate:0.5 },
      ]},
      { id:'p2', number:2, name:'Build', status:'active', confidence:0.65, raids:[
        { id:'r2a', identifier:'NIU-199.2', name:'Realm boundary SVG', status:'running', confidence:0.65, persona:'coding-agent', estimate:2 },
        { id:'r2b', identifier:'NIU-199.3', name:'Realm colour ramp tokens', status:'queued', confidence:0, persona:'coding-agent', estimate:1 },
      ]},
      { id:'p3', number:3, name:'Review', status:'gated', confidence:0, raids:[
        { id:'r3a', identifier:'NIU-199.4', name:'Review arbitration', status:'pending', confidence:0, persona:'review-arbiter', estimate:0.5 },
      ]},
    ]},
  { id:'saga-03', identifier:'NIU-183', name:'Mímir chronicle indexing pipeline',
    status:'review', confidence:0.68, tracker:'linear', repos:['niuulabs/volundr'],
    branch:'niu-183-chronicle-indexer', base:'main', created:ago(2880),
    phases:[
      { id:'p1', number:1, name:'Plan', status:'complete', confidence:0.85, raids:[
        { id:'r1a', identifier:'NIU-183.1', name:'Chronicle schema', status:'merged', confidence:0.85, persona:'decomposer', estimate:1 },
      ]},
      { id:'p2', number:2, name:'Build', status:'complete', confidence:0.8, raids:[
        { id:'r2a', identifier:'NIU-183.2', name:'Indexer service', status:'merged', confidence:0.82, persona:'coding-agent', estimate:4 },
        { id:'r2b', identifier:'NIU-183.3', name:'Chronicle emitter in drive_loop', status:'merged', confidence:0.78, persona:'coding-agent', estimate:2 },
      ]},
      { id:'p3', number:3, name:'Review', status:'active', confidence:0.55, raids:[
        { id:'r3a', identifier:'NIU-183.4', name:'Arbitrated review', status:'review', confidence:0.55, persona:'review-arbiter', estimate:1 },
      ]},
    ]},
  { id:'saga-04', identifier:'NIU-148', name:'Bifröst rate-limit per-model',
    status:'failed', confidence:0.31, tracker:'linear', repos:['niuulabs/volundr','niuulabs/bifrost'],
    branch:'niu-148-bifrost-ratelimit', base:'main', created:ago(4300),
    phases:[
      { id:'p1', number:1, name:'Plan', status:'complete', confidence:0.75, raids:[
        { id:'r1a', identifier:'NIU-148.1', name:'Decompose strategy', status:'merged', confidence:0.75, persona:'decomposer', estimate:0.5 },
      ]},
      { id:'p2', number:2, name:'Build', status:'complete', confidence:0.62, raids:[
        { id:'r2a', identifier:'NIU-148.2', name:'Token-bucket impl', status:'failed', confidence:0.31, persona:'coding-agent', estimate:4 },
      ]},
    ]},
  { id:'saga-05', identifier:'NIU-088', name:'Sleipnir NATS-backed transport',
    status:'complete', confidence:0.94, tracker:'linear', repos:['niuulabs/volundr'],
    branch:'niu-088-sleipnir-nats', base:'main', created:ago(8100),
    phases:[
      { id:'p1', number:1, name:'Ship', status:'complete', confidence:0.94, raids:[
        { id:'r1a', identifier:'NIU-088.1', name:'NATS adapter', status:'merged', confidence:0.94, persona:'coding-agent', estimate:6 },
      ]},
    ]},
];

// Dispatch queue
const QUEUE = [
  { id:'q1', sagaId:'saga-01', raid:'r3a', ready:true, waitMin: 2 },
  { id:'q2', sagaId:'saga-01', raid:'r4a', ready:false, waitMin: 0, blockedBy:'verify' },
  { id:'q3', sagaId:'saga-02', raid:'r2b', ready:true, waitMin: 14 },
  { id:'q4', sagaId:'saga-02', raid:'r3a', ready:false, waitMin: 0, blockedBy:'gate: product review' },
  { id:'q5', sagaId:'saga-03', raid:'r3a', ready:true, waitMin: 48, retry:1 },
];

// ───── WORKFLOW templates (reusable pipelines) ─────
// Each template is a graph: nodes[] + edges[]. Node x,y for the graph view.
const TEMPLATES = [
  {
    id:'tpl-ship', name:'ship — default release cycle',
    description:'qa → pre-ship review → version bump → release PR. Matches src/tyr/templates/ship.yaml.',
    version:'1.4.2', updated: ago(4300), author:'jonas',
    tags:['ship','release'],
    nodes:[
      { id:'trig', kind:'trigger', x:40,  y:320, label:'manual dispatch' },
      { id:'s1',   kind:'stage',   x:260, y:260, name:'test-suite',       members:[{ persona:'qa-agent', budget:40 }] },
      { id:'s2',   kind:'stage',   x:520, y:260, name:'pre-ship-review',  members:[{ persona:'reviewer', budget:60 }] },
      { id:'c1',   kind:'cond',    x:780, y:260, name:'review verdict',   expr:'review.verdict == pass' },
      { id:'s3',   kind:'stage',   x:1000,y:200, name:'version-bump',     members:[{ persona:'ship-agent', budget:30 }] },
      { id:'s4',   kind:'stage',   x:1240,y:200, name:'release-pr',       members:[{ persona:'ship-agent', budget:20 }] },
      { id:'end',  kind:'end',     x:1480,y:320, label:'shipped' },
    ],
    edges:[
      { from:'trig', to:'s1' },
      { from:'s1',   to:'s2', cond:'qa.completed:pass' },
      { from:'s2',   to:'c1' },
      { from:'c1',   to:'s3', label:'pass' },
      { from:'c1',   to:'end',label:'reject' },
      { from:'s3',   to:'s4' },
      { from:'s4',   to:'end' },
    ]
  },
  {
    id:'tpl-deep', name:'deep-review — arbitrated',
    description:'Parallel review + qa → arbiter gate → verifier. Used for risky merges.',
    version:'0.9.1', updated: ago(1440), author:'jonas', tags:['review','arbiter'],
    nodes:[
      { id:'trig', kind:'trigger', x:40,  y:320, label:'code.changed' },
      { id:'s1',   kind:'stage',   x:260, y:180, name:'review',  members:[{ persona:'reviewer', budget:60 }] },
      { id:'s2',   kind:'stage',   x:260, y:360, name:'qa',      members:[{ persona:'qa-agent', budget:40 }] },
      { id:'s3',   kind:'stage',   x:260, y:540, name:'security',members:[{ persona:'security-auditor', budget:50 }] },
      { id:'s4',   kind:'stage',   x:540, y:360, name:'arbitrate', joinMode:'all', members:[{ persona:'review-arbiter', budget:20 }] },
      { id:'g1',   kind:'gate',    x:800, y:360, name:'ship steward' },
      { id:'s5',   kind:'stage',   x:1060,y:360, name:'verify',  members:[{ persona:'verifier', budget:30 }] },
      { id:'end',  kind:'end',     x:1320,y:360 },
    ],
    edges:[
      { from:'trig', to:'s1' }, { from:'trig', to:'s2' }, { from:'trig', to:'s3' },
      { from:'s1', to:'s4' }, { from:'s2', to:'s4' }, { from:'s3', to:'s4' },
      { from:'s4', to:'g1' }, { from:'g1', to:'s5' }, { from:'s5', to:'end' },
    ],
  },
  {
    id:'tpl-investigate', name:'investigate — triage',
    description:'Single investigator → human gate → optional coder follow-up.',
    version:'0.3.0', updated: ago(12000), author:'oskar', tags:['triage','research'],
    nodes:[
      { id:'trig', kind:'trigger', x:40, y:200, label:'investigate.requested' },
      { id:'s1',   kind:'stage',   x:260,y:200, name:'investigate', members:[{ persona:'investigator', budget:80 }] },
      { id:'g1',   kind:'gate',    x:520,y:200, name:'triage review' },
      { id:'c1',   kind:'cond',    x:760,y:200, name:'follow-up?', expr:'gate.approved' },
      { id:'s2',   kind:'stage',   x:1000,y:120,name:'fix',   members:[{ persona:'coding-agent', budget:60 }] },
      { id:'end',  kind:'end',     x:1200,y:280 },
    ],
    edges:[
      { from:'trig', to:'s1' }, { from:'s1', to:'g1' }, { from:'g1', to:'c1' },
      { from:'c1', to:'s2', label:'yes' }, { from:'c1', to:'end', label:'no' }, { from:'s2', to:'end' },
    ],
  },
];

// Current draft workflow (editable)
const DEFAULT_DRAFT = {
  id:'draft',
  name:'New workflow',
  description:'',
  version:'0.1.0-draft',
  nodes:[
    { id:'trig', kind:'trigger', x:40, y:260, label:'manual dispatch' },
    { id:'s1', kind:'stage', x:280, y:220, name:'build', members:[{persona:'coding-agent', budget:40}] },
    { id:'s2', kind:'stage', x:540, y:220, name:'review',  members:[{persona:'reviewer', budget:60}] },
    { id:'c1', kind:'cond',  x:820, y:220, name:'verdict', expr:'review.verdict == pass' },
    { id:'s3', kind:'stage', x:1060,y:140, name:'ship', members:[{persona:'ship-agent', budget:30}] },
    { id:'end',kind:'end',   x:1320,y:300, label:'end' },
  ],
  edges:[
    { from:'trig', to:'s1' }, { from:'s1', to:'s2' }, { from:'s2', to:'c1' },
    { from:'c1', to:'s3', label:'pass' }, { from:'c1', to:'end', label:'reject' }, { from:'s3', to:'end' },
  ],
};

// Export
Object.assign(window, {
  RUNES, PERSONAS, PERSONA_BY_ID, STAGE_KINDS,
  SAGAS, QUEUE, TEMPLATES, DEFAULT_DRAFT, fmtAgo, ago,
});
