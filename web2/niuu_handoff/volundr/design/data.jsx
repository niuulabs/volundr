/* global */
// ─── Völundr mock data — sessions, templates, credentials, clusters ─
// The dwarf-smith. Session forge — spawns and manages remote dev pods.

// ── MODELS / CLI TOOLS ────────────────────────────────────────
// Aliases the runtime resolves. Tier colors keep the pod cards skim-able.
const MODELS = [
  { alias:'sonnet-primary',  provider:'anthropic', tier:'frontier',  ctx:'200k', cost:'$3/$15', label:'claude-sonnet-4.5' },
  { alias:'haiku-primary',   provider:'anthropic', tier:'execution', ctx:'200k', cost:'$0.8/$4', label:'claude-haiku-4.5' },
  { alias:'opus-reasoning',  provider:'anthropic', tier:'reasoning', ctx:'200k', cost:'$15/$75', label:'claude-opus-4.1' },
  { alias:'codex-primary',   provider:'openai',    tier:'frontier',  ctx:'128k', cost:'$2.5/$10', label:'gpt-5-codex' },
  { alias:'gemini-primary',  provider:'google',    tier:'frontier',  ctx:'1M',   cost:'$1.25/$5', label:'gemini-2.5-pro' },
  { alias:'qwen-local',      provider:'ollama',    tier:'balanced',  ctx:'64k',  cost:'local',   label:'qwen3:72b' },
  { alias:'llama-local',     provider:'vllm',      tier:'execution', ctx:'32k',  cost:'local',   label:'llama-3.3:70b' },
];

const CLI_TOOLS = {
  claude:  { label:'Claude Code', rune:'ᛗ', color:'#d97757', desc:'Anthropic · agentic coding' },
  codex:   { label:'Codex',       rune:'ᚲ', color:'#10a37f', desc:'OpenAI · CLI coding agent' },
  gemini:  { label:'Gemini',      rune:'ᛇ', color:'#4285f4', desc:'Google · CLI coding agent' },
  aider:   { label:'Aider',       rune:'ᚨ', color:'#b48a6d', desc:'pair-programmer · git-aware' },
};

// ── CLUSTERS (forges) — k8s targets this Völundr can spawn pods into ──
// Each cluster reports live capacity. GPU counts drive the launch-time
// feasibility check; disk reflects the storage pool for session PVCs.
const CLUSTERS = [
  { id:'valaskjalf', name:'Valaskjálf', realm:'asgard',        kind:'primary',  region:'ca-hamilton-1',
    nodes:{ ready:4, total:4 }, cpu:{ used:68, total:128, unit:'cores' }, mem:{ used:420, total:768, unit:'GiB' },
    gpu:{ used:2, total:4, kind:'H100' }, disk:{ used:3.2, total:8, unit:'TiB' }, sessions:12, status:'healthy' },
  { id:'valhalla',   name:'Valhalla',   realm:'asgard',        kind:'gpu',      region:'ca-hamilton-1',
    nodes:{ ready:3, total:3 }, cpu:{ used:22, total:96,  unit:'cores' }, mem:{ used:180, total:512, unit:'GiB' },
    gpu:{ used:6, total:8, kind:'H100' }, disk:{ used:1.1, total:4, unit:'TiB' }, sessions:6,  status:'healthy' },
  { id:'noatun',     name:'Nóatún',     realm:'midgard',       kind:'edge',     region:'ca-toronto',
    nodes:{ ready:2, total:2 }, cpu:{ used:8,  total:32,  unit:'cores' }, mem:{ used:40,  total:128, unit:'GiB' },
    gpu:{ used:0, total:0 },                     disk:{ used:0.3, total:1, unit:'TiB' }, sessions:2, status:'healthy' },
  { id:'eitri',      name:'Eitri',      realm:'svartalfheim',  kind:'local',    region:'desk',
    nodes:{ ready:1, total:1 }, cpu:{ used:3,  total:16,  unit:'cores' }, mem:{ used:18,  total:64,  unit:'GiB' },
    gpu:{ used:1, total:1, kind:'M3 Max' },      disk:{ used:0.1, total:2, unit:'TiB' }, sessions:1, status:'warning' },
  { id:'glitnir',    name:'Glitnir',    realm:'midgard',       kind:'observ',   region:'ca-hamilton-2',
    nodes:{ ready:2, total:2 }, cpu:{ used:6,  total:24,  unit:'cores' }, mem:{ used:22,  total:80,  unit:'GiB' },
    gpu:{ used:0, total:0 },                     disk:{ used:0.2, total:1, unit:'TiB' }, sessions:0, status:'healthy' },
  { id:'jarnvidr',   name:'Járnviðr',   realm:'jotunheim',     kind:'media',    region:'ca-hamilton-2',
    nodes:{ ready:2, total:2 }, cpu:{ used:4,  total:24,  unit:'cores' }, mem:{ used:12,  total:64,  unit:'GiB' },
    gpu:{ used:0, total:2, kind:'L40S' },        disk:{ used:0.4, total:2, unit:'TiB' }, sessions:0, status:'healthy' },
];

