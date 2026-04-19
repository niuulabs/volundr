/* global React */
// ─── Ravn data — personas, ravens, sessions, triggers, events, budget, log ──

// A note on naming:
//   PERSONAS  — reusable cognitive templates (YAML). Tool access, prompt, LLM, events.
//   RAVENS    — deployed nodes (RavnProfile). Each binds to exactly one persona.
//   SESSIONS  — live interaction threads running against a raven.
//   TRIGGERS  — initiative subscriptions that auto-dispatch work to a raven.
//   EVENTS    — the produce/consume wiring between personas.
//   BUDGET    — per-raven daily USD cap + spend today.
//   LOG       — recent activity feed across the whole fleet.

// ─── TOOL REGISTRY — every tool a persona can grant/deny ──
// Grouped by provider for the picker; flagged `destructive` for risk UI.
const TOOL_REGISTRY = [
  { id:'read',          group:'fs',        destructive:false, desc:'Read file contents from the session workspace.' },
  { id:'write',         group:'fs',        destructive:true,  desc:'Write / overwrite files in the workspace.' },
  { id:'apply_patch',   group:'fs',        destructive:true,  desc:'Apply unified diff hunks to workspace files.' },
  { id:'glob',          group:'fs',        destructive:false, desc:'Glob-match files by pattern.' },
  { id:'grep',          group:'fs',        destructive:false, desc:'Ripgrep across workspace text.' },
  { id:'bash',          group:'shell',     destructive:true,  desc:'Run shell commands in the session pod. Gated by permission_mode.' },
  { id:'test.run',      group:'shell',     destructive:false, desc:'Invoke the repo\'s declared test runner.' },
  { id:'git.diff',      group:'git',       destructive:false, desc:'Read git diffs for a ref / PR / working tree.' },
  { id:'git.log',       group:'git',       destructive:false, desc:'Read git commit log.' },
  { id:'git.checkout',  group:'git',       destructive:true,  desc:'Switch branches inside the session workspace.' },
  { id:'mimir.search',  group:'mimir',     destructive:false, desc:'Semantic + keyword search over Mímir pages.' },
  { id:'mimir.write',   group:'mimir',     destructive:true,  desc:'Upsert a Mímir page — routed by mimir_write_routing.' },
  { id:'mimir.lint',    group:'mimir',     destructive:false, desc:'Run Mímir\'s structural lint over a page.' },
  { id:'log.query',     group:'observe',   destructive:false, desc:'Query Loki / Vector log store.' },
  { id:'metrics.query', group:'observe',   destructive:false, desc:'Query Prometheus.' },
  { id:'k8s.get',       group:'observe',   destructive:false, desc:'Read-only k8s resource fetch.' },
  { id:'k8s.apply',     group:'observe',   destructive:true,  desc:'Apply a manifest to a cluster. Destructive; needs approval.' },
  { id:'sast.scan',     group:'security',  destructive:false, desc:'Static analysis — Semgrep / CodeQL rules.' },
  { id:'skuld.emit',    group:'bus',       destructive:false, desc:'Emit a Sleipnir event via Skuld.' },
];
const TOOLS_BY_GROUP = (() => {
  const m = {};
  for (const t of TOOL_REGISTRY) (m[t.group] = m[t.group] || []).push(t);
  return m;
})();
const TOOL_BY_ID = Object.fromEntries(TOOL_REGISTRY.map(t=>[t.id,t]));

// ─── FAN-IN STRATEGIES — how multiple producers combine into one composite ──
const FAN_IN_STRATEGIES = [
  { id:'all_must_pass',    label:'all must pass',    desc:'Block on final output until every declared producer reports. Any failure vetos.',
    fields:[{ key:'quorum', type:'none' }, { key:'timeoutSec', type:'number', label:'timeout (sec)', default:900 }] },
  { id:'any_passes',       label:'any passes',       desc:'Accept as soon as one producer returns success. Race semantics.',
    fields:[{ key:'timeoutSec', type:'number', label:'timeout (sec)', default:300 }] },
  { id:'quorum',           label:'quorum',           desc:'Require N-of-M producers to report success within the window.',
    fields:[{ key:'quorum', type:'number', label:'quorum (N)', default:2 }, { key:'timeoutSec', type:'number', label:'timeout (sec)', default:600 }] },
  { id:'merge',            label:'merge',            desc:'Concatenate / union each producer\'s contribution into a composite payload.',
    fields:[{ key:'mergeField', type:'string', label:'contributes_to field', default:'' }] },
  { id:'first_wins',       label:'first wins',       desc:'Take the first producer\'s payload verbatim; discard the rest.',
    fields:[{ key:'timeoutSec', type:'number', label:'timeout (sec)', default:120 }] },
  { id:'weighted_score',   label:'weighted score',   desc:'Each producer returns a numeric score; arbiter averages weighted by persona.',
    fields:[{ key:'weightsRef', type:'string', label:'weights ref', default:'persona.weight' }] },
];
const FAN_IN_BY_ID = Object.fromEntries(FAN_IN_STRATEGIES.map(s=>[s.id,s]));

