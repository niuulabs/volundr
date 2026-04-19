/**
 * Ravn — mock adapter.
 *
 * Seeded from the 21 builtin personas in web/src/modules/ravn/api/mockData.ts
 * plus a small fleet of mock ravens, sessions, triggers, and budget data.
 * All methods resolve immediately (no artificial delay) to keep tests fast.
 */

import type { BudgetState } from '@niuulabs/domain';
import type {
  PersonaSummary,
  PersonaDetail,
  PersonaCreateRequest,
  PersonaForkRequest,
  PersonaFilter,
  Raven,
  Session,
  Message,
  Trigger,
  TriggerInput,
} from '../domain';
import type {
  IPersonaStore,
  IRavenStream,
  ISessionStream,
  ITriggerStore,
  IBudgetStream,
  IRavnService,
} from '../ports';

// ---------------------------------------------------------------------------
// Seed — personas (mirroring web/src/modules/ravn/api/mockData.ts)
// ---------------------------------------------------------------------------

const SEED_PERSONAS: PersonaSummary[] = [
  {
    name: 'architect',
    permissionMode: 'read-only',
    allowedTools: ['file', 'web', 'mimir', 'ravn'],
    iterationBudget: 25,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'autonomous-agent',
    permissionMode: 'full-access',
    allowedTools: [],
    iterationBudget: 100,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'coder',
    permissionMode: 'workspace_write',
    allowedTools: ['file', 'git', 'terminal', 'ravn'],
    iterationBudget: 40,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'code.changed',
    consumesEvents: [
      'review.changes_requested',
      'security.changes_requested',
      'code.requested',
      'bug.fix.requested',
      'feature.requested',
    ],
  },
  {
    name: 'coding-agent',
    permissionMode: 'workspace-write',
    allowedTools: ['mimir_query', 'file', 'git', 'terminal', 'web', 'todo', 'ravn'],
    iterationBudget: 40,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'code.changed',
    consumesEvents: ['code.requested', 'bug.fix.requested', 'feature.requested'],
  },
  {
    name: 'coordinator',
    permissionMode: 'workspace-write',
    allowedTools: ['cascade', 'file', 'ravn', 'todo'],
    iterationBudget: 30,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'draft-a-note',
    permissionMode: 'read-only',
    allowedTools: ['file', 'web', 'mimir', 'ravn'],
    iterationBudget: 15,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'health-auditor',
    permissionMode: 'read-only',
    allowedTools: ['file', 'terminal', 'web', 'ravn'],
    iterationBudget: 20,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'health.completed',
    consumesEvents: ['health.check.requested', 'cron.hourly'],
  },
  {
    name: 'investigator',
    permissionMode: 'workspace-write',
    allowedTools: ['file', 'git', 'terminal', 'web', 'ravn'],
    iterationBudget: 40,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'investigation.completed',
    consumesEvents: ['bug.reported', 'incident.opened', 'qa.failed'],
  },
  {
    name: 'mimir-curator',
    permissionMode: 'read-only',
    allowedTools: ['file', 'mimir', 'ravn'],
    iterationBudget: 20,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'office-hours',
    permissionMode: 'read-only',
    allowedTools: ['file', 'web', 'mimir', 'ravn'],
    iterationBudget: 20,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'planning-agent',
    permissionMode: 'read-only',
    allowedTools: ['file', 'web', 'mimir', 'ravn', 'todo'],
    iterationBudget: 25,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'produce-recap',
    permissionMode: 'read-only',
    allowedTools: ['file', 'mimir', 'ravn'],
    iterationBudget: 15,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'qa-agent',
    permissionMode: 'workspace-write',
    allowedTools: ['file', 'git', 'terminal', 'ravn'],
    iterationBudget: 30,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'qa.completed',
    consumesEvents: ['review.completed', 'test.requested'],
  },
  {
    name: 'research-agent',
    permissionMode: 'read-only',
    allowedTools: ['mimir_query', 'web', 'file', 'ravn'],
    iterationBudget: 30,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'research-and-distill',
    permissionMode: 'read-only',
    allowedTools: ['file', 'web', 'mimir', 'ravn'],
    iterationBudget: 25,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'retro-analyst',
    permissionMode: 'read-only',
    allowedTools: ['file', 'mimir', 'ravn'],
    iterationBudget: 20,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'reviewer',
    permissionMode: 'read-only',
    allowedTools: ['file', 'git', 'web', 'ravn'],
    iterationBudget: 25,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'review.completed',
    consumesEvents: ['code.changed', 'review.requested'],
  },
  {
    name: 'security',
    permissionMode: 'read_only',
    allowedTools: ['file', 'git', 'ravn'],
    iterationBudget: 60,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'security.completed',
    consumesEvents: ['code.changed'],
  },
  {
    name: 'security-auditor',
    permissionMode: 'read-only',
    allowedTools: ['file', 'terminal', 'web', 'ravn'],
    iterationBudget: 30,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
  {
    name: 'ship-agent',
    permissionMode: 'workspace-write',
    allowedTools: ['file', 'git', 'terminal', 'web', 'ravn'],
    iterationBudget: 15,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'ship.completed',
    consumesEvents: ['qa.completed', 'ship.requested'],
  },
  {
    name: 'verifier',
    permissionMode: 'workspace-write',
    allowedTools: ['file', 'git', 'terminal', 'web', 'ravn'],
    iterationBudget: 30,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'verification.completed',
    consumesEvents: ['qa.completed', 'code.changed', 'verification.requested'],
  },
];

function summaryToDetail(summary: PersonaSummary): PersonaDetail {
  return {
    ...summary,
    systemPromptTemplate: `You are the ${summary.name} persona.`,
    forbiddenTools: [],
    llm: { primaryAlias: 'balanced', thinkingEnabled: false, maxTokens: 0 },
    produces: { eventType: summary.producesEvent, schemaDef: {} },
    consumes: { eventTypes: summary.consumesEvents, injects: [] },
    fanIn: { strategy: 'merge', contributesTo: '' },
    yamlSource: `# ${summary.name}\n# built-in persona\npermission_mode: ${summary.permissionMode}\niteration_budget: ${summary.iterationBudget}\n`,
  };
}

// ---------------------------------------------------------------------------
// Seed — ravens (deployed fleet)
// ---------------------------------------------------------------------------

const SEED_RAVENS: Raven[] = [
  {
    id: 'r1',
    name: 'coder-asgard',
    rune: 'ᚱ',
    persona: 'coding-agent',
    location: 'asgard',
    deployment: 'k8s',
    state: 'active',
    uptime: 7200,
    lastTick: '2026-04-19T09:55:00Z',
    budget: { spentUsd: 2.4, capUsd: 10.0, warnAt: 8.0 },
    mounts: [{ name: 'local', role: 'primary', priority: 0 }],
  },
  {
    id: 'r2',
    name: 'reviewer-midgard',
    rune: 'ᚱ',
    persona: 'reviewer',
    location: 'midgard',
    deployment: 'k8s',
    state: 'idle',
    uptime: 14400,
    lastTick: '2026-04-19T09:00:00Z',
    budget: { spentUsd: 0.8, capUsd: 5.0, warnAt: 4.0 },
    mounts: [{ name: 'shared', role: 'primary', priority: 0 }],
  },
  {
    id: 'r3',
    name: 'qa-midgard',
    rune: 'ᚱ',
    persona: 'qa-agent',
    location: 'midgard',
    deployment: 'systemd',
    state: 'active',
    uptime: 3600,
    lastTick: '2026-04-19T09:58:00Z',
    budget: { spentUsd: 1.1, capUsd: 8.0, warnAt: 6.5 },
    mounts: [
      { name: 'local', role: 'primary', priority: 0 },
      { name: 'domain', role: 'ro', priority: 1 },
    ],
  },
  {
    id: 'r4',
    name: 'health-jotunheim',
    rune: 'ᚱ',
    persona: 'health-auditor',
    location: 'jotunheim',
    deployment: 'k8s',
    state: 'idle',
    uptime: 86400,
    lastTick: '2026-04-19T09:00:00Z',
    budget: { spentUsd: 0.3, capUsd: 3.0, warnAt: 2.5 },
    mounts: [{ name: 'local', role: 'primary', priority: 0 }],
  },
  {
    id: 'r5',
    name: 'investigator-desk',
    rune: 'ᚱ',
    persona: 'investigator',
    location: 'desk',
    deployment: 'ephemeral',
    state: 'suspended',
    uptime: 0,
    lastTick: '2026-04-18T18:30:00Z',
    budget: { spentUsd: 4.2, capUsd: 10.0, warnAt: 8.0 },
    mounts: [{ name: 'local', role: 'primary', priority: 0 }],
  },
];

// ---------------------------------------------------------------------------
// Seed — messages
// ---------------------------------------------------------------------------

const SEED_MESSAGES: Message[] = [
  { id: 'm1', sessionId: 's1', kind: 'system', body: 'You are a coding agent.', ts: '2026-04-19T09:12:34Z' },
  { id: 'm2', sessionId: 's1', kind: 'user', body: 'Implement the auth middleware', ts: '2026-04-19T09:12:35Z' },
  { id: 'm3', sessionId: 's1', kind: 'think', body: 'I need to understand the existing auth setup first.', ts: '2026-04-19T09:12:36Z' },
  { id: 'm4', sessionId: 's1', kind: 'tool_call', body: 'read("src/auth/middleware.py")', ts: '2026-04-19T09:12:37Z', toolName: 'read' },
  { id: 'm5', sessionId: 's1', kind: 'tool_result', body: '# auth middleware content', ts: '2026-04-19T09:12:38Z', toolName: 'read' },
  { id: 'm6', sessionId: 's1', kind: 'asst', body: 'I have reviewed the existing auth setup. Implementing now.', ts: '2026-04-19T09:12:40Z' },
  { id: 'm7', sessionId: 's1', kind: 'emit', body: 'code.changed', ts: '2026-04-19T09:55:00Z', eventName: 'code.changed' },
  { id: 'm8', sessionId: 's2', kind: 'system', body: 'You are a reviewer persona.', ts: '2026-04-19T08:45:11Z' },
  { id: 'm9', sessionId: 's2', kind: 'user', body: 'Review the auth PR', ts: '2026-04-19T08:45:12Z' },
  { id: 'm10', sessionId: 's2', kind: 'asst', body: 'PR looks good. LGTM.', ts: '2026-04-19T08:46:00Z' },
];

// ---------------------------------------------------------------------------
// Seed — sessions
// ---------------------------------------------------------------------------

const SEED_SESSIONS: Session[] = [
  {
    id: 's1',
    ravnId: 'r1',
    title: 'implement auth middleware',
    triggerId: 'trig1',
    state: 'active',
    startedAt: '2026-04-19T09:12:34Z',
    lastAt: '2026-04-19T09:55:00Z',
    messages: SEED_MESSAGES.filter((m) => m.sessionId === 's1'),
  },
  {
    id: 's2',
    ravnId: 'r2',
    title: 'review auth PR',
    state: 'completed',
    startedAt: '2026-04-19T08:45:11Z',
    lastAt: '2026-04-19T08:46:00Z',
    messages: SEED_MESSAGES.filter((m) => m.sessionId === 's2'),
  },
  {
    id: 's3',
    ravnId: 'r3',
    title: 'run test suite',
    state: 'idle',
    startedAt: '2026-04-19T07:55:22Z',
    messages: [],
  },
];

// ---------------------------------------------------------------------------
// Seed — triggers
// ---------------------------------------------------------------------------

const SEED_TRIGGERS: Trigger[] = [
  { id: 'trig1', ravnId: 'r1', kind: 'event', topic: 'feature.requested', producesEvent: 'code.changed' },
  { id: 'trig2', ravnId: 'r2', kind: 'event', topic: 'code.changed', producesEvent: 'review.completed' },
  { id: 'trig3', ravnId: 'r3', kind: 'event', topic: 'review.completed' },
  { id: 'trig4', ravnId: 'r4', kind: 'cron', schedule: '0 * * * *', description: 'hourly health check' },
  { id: 'trig5', ravnId: 'r1', kind: 'webhook', path: '/hooks/github' },
  { id: 'trig6', ravnId: 'r5', kind: 'manual' },
];

// ---------------------------------------------------------------------------
// Mock persona store
// ---------------------------------------------------------------------------

function createMockPersonaStore(): IPersonaStore {
  const customPersonas: PersonaDetail[] = [];

  return {
    async listPersonas(filter: PersonaFilter = 'all') {
      if (filter === 'builtin') return SEED_PERSONAS;
      if (filter === 'custom') return customPersonas.map((p) => toSummary(p));
      return [...SEED_PERSONAS, ...customPersonas.map((p) => toSummary(p))];
    },

    async getPersona(name: string) {
      const custom = customPersonas.find((p) => p.name === name);
      if (custom) return custom;
      const seed = SEED_PERSONAS.find((p) => p.name === name);
      if (seed) return summaryToDetail(seed);
      throw new Error(`Persona "${name}" not found`);
    },

    async getPersonaYaml(name: string) {
      const seed = SEED_PERSONAS.find((p) => p.name === name);
      const custom = customPersonas.find((p) => p.name === name);
      const found = custom ?? (seed ? summaryToDetail(seed) : null);
      if (!found) throw new Error(`Persona "${name}" not found`);
      return found.yamlSource;
    },

    async createPersona(req: PersonaCreateRequest) {
      const detail: PersonaDetail = {
        name: req.name,
        permissionMode: req.permissionMode,
        allowedTools: req.allowedTools,
        iterationBudget: req.iterationBudget,
        isBuiltin: false,
        hasOverride: false,
        producesEvent: req.producesEventType,
        consumesEvents: req.consumesEventTypes,
        systemPromptTemplate: req.systemPromptTemplate,
        forbiddenTools: req.forbiddenTools,
        llm: {
          primaryAlias: req.llmPrimaryAlias,
          thinkingEnabled: req.llmThinkingEnabled,
          maxTokens: req.llmMaxTokens,
        },
        produces: { eventType: req.producesEventType, schemaDef: {} },
        consumes: { eventTypes: req.consumesEventTypes, injects: req.consumesInjects },
        fanIn: { strategy: req.fanInStrategy, contributesTo: req.fanInContributesTo },
        yamlSource: `# ${req.name}\n`,
      };
      customPersonas.push(detail);
      return detail;
    },

    async updatePersona(name: string, req: PersonaCreateRequest) {
      const idx = customPersonas.findIndex((p) => p.name === name);
      if (idx === -1) throw new Error(`Persona "${name}" not found or is built-in`);
      const updated: PersonaDetail = {
        ...customPersonas[idx]!,
        permissionMode: req.permissionMode,
        allowedTools: req.allowedTools,
        iterationBudget: req.iterationBudget,
        systemPromptTemplate: req.systemPromptTemplate,
        forbiddenTools: req.forbiddenTools,
        llm: {
          primaryAlias: req.llmPrimaryAlias,
          thinkingEnabled: req.llmThinkingEnabled,
          maxTokens: req.llmMaxTokens,
        },
      };
      customPersonas[idx] = updated;
      return updated;
    },

    async deletePersona(name: string) {
      const idx = customPersonas.findIndex((p) => p.name === name);
      if (idx === -1) throw new Error(`Persona "${name}" not found or is built-in`);
      customPersonas.splice(idx, 1);
    },

    async forkPersona(name: string, req: PersonaForkRequest) {
      const seed = SEED_PERSONAS.find((p) => p.name === name);
      const custom = customPersonas.find((p) => p.name === name);
      const source = custom ?? (seed ? summaryToDetail(seed) : null);
      if (!source) throw new Error(`Persona "${name}" not found`);
      const forked: PersonaDetail = {
        ...source,
        name: req.newName,
        isBuiltin: false,
        hasOverride: false,
        yamlSource: `# ${req.newName} (forked from ${name})\n`,
      };
      customPersonas.push(forked);
      return forked;
    },
  };
}

function toSummary(detail: PersonaDetail): PersonaSummary {
  return {
    name: detail.name,
    permissionMode: detail.permissionMode,
    allowedTools: detail.allowedTools,
    iterationBudget: detail.iterationBudget,
    isBuiltin: detail.isBuiltin,
    hasOverride: detail.hasOverride,
    producesEvent: detail.producesEvent,
    consumesEvents: detail.consumesEvents,
  };
}

// ---------------------------------------------------------------------------
// Mock raven stream
// ---------------------------------------------------------------------------

function createMockRavenStream(): IRavenStream {
  return {
    async listRavens() {
      return SEED_RAVENS;
    },

    async getRaven(id: string) {
      const raven = SEED_RAVENS.find((r) => r.id === id);
      if (!raven) throw new Error(`Raven "${id}" not found`);
      return raven;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock session stream
// ---------------------------------------------------------------------------

function createMockSessionStream(): ISessionStream {
  return {
    async listSessions(ravnId?: string) {
      if (ravnId) return SEED_SESSIONS.filter((s) => s.ravnId === ravnId);
      return SEED_SESSIONS;
    },

    async getSession(id: string) {
      const session = SEED_SESSIONS.find((s) => s.id === id);
      if (!session) throw new Error(`Session "${id}" not found`);
      return session;
    },

    async getMessages(sessionId: string) {
      return SEED_MESSAGES.filter((m) => m.sessionId === sessionId);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock trigger store
// ---------------------------------------------------------------------------

function createMockTriggerStore(): ITriggerStore {
  const custom: Trigger[] = [];
  let nextId = 100;

  return {
    async listTriggers(ravnId?: string) {
      const all = [...SEED_TRIGGERS, ...custom];
      if (ravnId) return all.filter((t) => t.ravnId === ravnId);
      return all;
    },

    async createTrigger(trigger: TriggerInput) {
      const created = { ...trigger, id: `trig${nextId++}` } as Trigger;
      custom.push(created);
      return created;
    },

    async deleteTrigger(id: string) {
      const idx = custom.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`Trigger "${id}" not found or is seed data`);
      custom.splice(idx, 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock budget stream
// ---------------------------------------------------------------------------

const FLEET_BUDGET: BudgetState = { spentUsd: 8.8, capUsd: 36.0, warnAt: 28.0 };

function createMockBudgetStream(): IBudgetStream {
  return {
    async getFleetBudget() {
      return FLEET_BUDGET;
    },

    async getRavenBudget(ravnId: string) {
      const raven = SEED_RAVENS.find((r) => r.id === ravnId);
      if (!raven) throw new Error(`Raven "${ravnId}" not found`);
      return raven.budget;
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createMockRavnService(): IRavnService {
  return {
    personas: createMockPersonaStore(),
    ravens: createMockRavenStream(),
    sessions: createMockSessionStream(),
    triggers: createMockTriggerStore(),
    budget: createMockBudgetStream(),
  };
}