// ── TEMPLATES — workspace+runtime archetypes for new sessions ─
const TEMPLATES = [
  { name:'niuu-platform',      desc:'Full niuu monorepo · all modules',                cli:'claude', model:'sonnet-primary',
    repos:['volundr','flokk','tyr','bifrost'], resources:{cpu:'4',mem:'16Gi',gpu:'0'},
    mcp:['filesystem','git','linear'], skills:2, rules:1, default:true, usage:142 },
  { name:'volundr-web',        desc:'Only the web/ sub-tree · fast setup',             cli:'claude', model:'haiku-primary',
    repos:['volundr'], resources:{cpu:'2',mem:'8Gi',gpu:'0'}, mcp:['filesystem','git'], skills:0, rules:1, usage:87 },
  { name:'bifrost-gateway',    desc:'LLM gateway · provider adapters',                 cli:'codex', model:'codex-primary',
    repos:['bifrost'], resources:{cpu:'2',mem:'4Gi',gpu:'0'}, mcp:['filesystem','git'], skills:0, rules:0, usage:23 },
  { name:'mimir-embeddings',   desc:'Indexer · needs GPU for local embeds',            cli:'claude', model:'sonnet-primary',
    repos:['mimir'], resources:{cpu:'4',mem:'32Gi',gpu:'1'}, mcp:['filesystem','git','linear'], skills:1, rules:2, usage:14 },
  { name:'scratch',            desc:'Blank pod · no repo · quick experiments',         cli:'claude', model:'haiku-primary',
    repos:[],         resources:{cpu:'1',mem:'2Gi',gpu:'0'}, mcp:['filesystem'], skills:0, rules:0, usage:58 },
  { name:'local-laptop',       desc:'Mount your laptop · claude-code against it',      cli:'claude', model:'sonnet-primary',
    repos:[], mounts:['~/code/niuu'], resources:{cpu:'2',mem:'6Gi',gpu:'0'}, mcp:['filesystem','git'], skills:2, rules:1, usage:201 },
];

// ── CREDENTIALS — secrets injected into sessions ─
const CREDENTIALS = [
  { id:'cr-1', name:'anthropic-key',      type:'api_key',      keys:['ANTHROPIC_API_KEY'],                    used:42, updated:'2d ago',  scope:'global' },
  { id:'cr-2', name:'openai-key',         type:'api_key',      keys:['OPENAI_API_KEY'],                        used:17, updated:'2d ago',  scope:'global' },
  { id:'cr-3', name:'google-key',         type:'api_key',      keys:['GOOGLE_API_KEY'],                        used:3,  updated:'2d ago',  scope:'global' },
  { id:'cr-4', name:'github-niuu',        type:'git_credential', keys:['GIT_USERNAME','GIT_PASSWORD'],         used:128,updated:'1w ago',  scope:'global' },
  { id:'cr-5', name:'linear-oauth',       type:'oauth_token',  keys:['LINEAR_TOKEN','LINEAR_REFRESH'],         used:14, updated:'6h ago',  scope:'global' },
  { id:'cr-6', name:'ssh-deploy',         type:'ssh_key',      keys:['id_ed25519','id_ed25519.pub'],           used:2,  updated:'1mo ago', scope:'template:niuu-platform' },
  { id:'cr-7', name:'aws-mimir',          type:'api_key',      keys:['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'], used:6, updated:'3d ago', scope:'template:mimir-embeddings' },
  { id:'cr-8', name:'hf-hub',             type:'api_key',      keys:['HF_TOKEN'],                              used:4,  updated:'2w ago',  scope:'global' },
  { id:'cr-9', name:'tls-niuu-internal',  type:'tls_cert',     keys:['tls.crt','tls.key','ca.crt'],            used:0,  updated:'3mo ago', scope:'cluster:valaskjalf' },
];