// ─── EVENT CATALOG — shape of every known event on the bus ──
// Producers/consumers are derived from the persona list (see eventIndex).
const EVENT_CATALOG = {
  'github.pr.opened':     { kind:'ingress', source:'github.webhook',  schema:{ pr:'number', repo:'string', author:'string' }, desc:'GitHub PR opened webhook.' },
  'review.requested':     { kind:'ingress', source:'operator',        schema:{ target:'string', reason:'string' },              desc:'Manual review ask.' },
  'review.verdict':       { kind:'internal',source:null,              schema:{ verdict:'string', score:'number', comments:'array' }, desc:'Per-reviewer outcome. Fan-in to review.final.' },
  'review.final':         { kind:'internal',source:null,              schema:{ decision:'string', rationale:'string' },         desc:'Arbitrated review outcome.' },
  'qa.verdict':           { kind:'internal',source:null,              schema:{ passed:'bool', failures:'array' },               desc:'QA outcome for a change.' },
  'ship.requested':       { kind:'ingress', source:'operator',        schema:{ target:'string' },                               desc:'Operator asked to ship.' },
  'tests.request':        { kind:'internal',source:null,              schema:{ target:'string' },                               desc:'Internal test run ask.' },
  'verify.report':        { kind:'internal',source:null,              schema:{ ok:'bool', notes:'string' },                     desc:'Verifier report.' },
  'coding.requested':     { kind:'ingress', source:'tyr.saga',        schema:{ brief:'string' },                                desc:'Saga asked for coding work.' },
  'planning.requested':   { kind:'ingress', source:'tyr.saga',        schema:{ brief:'string' },                                desc:'Saga asked for a plan.' },
  'plan.drafted':         { kind:'internal',source:null,              schema:{ steps:'array', risks:'array' },                  desc:'Planning output.' },
  'work.completed':       { kind:'internal',source:null,              schema:{ artifacts:'array' },                             desc:'Build-stage work done.' },
  'incident.opened':      { kind:'ingress', source:'alertmanager',    schema:{ id:'string', severity:'string' },                desc:'Alertmanager / PagerDuty incident.' },
  'investigate.requested':{ kind:'ingress', source:'operator',        schema:{ target:'string' },                               desc:'Manual investigation ask.' },
  'incident.report':      { kind:'internal',source:null,              schema:{ root_cause:'string', timeline:'array' },         desc:'Investigator output.' },
  'cron.hourly':          { kind:'cron',    source:'sleipnir.cron',   schema:{},                                                desc:'Hourly tick.' },
  'cron.daily':           { kind:'cron',    source:'sleipnir.cron',   schema:{},                                                desc:'Daily tick (08:00 UTC).' },
  'cron.weekly':          { kind:'cron',    source:'sleipnir.cron',   schema:{},                                                desc:'Weekly tick (Mon 09:00 UTC).' },
  'health.check.requested':{ kind:'ingress',source:'operator',        schema:{ scope:'string' },                                desc:'Manual health probe.' },
  'health.audited':       { kind:'internal',source:null,              schema:{ state:'string', issues:'array' },                desc:'Health audit outcome.' },
  'mimir.ingest.completed':{ kind:'internal',source:null,             schema:{ page:'string' },                                 desc:'Mímir page ingested.' },
  'lint.issues.found':    { kind:'internal',source:null,              schema:{ issues:'array' },                                desc:'Lint sweep found issues.' },
  'mimir.curated':        { kind:'internal',source:null,              schema:{ actions:'array' },                               desc:'Curator actions applied.' },
  'saga.started':         { kind:'internal',source:'tyr',             schema:{ id:'string' },                                   desc:'Týr saga kicked off.' },
  'saga.completed':       { kind:'internal',source:'tyr',             schema:{ id:'string' },                                   desc:'Týr saga done.' },
  'sprint.closed':        { kind:'ingress', source:'linear.webhook',  schema:{ sprint:'string' },                               desc:'Sprint closure from Linear.' },
  'retro.notes':          { kind:'internal',source:null,              schema:{ highlights:'array', actions:'array' },           desc:'Retro output.' },
  'report.requested':     { kind:'ingress', source:'operator',        schema:{ scope:'string' },                                desc:'Manual report ask.' },
  'report.ready':         { kind:'internal',source:null,              schema:{ markdown:'string' },                             desc:'Report output.' },
  'trigger.fired':        { kind:'internal',source:'tyr.trigger',     schema:{ trigger:'string' },                              desc:'Generic trigger fan-out.' },
  'autonomous.progress':  { kind:'internal',source:null,              schema:{ update:'string' },                               desc:'Long-running agent heartbeat.' },
  'skuld.message':        { kind:'gateway', source:'skuld',           schema:{ from:'string', body:'string' },                  desc:'Inbound Skuld (WebSocket/Telegram) message.' },
  'tg.message':           { kind:'gateway', source:'telegram',        schema:{ chat_id:'string', body:'string' },               desc:'Direct Telegram message.' },
  'note.drafted':         { kind:'internal',source:null,              schema:{ markdown:'string' },                             desc:'Draft-a-note output.' },
};
const EVENT_NAMES = Object.keys(EVENT_CATALOG).sort();

// ─── INJECT CATALOG — context bundles a persona can request at dispatch ──
const INJECT_CATALOG = {
  'code.diff':      'Unified diff for the referenced PR / ref.',
  'repo.tree':      'Shallow repo file index (respecting .gitignore).',
  'dep.manifest':   'Resolved dependency manifest (package.json, uv.lock, etc).',
  'pr.meta':        'PR title, body, author, labels, CI status.',
  'brief':          'Operator-provided brief text (from the dispatching trigger).',
  'context':        'Aggregated context bundle — saga description + linked pages.',
  'logs':           'Last N log lines for the referenced target.',
  'metrics':        'Prometheus snapshot — cpu, mem, queue-depth — for the target.',
  'mimir.page':     'Full body of the referenced Mímir page.',
  'mimir.pages':    'Curated multi-page bundle — defined by a mimir collection id.',
  'sessions':       'Historical session transcripts linked to the target.',
  'chronicle':      'Chronicle (raid journal) for the linked raid.',
};

// ─── PERSONAS (PersonaConfig) ────────────────────────────────
// Keep this list aligned with volundr/src/ravn/personas/*.yaml
const PERSONAS = [
  { name:'reviewer',         role:'review',    builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/reviewer.yaml',
    iterationBudget:8, permissionMode:'restricted', allowedTools:['read','grep','glob','git.diff'], forbiddenTools:['write','bash','apply_patch'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:8192 },
    produces:{ event:'review.verdict', schema:{verdict:'string', score:'number', comments:'array'} },
    consumes:{ events:['github.pr.opened','review.requested'], injects:['code.diff','repo.tree'] },
    fanIn:{ strategy:'all_must_pass', contributesTo:'review.final', params:{ timeoutSec:900 } },
    desc:'Careful code reviewer. Blocks on clarity, correctness, tests.' },
  { name:'security-auditor', role:'review',    builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/security_auditor.yaml',
    iterationBudget:10, permissionMode:'restricted', allowedTools:['read','grep','glob','sast.scan'], forbiddenTools:['write','bash'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:12288 },
    produces:{ event:'review.verdict', schema:{findings:'string', severity:'string'} },
    consumes:{ events:['github.pr.opened','review.requested'], injects:['code.diff','dep.manifest'] },
    fanIn:{ strategy:'all_must_pass', contributesTo:'review.final', params:{ timeoutSec:900 } },
    desc:'Sweeps PRs for vulnerabilities — auth, injection, secrets.' },
  { name:'review-arbiter',   role:'arbiter',   builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/review_arbiter.yaml',
    iterationBudget:4, permissionMode:'restricted', allowedTools:['read'], forbiddenTools:['write','bash','apply_patch'],
    llm:{ alias:'sonnet-primary', thinking:false, maxTokens:4096 },
    produces:{ event:'review.final', schema:{decision:'string', rationale:'string'} },
    consumes:{ events:['review.verdict'], injects:['pr.meta'] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'comments' } },
    desc:'Merges reviewer + security-auditor verdicts into a final call.' },
  { name:'qa-agent',         role:'qa',        builtin:true,  hasOverride:true,
    source:'volundr/src/ravn/personas/qa_agent.yaml',
    override:'~/.config/niuu/personas/qa_agent.override.yaml',
    iterationBudget:12, permissionMode:'normal', allowedTools:['read','bash','test.run','grep'], forbiddenTools:['apply_patch'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:8192 },
    produces:{ event:'qa.verdict', schema:{passed:'bool', failures:'array'} },
    consumes:{ events:['ship.requested','tests.request'], injects:['repo.tree'] },
    fanIn:{ strategy:'all_must_pass', contributesTo:'', params:{ timeoutSec:1800 } },
    desc:'Runs test suites, reports pass/fail with details.' },
  { name:'verifier',         role:'qa',        builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/verifier.yaml',
    iterationBudget:6, permissionMode:'restricted', allowedTools:['read','grep','glob'], forbiddenTools:['write','bash'],
    llm:{ alias:'haiku-primary', thinking:false, maxTokens:3072 },
    produces:{ event:'verify.report', schema:{ok:'bool', notes:'string'} },
    consumes:{ events:['work.completed'], injects:[] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'notes' } },
    desc:'Light-touch sanity check over completed work.' },
  { name:'coder',            role:'build',     builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/coder.yaml',
    iterationBudget:30, permissionMode:'normal', allowedTools:['read','write','bash','apply_patch','grep'], forbiddenTools:[],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:16384 },
    produces:{ event:'work.completed', schema:{artifacts:'array'} },
    consumes:{ events:['coding.requested','ship.requested'], injects:['repo.tree','brief'] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'artifacts' } },
    desc:'Ships code. Writes, edits, applies patches.' },
  { name:'architect',        role:'plan',      builtin:true,  hasOverride:true,
    source:'volundr/src/ravn/personas/architect.yaml',
    override:'~/.config/niuu/personas/architect.override.yaml',
    iterationBudget:12, permissionMode:'restricted', allowedTools:['read','grep','glob'], forbiddenTools:['write','bash','apply_patch'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:16384 },
    produces:{ event:'plan.drafted', schema:{steps:'array', risks:'array'} },
    consumes:{ events:['planning.requested'], injects:['repo.tree','context'] },
    fanIn:{ strategy:'first_wins', contributesTo:'', params:{ timeoutSec:240 } },
    desc:'Designs approach; emits step-by-step plans.' },
  { name:'planning-agent',   role:'plan',      builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/planning_agent.yaml',
    iterationBudget:8, permissionMode:'normal', allowedTools:['read','grep','glob'], forbiddenTools:[],
    llm:{ alias:'sonnet-primary', thinking:false, maxTokens:8192 },
    produces:{ event:'plan.drafted', schema:{steps:'array'} },
    consumes:{ events:['planning.requested'], injects:[] },
    fanIn:{ strategy:'first_wins', contributesTo:'', params:{ timeoutSec:240 } },
    desc:'Quick planner for small jobs.' },
  { name:'investigator',     role:'investigate', builtin:true, hasOverride:false,
    source:'volundr/src/ravn/personas/investigator.yaml',
    iterationBudget:20, permissionMode:'restricted', allowedTools:['read','grep','glob','log.query','mimir.search'], forbiddenTools:['write','bash'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:12288 },
    produces:{ event:'incident.report', schema:{root_cause:'string', timeline:'array'} },
    consumes:{ events:['incident.opened','investigate.requested'], injects:['logs','metrics'] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'timeline' } },
    desc:'Root-cause analysis across logs, metrics, Mímir.' },
  { name:'health-auditor',   role:'observe',   builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/health_auditor.yaml',
    iterationBudget:6, permissionMode:'restricted', allowedTools:['read','metrics.query','k8s.get'], forbiddenTools:['write','bash'],
    llm:{ alias:'haiku-primary', thinking:false, maxTokens:2048 },
    produces:{ event:'health.audited', schema:{state:'string', issues:'array'} },
    consumes:{ events:['cron.hourly','health.check.requested'], injects:[] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'issues' } },
    desc:'Probes cluster health; reports state hourly.' },
  { name:'mimir-curator',    role:'knowledge', builtin:true,  hasOverride:true,
    source:'volundr/src/ravn/personas/mimir_curator.yaml',
    override:'~/.config/niuu/personas/mimir_curator.override.yaml',
    iterationBudget:14, permissionMode:'normal', allowedTools:['read','mimir.search','mimir.write','mimir.lint'], forbiddenTools:['bash'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:10240 },
    produces:{ event:'mimir.curated', schema:{actions:'array'} },
    consumes:{ events:['mimir.ingest.completed','lint.issues.found'], injects:['mimir.page'] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'actions' } },
    desc:'Keeps Mímir tidy — dedupes, normalises, cross-links.' },
  { name:'coordinator',      role:'coord',     builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/coordinator.yaml',
    iterationBudget:10, permissionMode:'normal', allowedTools:['read','mimir.search','skuld.emit'], forbiddenTools:['bash','apply_patch'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:6144 },
    produces:{ event:'raid.dispatched', schema:{targets:'array'} },
    consumes:{ events:['saga.started'], injects:[] },
    fanIn:{ strategy:'first_wins', contributesTo:'', params:{ timeoutSec:60 } },
    desc:'Dispatches ravens into raids; watches the swarm.' },
  { name:'autonomous-agent', role:'autonomy',  builtin:true,  hasOverride:true,
    source:'volundr/src/ravn/personas/autonomous_agent.yaml',
    override:'~/.config/niuu/personas/autonomous_agent.override.yaml',
    iterationBudget:40, permissionMode:'normal', allowedTools:['read','write','bash','apply_patch','mimir.search','mimir.write'], forbiddenTools:[],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:16384 },
    produces:{ event:'autonomous.progress', schema:{update:'string'} },
    consumes:{ events:['cron.daily','trigger.fired'], injects:['brief'] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'update' } },
    desc:'Long-running free agent; drives its own queue.' },
  { name:'reporter',         role:'report',    builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/reporter.yaml',
    iterationBudget:6, permissionMode:'restricted', allowedTools:['read','mimir.search'], forbiddenTools:['write','bash'],
    llm:{ alias:'haiku-primary', thinking:false, maxTokens:4096 },
    produces:{ event:'report.ready', schema:{markdown:'string'} },
    consumes:{ events:['report.requested','cron.weekly'], injects:['mimir.pages'] },
    fanIn:{ strategy:'first_wins', contributesTo:'', params:{ timeoutSec:300 } },
    desc:'Weekly/ad-hoc reports with sources cited.' },
  { name:'retro-analyst',    role:'observe',   builtin:true,  hasOverride:false,
    source:'volundr/src/ravn/personas/retro_analyst.yaml',
    iterationBudget:10, permissionMode:'restricted', allowedTools:['read','mimir.search','log.query'], forbiddenTools:['write','bash'],
    llm:{ alias:'sonnet-primary', thinking:true, maxTokens:8192 },
    produces:{ event:'retro.notes', schema:{highlights:'array', actions:'array'} },
    consumes:{ events:['saga.completed','sprint.closed'], injects:['sessions','chronicle'] },
    fanIn:{ strategy:'merge', contributesTo:'', params:{ mergeField:'highlights' } },
    desc:'Post-mortem of sagas — what worked, what didn\'t.' },
  { name:'draft-a-note',     role:'write',     builtin:false, hasOverride:true,
    source:'~/.config/niuu/personas/draft_a_note.yaml',
    iterationBudget:4, permissionMode:'restricted', allowedTools:['read','mimir.search','mimir.write'], forbiddenTools:['bash'],
    llm:{ alias:'haiku-primary', thinking:false, maxTokens:2048 },
    produces:{ event:'note.drafted', schema:{markdown:'string'} },
    consumes:{ events:['skuld.message','tg.message'], injects:[] },
    fanIn:{ strategy:'first_wins', contributesTo:'', params:{ timeoutSec:120 } },
    desc:'Quick-note drafter — pulls from Mímir, writes clean prose.' },
];