// ── SESSIONS — live + idle + stopped + archived pods ──
// `source` maps to SessionSource in the backend (git or local_mount).
// `chatEp`/`termEp` mock the per-pod service URLs exposed by Skuld.
const NOW = Date.now();
const M = 60*1000, H = 3600*1000, D = 86400*1000;

const SESSIONS = [
  { id:'s-4912', name:'observatory-canvas-perf', status:'active',    activity:'tool_executing',
    source:{ type:'git', repo:'niuu/volundr',     branch:'obs-perf' }, cluster:'valaskjalf',
    cli:'claude', model:'sonnet-primary', template:'volundr-web',
    owner:'mk', ownerRole:'admin',
    created: NOW - 3*H, lastActive: NOW - 22*M, duration:'2h 34m',
    msgs:47, tokensIn:82_400, tokensOut:14_200, costCents:328,
    cpu:{ used:2.1, limit:4 }, mem:{ used:5.4, limit:16 }, gpu:null, diskMiB:412,
    files:{ added:7, modified:22, deleted:3 },
    commits:2, pr:{ num:248, state:'open', title:'obs: canvas panning/zoom perf' },
    issue:'NIU-482',
    raidId:'r-obs-q1', raidName:'Observatory Q1 perf pass',
    peers:[
      { id:'s-4901', name:'bifrost-ollama-adapter', role:'companion', activity:'idle',    state:'open' },
      { id:'s-4876', name:'tyr-raid-cohesion',      role:'companion', activity:'idle',    state:'open' },
      { id:'s-4801', name:'observatory-keyboard-nav', role:'sibling', activity:null,      state:'merged' },
    ],
    outcome:{
      state:'in-review',
      pr:{ num:248, state:'open', title:'obs: canvas panning/zoom perf' },
      tests:{ passed:58, failed:1, total:59 },
      perf:{ label:'frame time', before:'18ms', after:'6ms', delta:'-67%' },
      blockers:[{ kind:'test', label:'observatory.a11y · 1 failing' }],
    },
    preview:'running jest --watch on modified files · 12 passing · 1 failing',
    chronicle:[
      { t: NOW - 3*H,        type:'session',  label:'pod scheduled on valaskjalf-03' },
      { t: NOW - 3*H + 40*1000, type:'git',    label:'cloned niuu/volundr@main · switch obs-perf', action:'clone' },
      { t: NOW - 2*H - 48*M,  type:'message',  label:'user: the drag lags on 400-entity graphs', tokens:38 },
      { t: NOW - 2*H - 30*M,  type:'file',     label:'observatory.jsx · added quadtree cull',    ins:214, del:12 },
      { t: NOW - 2*H - 12*M,  type:'terminal', label:'npm test observatory.perf.test.jsx',        exit:0 },
      { t: NOW - 2*H - 2*M,   type:'git',      label:'commit · perf: quadtree cull @ 60fps',      hash:'f2b9c1a' },
      { t: NOW - 90*M,        type:'message',  label:'assistant: frame time dropped 18ms→6ms',    tokens:420 },
      { t: NOW - 70*M,        type:'file',     label:'observatory.jsx · throttle pan rAF',       ins:34,  del:18 },
      { t: NOW - 45*M,        type:'git',      label:'commit · perf: throttle pan to rAF',        hash:'a019be2' },
      { t: NOW - 40*M,        type:'terminal', label:'git push origin obs-perf',                  exit:0 },
      { t: NOW - 38*M,        type:'session',  label:'opened PR #248',                            action:'pr' },
      { t: NOW - 22*M,        type:'terminal', label:'npm test · watch',                          exit:null },
    ],
    diffStats:[
      { path:'observatory.jsx',         status:'mod', ins:248, del:30 },
      { path:'observatory.perf.test.jsx', status:'new', ins:142, del:0 },
      { path:'canvas/quadtree.js',      status:'new', ins:96,  del:0 },
      { path:'styles.css',              status:'mod', ins:8,   del:2 },
    ],
  },
  { id:'s-4908', name:'ravn-triggers-ui',        status:'active',    activity:'active',
    source:{ type:'git', repo:'niuu/volundr', branch:'ravn-ui' }, cluster:'valaskjalf',
    cli:'claude', model:'sonnet-primary', template:'volundr-web',
    owner:'mk', ownerRole:'admin',
    created: NOW - 8*H, lastActive: NOW - 4*M, duration:'6h 12m',
    msgs:112, tokensIn:210_000, tokensOut:41_300, costCents:842,
    cpu:{ used:1.3, limit:4 }, mem:{ used:4.8, limit:16 }, gpu:null, diskMiB:618,
    files:{ added:3, modified:14, deleted:0 }, commits:5,
    pr:{ num:251, state:'open', title:'ravn: events + triggers merge' },
    issue:'NIU-479',
    preview:'assistant: wiring fan-in chips into EventSubscriptions column',
  },
  { id:'s-4901', name:'bifrost-ollama-adapter',  status:'active',    activity:'idle',
    source:{ type:'git', repo:'niuu/bifrost', branch:'feat/ollama' }, cluster:'valaskjalf',
    cli:'codex', model:'codex-primary', template:'bifrost-gateway',
    owner:'mk', ownerRole:'admin',
    created: NOW - 26*H, lastActive: NOW - 2*H, duration:'1d 2h',
    msgs:38, tokensIn:58_000, tokensOut:8_700, costCents:162,
    cpu:{ used:0.2, limit:2 }, mem:{ used:1.1, limit:4 }, gpu:null, diskMiB:188,
    files:{ added:2, modified:6, deleted:1 }, commits:3,
    pr:{ num:12, state:'merged', title:'feat: ollama adapter' },
    preview:'idle · last tool call 2h ago',
  },
  { id:'s-4887', name:'mimir-bge-reindex',       status:'active',    activity:'tool_executing',
    source:{ type:'git', repo:'niuu/mimir',   branch:'reindex-bge' }, cluster:'valhalla',
    cli:'claude', model:'sonnet-primary', template:'mimir-embeddings',
    owner:'mk', ownerRole:'admin',
    created: NOW - 40*M, lastActive: NOW - 1*M, duration:'40m',
    msgs:18, tokensIn:22_400, tokensOut:3_100, costCents:88,
    cpu:{ used:3.6, limit:4 }, mem:{ used:22.1, limit:32 }, gpu:{ used:94, limit:100, kind:'H100' }, diskMiB:1420,
    files:{ added:0, modified:3, deleted:0 }, commits:0, pr:null, issue:'NIU-401',
    preview:'running bge-large-en-v1.5 over 48k docs · batch 412/1500',
  },
  { id:'s-4880', name:'laptop-volundr-local',    status:'active',    activity:'active',
    source:{ type:'local_mount', path:'~/code/niuu' }, cluster:'eitri',
    cli:'claude', model:'sonnet-primary', template:'local-laptop',
    owner:'mk', ownerRole:'admin',
    created: NOW - 18*M, lastActive: NOW - 30*1000, duration:'18m',
    msgs:9, tokensIn:11_200, tokensOut:2_400, costCents:44,
    cpu:{ used:0.8, limit:2 }, mem:{ used:2.1, limit:6 }, gpu:null, diskMiB:0,
    files:{ added:0, modified:2, deleted:0 }, commits:0, pr:null,
    preview:'reading volundr/web/src/modules/volundr/pages/Volundr/index.tsx',
  },
  { id:'s-4876', name:'tyr-raid-cohesion',       status:'active',    activity:'idle',
    source:{ type:'git', repo:'niuu/volundr', branch:'tyr-raid' }, cluster:'valaskjalf',
    cli:'claude', model:'opus-reasoning', template:'volundr-web',
    owner:'mk', ownerRole:'admin',
    created: NOW - 11*H, lastActive: NOW - 4*H, duration:'11h',
    msgs:88, tokensIn:340_000, tokensOut:71_200, costCents:1480,
    cpu:{ used:0.3, limit:4 }, mem:{ used:3.2, limit:16 }, gpu:null, diskMiB:280,
    files:{ added:1, modified:9, deleted:1 }, commits:4,
    pr:{ num:246, state:'open', title:'tyr: raid cohesion heuristics' }, issue:'NIU-470',
    preview:'waiting on review · idle 4h',
  },
  { id:'s-4870', name:'aider-css-migration',     status:'active',    activity:'active',
    source:{ type:'git', repo:'niuu/volundr', branch:'css-token-migrate' }, cluster:'valaskjalf',
    cli:'aider', model:'haiku-primary', template:'volundr-web',
    owner:'mk', ownerRole:'admin',
    created: NOW - 50*M, lastActive: NOW - 2*M, duration:'50m',
    msgs:32, tokensIn:19_800, tokensOut:4_200, costCents:32,
    cpu:{ used:1.1, limit:2 }, mem:{ used:3.4, limit:8 }, gpu:null, diskMiB:220,
    files:{ added:0, modified:44, deleted:0 }, commits:1, pr:null,
    preview:'replacing hardcoded hex with token vars · 44 files touched',
  },
  { id:'s-4865', name:'docs-release-notes',      status:'active',    activity:'idle',
    source:{ type:'git', repo:'niuu/volundr', branch:'release-notes-7.2' }, cluster:'valaskjalf',
    cli:'claude', model:'haiku-primary', template:'scratch',
    owner:'mk', ownerRole:'admin',
    created: NOW - 3*H, lastActive: NOW - 2*H, duration:'3h',
    msgs:14, tokensIn:42_000, tokensOut:6_800, costCents:62,
    cpu:{ used:0.1, limit:1 }, mem:{ used:0.9, limit:2 }, gpu:null, diskMiB:64,
    files:{ added:2, modified:1, deleted:0 }, commits:1, pr:null,
    preview:'idle · draft ready for review',
  },

  // ── stopped ──
  { id:'s-4822', name:'bifrost-vllm-bench',      status:'stopped',   activity:null,
    source:{ type:'git', repo:'niuu/bifrost', branch:'bench-vllm' }, cluster:'valhalla',
    cli:'codex', model:'codex-primary', template:'bifrost-gateway',
    owner:'mk', ownerRole:'admin',
    created: NOW - 2*D, lastActive: NOW - 1*D, duration:'8h',
    msgs:54, tokensIn:98_000, tokensOut:12_400, costCents:288,
    cpu:null, mem:null, gpu:null, diskMiB:360,
    files:{ added:1, modified:4, deleted:0 }, commits:2,
    pr:{ num:14, state:'merged', title:'feat: vllm bench harness' },
    preview:'pod stopped · PR merged',
  },
  { id:'s-4801', name:'observatory-keyboard-nav', status:'stopped',  activity:null,
    source:{ type:'git', repo:'niuu/volundr', branch:'obs-kbd' }, cluster:'valaskjalf',
    cli:'claude', model:'haiku-primary', template:'volundr-web',
    owner:'mk', ownerRole:'admin',
    created: NOW - 4*D, lastActive: NOW - 3*D, duration:'2h',
    msgs:22, tokensIn:28_000, tokensOut:4_100, costCents:46,
    cpu:null, mem:null, gpu:null, diskMiB:140,
    files:{ added:0, modified:3, deleted:0 }, commits:1,
    pr:{ num:234, state:'merged', title:'obs: arrow-key nav' },
    preview:'stopped · merged 3d ago',
  },

  // ── error ──
  { id:'s-4855', name:'gemini-adapter-spike',    status:'error',     activity:null,
    source:{ type:'git', repo:'niuu/bifrost', branch:'spike/gemini' }, cluster:'valaskjalf',
    cli:'gemini', model:'gemini-primary', template:'bifrost-gateway',
    owner:'mk', ownerRole:'admin',
    created: NOW - 5*H, lastActive: NOW - 4*H, duration:'0m',
    msgs:0, tokensIn:0, tokensOut:0, costCents:0,
    cpu:null, mem:null, gpu:null, diskMiB:0,
    files:{ added:0, modified:0, deleted:0 }, commits:0, pr:null,
    error:'CredentialNotFound: google-key scope=global — key rotation in progress',
    preview:'ready to retry once credential is refreshed',
  },

  // ── booting ──
  { id:'s-4915', name:'niuu-integration-tests',  status:'booting',   activity:null,
    source:{ type:'git', repo:'niuu/volundr', branch:'main' }, cluster:'valaskjalf',
    cli:'claude', model:'sonnet-primary', template:'niuu-platform',
    owner:'mk', ownerRole:'admin',
    created: NOW - 40*1000, lastActive: NOW - 40*1000, duration:'0m',
    msgs:0, tokensIn:0, tokensOut:0, costCents:0,
    cpu:null, mem:null, gpu:null, diskMiB:0,
    files:{ added:0, modified:0, deleted:0 }, commits:0, pr:null,
    preview:'pulling image ghcr.io/niuu/forge:7.2 · cloning repo…',
    bootStep: 'cloning',
    bootProgress: 0.4,
  },
];