const PERSONA_BY_NAME = Object.fromEntries(PERSONAS.map(p=>[p.name,p]));

// ─── YAML sources (rendered into editor for known personas) ──
// A couple of full examples — the editor renders a fallback when missing.
const PERSONA_YAML = {
  reviewer: `name: reviewer
description: Careful code reviewer
system_prompt_template: |
  ## Identity
  You are a code reviewer. Block on clarity, correctness and tests.

  ## Context
  {{code.diff}}
  {{repo.tree}}

  ## Output
  Emit review.verdict with verdict, score, comments.

allowed_tools: [read, grep, glob, git.diff]
forbidden_tools: [write, bash, apply_patch]
permission_mode: restricted
iteration_budget: 8

llm:
  primary_alias: sonnet-primary
  thinking_enabled: true
  max_tokens: 8192

produces:
  event_type: review.verdict
  schema:
    verdict: string
    score: number
    comments: array

consumes:
  event_types: [github.pr.opened, review.requested]
  injects: [code.diff, repo.tree]

fan_in:
  strategy: all_must_pass
  contributes_to: review.verdict
`,
  'autonomous-agent': `name: autonomous-agent
description: Long-running free agent
system_prompt_template: |
  ## Identity
  You drive your own work queue. Pull next from Mímir initiative:today.

  {{brief}}

allowed_tools: [read, write, bash, apply_patch, mimir.search, mimir.write]
forbidden_tools: []
permission_mode: normal
iteration_budget: 40

llm:
  primary_alias: sonnet-primary
  thinking_enabled: true
  max_tokens: 16384

produces:
  event_type: autonomous.progress

consumes:
  event_types: [cron.daily, trigger.fired]
  injects: [brief]

fan_in:
  strategy: merge
`,
};

// ─── RAVENS (RavnProfile) ────────────────────────────────────
const RAVENS = [
  { id:'muninn',  name:'muninn',  rune:'ᚱ', persona:'mimir-curator',  location:'gimle',     deployment:'k8s',      state:'active',
    cascadeMode:'networked', checkpointEnabled:true, checkpointStrategy:'on_milestone',
    mcpServers:['mimir','fs','git'], gatewayChannels:['skuld','telegram'], sleipnirTopics:['mimir.*','lint.*'], outputMode:'ambient',
    mimirMounts:[{name:'niuu-core', role:'primary', priority:10}, {name:'asgard-ops', role:'archive', priority:20}],
    mimirWriteRouting:{'observations':'niuu-core','drafts':'niuu-core','incidents':'asgard-ops'},
    triggers:['daily-curate','lint-sweep'], specialisations:['curation','knowledge'],
    budget:{ capUsd:2.0, spentUsd:1.42, warnAt:80 },
    lastActivity:'2m ago', openSessions:3, totalSessions:284 },
  { id:'huginn',  name:'huginn',  rune:'ᚱ', persona:'investigator',   location:'valhalla',  deployment:'k8s',      state:'active',
    cascadeMode:'networked', checkpointEnabled:true, checkpointStrategy:'on_destructive',
    mcpServers:['mimir','log','metrics','k8s'], gatewayChannels:['skuld'], sleipnirTopics:['incident.*','alert.*'], outputMode:'surface',
    mimirMounts:[{name:'niuu-core', role:'primary', priority:10}, {name:'incident-archive', role:'archive', priority:20}],
    mimirWriteRouting:{'incidents':'incident-archive','findings':'niuu-core'},
    triggers:['incident-watch'], specialisations:['incidents','rca'],
    budget:{ capUsd:3.0, spentUsd:0.34, warnAt:80 },
    lastActivity:'14m ago', openSessions:1, totalSessions:96 },
  { id:'fjolnir', name:'fjölnir', rune:'ᚱ', persona:'reviewer',       location:'valaskjalf',deployment:'k8s',      state:'active',
    cascadeMode:'local', checkpointEnabled:false, checkpointStrategy:'on_milestone',
    mcpServers:['github','mimir'], gatewayChannels:['skuld'], sleipnirTopics:['review.*','github.*'], outputMode:'ambient',
    mimirMounts:[{name:'niuu-core', role:'read-only', priority:10}],
    mimirWriteRouting:{},
    triggers:['pr-review'], specialisations:['review','quality'],
    budget:{ capUsd:1.5, spentUsd:0.88, warnAt:80 },
    lastActivity:'just now', openSessions:2, totalSessions:412 },
  { id:'saga',    name:'saga',    rune:'ᚱ', persona:'retro-analyst',  location:'gimle',     deployment:'k8s',      state:'idle',
    cascadeMode:'local', checkpointEnabled:true, checkpointStrategy:'on_milestone',
    mcpServers:['mimir','log'], gatewayChannels:['skuld'], sleipnirTopics:['saga.*','sprint.*'], outputMode:'ambient',
    mimirMounts:[{name:'niuu-core', role:'primary', priority:10}, {name:'chronicle', role:'archive', priority:20}],
    mimirWriteRouting:{'retros':'chronicle'},
    triggers:['sprint-retro'], specialisations:['retrospection','chronicle'],
    budget:{ capUsd:1.0, spentUsd:0.02, warnAt:80 },
    lastActivity:'3h ago', openSessions:0, totalSessions:47 },
  { id:'sindri',  name:'sindri',  rune:'ᚱ', persona:'coder',          location:'eitri',     deployment:'ephemeral',state:'active',
    cascadeMode:'local', checkpointEnabled:true, checkpointStrategy:'on_every_n_tools',
    mcpServers:['fs','git','bash'], gatewayChannels:[], sleipnirTopics:['forge.*'], outputMode:'silent',
    mimirMounts:[{name:'niuu-core', role:'read-only', priority:10}],
    mimirWriteRouting:{},
    triggers:[], specialisations:['coding','forge'],
    budget:{ capUsd:5.0, spentUsd:3.61, warnAt:80 },
    lastActivity:'1m ago', openSessions:1, totalSessions:168 },
  { id:'eir',     name:'eir',     rune:'ᚱ', persona:'health-auditor', location:'valhalla',  deployment:'systemd',  state:'active',
    cascadeMode:'local', checkpointEnabled:false, checkpointStrategy:'on_milestone',
    mcpServers:['metrics','k8s'], gatewayChannels:[], sleipnirTopics:['health.*'], outputMode:'silent',
    mimirMounts:[{name:'niuu-core', role:'read-only', priority:10}],
    mimirWriteRouting:{},
    triggers:['hourly-probe'], specialisations:['health','metrics'],
    budget:{ capUsd:0.25, spentUsd:0.04, warnAt:80 },
    lastActivity:'6m ago', openSessions:0, totalSessions:1827 },
  { id:'vor',     name:'vör',     rune:'ᚱ', persona:'mimir-curator',  location:'gimle',     deployment:'k8s',      state:'idle',
    cascadeMode:'local', checkpointEnabled:true, checkpointStrategy:'on_milestone',
    mcpServers:['mimir'], gatewayChannels:['skuld'], sleipnirTopics:['lint.*'], outputMode:'ambient',
    mimirMounts:[{name:'niuu-core', role:'primary', priority:10}],
    mimirWriteRouting:{'lint':'niuu-core'},
    triggers:['lint-sweep'], specialisations:['lint','sweep'],
    budget:{ capUsd:0.5, spentUsd:0.00, warnAt:80 },
    lastActivity:'21h ago', openSessions:0, totalSessions:34 },
  { id:'ratatoskr',name:'ratatoskr',rune:'ᚱ',persona:'draft-a-note', location:'iphone',     deployment:'mobile',   state:'suspended',
    cascadeMode:'ephemeral', checkpointEnabled:false, checkpointStrategy:'on_milestone',
    mcpServers:['mimir'], gatewayChannels:['telegram','skuld'], sleipnirTopics:['tg.message'], outputMode:'ambient',
    mimirMounts:[{name:'niuu-core', role:'read-only', priority:10}],
    mimirWriteRouting:{},
    triggers:['tg-listener'], specialisations:['draft','mobile'],
    budget:{ capUsd:0.20, spentUsd:0.00, warnAt:80 },
    lastActivity:'yesterday', openSessions:0, totalSessions:12 },
  { id:'bragi',   name:'bragi',   rune:'ᚱ', persona:'reporter',       location:'gimle',     deployment:'k8s',      state:'idle',
    cascadeMode:'local', checkpointEnabled:false, checkpointStrategy:'on_milestone',
    mcpServers:['mimir'], gatewayChannels:['skuld'], sleipnirTopics:['report.*'], outputMode:'surface',
    mimirMounts:[{name:'niuu-core', role:'primary', priority:10}, {name:'chronicle', role:'archive', priority:20}],
    mimirWriteRouting:{'reports':'chronicle'},
    triggers:['weekly-report'], specialisations:['report','weekly'],
    budget:{ capUsd:0.75, spentUsd:0.18, warnAt:80 },
    lastActivity:'2d ago', openSessions:0, totalSessions:18 },
  { id:'forseti', name:'forseti', rune:'ᚱ', persona:'review-arbiter', location:'valaskjalf',deployment:'k8s',      state:'active',
    cascadeMode:'local', checkpointEnabled:false, checkpointStrategy:'on_milestone',
    mcpServers:['github','mimir'], gatewayChannels:['skuld'], sleipnirTopics:['review.*'], outputMode:'ambient',
    mimirMounts:[{name:'niuu-core', role:'read-only', priority:10}],
    mimirWriteRouting:{},
    triggers:['pr-review'], specialisations:['arbitration'],
    budget:{ capUsd:0.5, spentUsd:0.11, warnAt:80 },
    lastActivity:'4m ago', openSessions:1, totalSessions:205 },
  { id:'gefjon',  name:'gefjon',  rune:'ᚱ', persona:'security-auditor',location:'valaskjalf',deployment:'k8s',     state:'active',
    cascadeMode:'local', checkpointEnabled:false, checkpointStrategy:'on_milestone',
    mcpServers:['github','sast'], gatewayChannels:['skuld'], sleipnirTopics:['security.*','github.*'], outputMode:'ambient',
    mimirMounts:[{name:'niuu-core', role:'read-only', priority:10}],
    mimirWriteRouting:{},
    triggers:['pr-review','security-scan'], specialisations:['security'],
    budget:{ capUsd:2.0, spentUsd:0.91, warnAt:80 },
    lastActivity:'7m ago', openSessions:1, totalSessions:152 },
  { id:'vidar',   name:'víðar',   rune:'ᚱ', persona:'autonomous-agent',location:'sindri',    deployment:'systemd',  state:'active',
    cascadeMode:'networked', checkpointEnabled:true, checkpointStrategy:'on_destructive',
    mcpServers:['fs','git','bash','mimir'], gatewayChannels:['skuld'], sleipnirTopics:['autonomous.*'], outputMode:'surface',
    mimirMounts:[{name:'niuu-core', role:'primary', priority:10}],
    mimirWriteRouting:{'observations':'niuu-core'},
    triggers:['daily-autonomous'], specialisations:['long-running'],
    budget:{ capUsd:4.0, spentUsd:2.83, warnAt:80 },
    lastActivity:'just now', openSessions:1, totalSessions:64 },
];