// ── TOKEN-BURN SPARKLINE — last hour, one bin per minute ──
// Keeps the header chip honest. Tied to active sessions only.
const TOKEN_BURN_LAST_HOUR = [
  420, 380, 290, 312, 480, 510, 388, 244, 180, 220,
  510, 688, 812, 720, 640, 520, 410, 480, 580, 720,
  640, 580, 510, 440, 520, 610, 520, 480, 440, 410,
  380, 420, 520, 640, 720, 780, 820, 780, 680, 580,
  510, 440, 420, 380, 360, 340, 380, 420, 480, 520,
  580, 610, 680, 720, 760, 780, 720, 660, 580, 510,
];

// ── BOOT STEPS — launch wizard + session-starting indicator ──
// Order is load-bearing: CredentialCheck happens BEFORE clone so bad
// creds fail fast without burning network time.
const BOOT_STEPS = [
  { id:'schedule',     label:'schedule pod',         dur:  3 },
  { id:'pull',         label:'pull image',           dur: 18 },
  { id:'creds',        label:'check credentials',    dur:  2 },
  { id:'clone',        label:'clone workspace',      dur: 24 },
  { id:'mount',        label:'attach PVCs · mount sidecars', dur: 4 },
  { id:'mcp',          label:'bring MCP servers up', dur:  6 },
  { id:'cli',          label:'boot CLI tool',        dur:  4 },
  { id:'ready',        label:'ready',                dur:  0 },
];