const RAVEN_BY_ID = Object.fromEntries(RAVENS.map(r=>[r.id,r]));

// ─── LOCATIONS & DEPLOYMENTS (lookup for badges) ──
const LOCATIONS = [
  { id:'gimle',      realm:'asgard',   kind:'cluster' },
  { id:'valhalla',   realm:'asgard',   kind:'cluster' },
  { id:'valaskjalf', realm:'asgard',   kind:'cluster' },
  { id:'eitri',      realm:'svartalfheim', kind:'cluster' },
  { id:'sindri',     realm:'svartalfheim', kind:'host' },
  { id:'iphone',     realm:'midgard',  kind:'mobile' },
];

// ─── SESSIONS (live chat threads) ──
const SESSIONS = [
  { id:'s-421', ravnId:'huginn', title:'Incident 2381 — write amplification spike', state:'active',
    startedAt:'2026-04-17T14:02:00Z', lastAt:'2026-04-17T14:27:00Z', messageCount:28, tokenCount:18420, costUsd:0.21,
    triggerId:'incident-watch', summary:'Root-causing mimir write spike on niuu-core mount.' },
  { id:'s-420', ravnId:'muninn', title:'Curate: projects/niuu/architecture.md', state:'active',
    startedAt:'2026-04-17T14:18:00Z', lastAt:'2026-04-17T14:26:00Z', messageCount:11, tokenCount:6210, costUsd:0.08,
    triggerId:'daily-curate', summary:'Normalising heading hierarchy + adding cross-links.' },
  { id:'s-419', ravnId:'fjolnir', title:'PR #884 — tyr.saga validator refactor', state:'active',
    startedAt:'2026-04-17T14:12:00Z', lastAt:'2026-04-17T14:25:30Z', messageCount:16, tokenCount:12105, costUsd:0.14,
    triggerId:'pr-review', summary:'Review in progress — 3 comments drafted.' },
  { id:'s-418', ravnId:'sindri', title:'Forge: apply patch series to volundr/tyr', state:'active',
    startedAt:'2026-04-17T14:05:00Z', lastAt:'2026-04-17T14:25:00Z', messageCount:42, tokenCount:32480, costUsd:0.61,
    triggerId:null, summary:'Building arbiter composite + tests.' },
  { id:'s-417', ravnId:'forseti', title:'Arbitrate PR #884 — reviewer + security verdicts', state:'active',
    startedAt:'2026-04-17T14:24:00Z', lastAt:'2026-04-17T14:25:00Z', messageCount:4, tokenCount:1820, costUsd:0.02,
    triggerId:'pr-review', summary:'Waiting on gefjon for security verdict.' },
  { id:'s-416', ravnId:'gefjon', title:'Security sweep PR #884', state:'active',
    startedAt:'2026-04-17T14:15:00Z', lastAt:'2026-04-17T14:24:30Z', messageCount:9, tokenCount:5820, costUsd:0.09,
    triggerId:'pr-review', summary:'Scanning diff — nothing flagged so far.' },
  { id:'s-415', ravnId:'muninn', title:'Normalise: projects/niuu/style.md', state:'completed',
    startedAt:'2026-04-17T13:50:00Z', lastAt:'2026-04-17T14:02:00Z', messageCount:8, tokenCount:4210, costUsd:0.05,
    triggerId:'daily-curate', summary:'Merged fragments — 6 edits applied.' },
  { id:'s-414', ravnId:'vidar',  title:'Autonomous: drain incident backlog', state:'active',
    startedAt:'2026-04-17T13:10:00Z', lastAt:'2026-04-17T14:27:00Z', messageCount:64, tokenCount:52840, costUsd:0.88,
    triggerId:'daily-autonomous', summary:'Processing 11 incidents — 4 closed, 7 pending data.' },
  { id:'s-413', ravnId:'eir',    title:'Hourly probe · asgard', state:'completed',
    startedAt:'2026-04-17T14:00:00Z', lastAt:'2026-04-17T14:00:44Z', messageCount:2, tokenCount:412, costUsd:0.001,
    triggerId:'hourly-probe', summary:'All clusters healthy.' },
  { id:'s-412', ravnId:'bragi',  title:'Weekly report: 2026-w15', state:'completed',
    startedAt:'2026-04-14T09:00:00Z', lastAt:'2026-04-14T09:14:00Z', messageCount:21, tokenCount:22410, costUsd:0.28,
    triggerId:'weekly-report', summary:'Delivered report, filed to chronicle.' },
  { id:'s-411', ravnId:'sindri', title:'Forge: ravn settings schema v3', state:'failed',
    startedAt:'2026-04-16T22:10:00Z', lastAt:'2026-04-16T22:41:00Z', messageCount:38, tokenCount:41230, costUsd:0.74,
    triggerId:null, summary:'Budget exceeded — hit daily cap.' },
];