const STATUS_META = {
  active:  { label:'active',  color:'var(--brand-400)',    dot:'var(--brand-500)' },
  booting: { label:'booting', color:'var(--brand-300)',    dot:'var(--brand-300)' },
  idle:    { label:'idle',    color:'var(--color-text-muted)', dot:'var(--color-text-muted)' },
  stopped: { label:'stopped', color:'var(--color-text-faint)', dot:'var(--color-text-faint)' },
  error:   { label:'error',   color:'#f87171',            dot:'var(--color-critical)' },
};

// Derived lookups
const SESSION_BY_ID = Object.fromEntries(SESSIONS.map(s => [s.id, s]));
const CLUSTER_BY_ID = Object.fromEntries(CLUSTERS.map(c => [c.id, c]));
const TEMPLATE_BY_NAME = Object.fromEntries(TEMPLATES.map(t => [t.name, t]));
const MODEL_BY_ALIAS = Object.fromEntries(MODELS.map(m => [m.alias, m]));

// ── FLEET STATS — derived counters for header ─
function computeStats(sessions) {
  const active  = sessions.filter(s => s.status === 'active').length;
  const booting = sessions.filter(s => s.status === 'booting').length;
  const error   = sessions.filter(s => s.status === 'error').length;
  const tokens  = sessions.reduce((n,s) => n + (s.tokensIn||0) + (s.tokensOut||0), 0);
  const cost    = sessions.reduce((n,s) => n + (s.costCents||0), 0);
  return { active, booting, error, tokens, costDollars: cost/100 };
}

window.VOL_DATA = {
  MODELS, CLI_TOOLS, CLUSTERS, TEMPLATES, CREDENTIALS, SESSIONS, TOKEN_BURN_LAST_HOUR, BOOT_STEPS, STATUS_META,
  SESSION_BY_ID, CLUSTER_BY_ID, TEMPLATE_BY_NAME, MODEL_BY_ALIAS,
  computeStats,
};