// ─── SESSION MESSAGES — a richer transcript for one active session ──
const SESSION_MESSAGES = {
  's-419': [
    { kind:'system',    ts:'14:12:00', body:'trigger=pr-review pr=884 repo=niuulabs/volundr' },
    { kind:'user',      ts:'14:12:01', body:'Review PR #884 — refactor saga validator. Load diff and apply reviewer persona.' },
    { kind:'thought',   ts:'14:12:03', body:'Pulling diff + repo tree. Persona=reviewer. Will emit review.verdict.' },
    { kind:'tool',      ts:'14:12:04', name:'git.diff', args:'{pr: 884}', result:'+421 −312 across 11 files' },
    { kind:'tool',      ts:'14:12:06', name:'read', args:'src/tyr/domain/saga.py', result:'ok (+162 -34)' },
    { kind:'assistant', ts:'14:12:18', body:'Initial pass — 3 issues found:\n1. `_is_pipeline` now mis-detects templates with a single stage; add explicit length check.\n2. Event dedupe key drops the realm prefix — could collide across realms.\n3. Tests cover `review` and `ship` but not `investigate`; add at least a smoke test.' },
    { kind:'tool',      ts:'14:12:20', name:'grep', args:'"_is_pipeline" src/tyr', result:'3 matches' },
    { kind:'thought',   ts:'14:12:22', body:'All three issues reproduce in the tests directory. Drafting final verdict.' },
    { kind:'emit',      ts:'14:25:30', body:'review.verdict', attrs:{ verdict:'changes_requested', score:0.72 } },
  ],
};

// ─── TRIGGERS / INITIATIVES ──
const TRIGGERS = [
  { id:'daily-curate',       kind:'cron',      schedule:'0 9 * * *',    ravens:['muninn','vor'], producesEvent:'mimir.ingest.completed',
    description:'Curate yesterday\'s observations + dedupe Mímir pages.', lastFired:'2026-04-17T09:00:00Z', enabled:true },
  { id:'pr-review',          kind:'event',     topic:'github.pr.opened', ravens:['fjolnir','gefjon','forseti'], producesEvent:null,
    description:'Fan out reviewer + security + arbiter on every opened PR.', lastFired:'2026-04-17T14:11:00Z', enabled:true },
  { id:'hourly-probe',       kind:'cron',      schedule:'0 * * * *',    ravens:['eir'], producesEvent:'health.audited',
    description:'Probe cluster health every hour.', lastFired:'2026-04-17T14:00:00Z', enabled:true },
  { id:'incident-watch',     kind:'event',     topic:'incident.opened',  ravens:['huginn'], producesEvent:null,
    description:'Auto-investigate when an incident opens.', lastFired:'2026-04-17T11:22:00Z', enabled:true },
  { id:'weekly-report',      kind:'cron',      schedule:'0 9 * * 1',    ravens:['bragi'], producesEvent:'report.ready',
    description:'Weekly Monday-morning summary.', lastFired:'2026-04-14T09:00:00Z', enabled:true },
  { id:'sprint-retro',       kind:'event',     topic:'sprint.closed',    ravens:['saga'], producesEvent:'retro.notes',
    description:'Retro at sprint close.', lastFired:'2026-04-11T17:02:00Z', enabled:true },
  { id:'lint-sweep',         kind:'cron',      schedule:'0 3 * * *',    ravens:['vor','muninn'], producesEvent:'lint.issues.found',
    description:'Nightly Mímir lint pass.', lastFired:'2026-04-17T03:00:00Z', enabled:true },
  { id:'tg-listener',        kind:'gateway',   topic:'telegram.msg',     ravens:['ratatoskr'], producesEvent:null,
    description:'Listen for Telegram messages tagged #niuu.', lastFired:'2026-04-16T22:41:00Z', enabled:false },
  { id:'daily-autonomous',   kind:'cron',      schedule:'0 8 * * *',    ravens:['vidar'], producesEvent:'autonomous.progress',
    description:'Drain yesterday\'s backlog.', lastFired:'2026-04-17T08:00:00Z', enabled:true },
  { id:'security-scan',      kind:'cron',      schedule:'0 2 * * *',    ravens:['gefjon'], producesEvent:null,
    description:'Scheduled deep security scan.', lastFired:'2026-04-17T02:00:00Z', enabled:true },
];

// ─── LOG feed (activity tail) ──
const LOG = [
  { ts:'14:27:12', ravnId:'vidar',   kind:'iter',   body:'iter 18 — processed incident-2384; 2 more in queue.', costUsd:0.012 },
  { ts:'14:27:03', ravnId:'sindri',  kind:'tool',   body:'apply_patch · volundr/tyr/saga.py — 3 hunks applied.' },
  { ts:'14:26:48', ravnId:'huginn',  kind:'emit',   body:'incident.report · root_cause=write-spike' },
  { ts:'14:26:31', ravnId:'muninn',  kind:'tool',   body:'mimir.write · projects/niuu/architecture.md (+3 sections)' },
  { ts:'14:25:50', ravnId:'fjolnir', kind:'emit',   body:'review.verdict · changes_requested (0.72)' },
  { ts:'14:25:30', ravnId:'sindri',  kind:'iter',   body:'iter 42 — tests green locally.' },
  { ts:'14:24:12', ravnId:'gefjon',  kind:'tool',   body:'sast.scan · no high-severity findings' },
  { ts:'14:22:02', ravnId:'forseti', kind:'wait',   body:'fan-in waiting on gefjon (1 of 2 verdicts received)' },
  { ts:'14:20:00', ravnId:'vidar',   kind:'budget', body:'budget warn — 70% of $4.00 cap consumed today.' },
  { ts:'14:18:10', ravnId:'muninn',  kind:'iter',   body:'iter 3 — drafting curator notes.' },
  { ts:'14:14:20', ravnId:'eir',     kind:'emit',   body:'health.audited · all clusters green' },
  { ts:'14:11:22', ravnId:'fjolnir', kind:'trigger',body:'pr-review fired · github.pr.opened#884' },
  { ts:'14:11:22', ravnId:'gefjon',  kind:'trigger',body:'pr-review fired · github.pr.opened#884' },
  { ts:'14:11:22', ravnId:'forseti', kind:'trigger',body:'pr-review fired · github.pr.opened#884' },
  { ts:'14:02:41', ravnId:'huginn',  kind:'iter',   body:'iter 1 — loading incident 2381 context.' },
  { ts:'14:00:44', ravnId:'eir',     kind:'done',   body:'hourly-probe completed · 44s · $0.001' },
  { ts:'13:58:09', ravnId:'ratatoskr', kind:'suspend', body:'raven suspended (mobile idle).' },
  { ts:'13:51:30', ravnId:'saga',    kind:'idle',   body:'no sprint events — standing by.' },
];

// ─── BUDGET TIMESERIES (hourly spend for fleet + per-raven) ──
function _randWalk(n, mean, vol, seed=1) {
  let v = mean * (0.4 + (seed%5)/10);
  const out = [];
  for (let i=0;i<n;i++) {
    v += (Math.sin(i*0.73 + seed) * vol);
    v = Math.max(0, v);
    out.push(+v.toFixed(3));
  }
  return out;
}
// last 24h, hourly, USD per raven
const BUDGET_HOURLY = Object.fromEntries(RAVENS.map((r,i)=>[
  r.id,
  _randWalk(24, r.budget.spentUsd/24, Math.max(0.004, r.budget.capUsd/240), i+1)
]));

// ─── EVENTS (produces/consumes graph) ──
// Collect unique event names, index by producers/consumers.
function eventIndex() {
  const produced = {}, consumed = {};
  for (const p of PERSONAS) {
    const ev = p.produces?.event;
    if (ev) (produced[ev] = produced[ev] || []).push(p.name);
    for (const ev of (p.consumes?.events || [])) {
      (consumed[ev] = consumed[ev] || []).push(p.name);
    }
  }
  const names = Array.from(new Set([...Object.keys(produced), ...Object.keys(consumed)])).sort();
  return names.map(name => ({
    name,
    producers: produced[name] || [],
    consumers: consumed[name] || [],
    // classify: external (has consumers but no producers) = ingress; orphan (producers but no consumers) = terminal
    kind: (produced[name]?.length ? 0 : 2) + (consumed[name]?.length ? 1 : 0), // 0=orphan, 1=ingress, 2=produced-only, 3=linked
  }));
}

const EVENTS = eventIndex();

// ─── PERSONA SOURCE ROOTS — where the loader looks, in order ──
// (Mirrors volundr/src/ravn/loader.py discovery order.)
const PERSONA_SOURCES = [
  { id:'builtin',   path:'volundr/src/ravn/personas/',            kind:'builtin',
    desc:'Shipped with the Volundr repo. Read-only; override via the user dir.' },
  { id:'user',      path:'~/.config/niuu/personas/',             kind:'user',
    desc:'User-owned personas. Anything here shadows the builtin of the same name.' },
  { id:'workspace', path:'$REPO/.niuu/personas/',                kind:'workspace',
    desc:'Optional per-repo personas picked up when a session mounts that workspace.' },
];

// ─── Expose ──
window.RAVN_DATA = {
  PERSONAS, PERSONA_BY_NAME, PERSONA_YAML, PERSONA_SOURCES,
  TOOL_REGISTRY, TOOLS_BY_GROUP, TOOL_BY_ID,
  FAN_IN_STRATEGIES, FAN_IN_BY_ID,
  EVENT_CATALOG, EVENT_NAMES, INJECT_CATALOG,
  RAVENS, RAVEN_BY_ID, LOCATIONS,
  SESSIONS, SESSION_MESSAGES,
  TRIGGERS, LOG, BUDGET_HOURLY, EVENTS,
};
