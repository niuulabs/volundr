/**
 * Mock adapters for all Ravn ports.
 *
 * Seeded from the 21 built-in persona definitions that mirror
 * the backend YAML files in src/ravn/personas/.
 */

import type {
  IPersonaStore,
  IRavenStream,
  ISessionStream,
  ITriggerStore,
  IBudgetStream,
  PersonaSummary,
  PersonaDetail,
  PersonaCreateRequest,
  PersonaForkRequest,
  PersonaFilter,
} from '../ports';
import type { Ravn } from '../domain/ravn';
import type { Session } from '../domain/session';
import type { Trigger } from '../domain/trigger';
import type { Message } from '../domain/message';
import type { BudgetState } from '@niuulabs/domain';

// ---------------------------------------------------------------------------
// Seed data — mirrors web/src/modules/ravn/api/mockData.ts
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

const SEED_RAVENS: Ravn[] = [
  {
    id: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    personaName: 'coding-agent',
    status: 'active',
    model: 'claude-sonnet-4-6',
    createdAt: '2026-04-15T09:12:34Z',
  },
  {
    id: 'b7e2c9d1-3a4f-4b8e-a1c6-5d7f8e9a0b2c',
    personaName: 'reviewer',
    status: 'active',
    model: 'claude-opus-4-6',
    createdAt: '2026-04-15T08:45:11Z',
  },
  {
    id: 'c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    personaName: 'security',
    status: 'idle',
    model: 'claude-haiku-4-5',
    createdAt: '2026-04-15T08:30:00Z',
  },
  {
    id: 'd8e9f0a1-2b3c-4d5e-6f7a-8b9c0d1e2f3a',
    personaName: 'qa-agent',
    status: 'active',
    model: 'claude-sonnet-4-6',
    createdAt: '2026-04-15T07:55:22Z',
  },
  {
    id: 'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
    personaName: 'investigator',
    status: 'suspended',
    model: 'claude-opus-4-6',
    createdAt: '2026-04-14T22:10:45Z',
  },
  {
    id: 'f5a6b7c8-9d0e-4f1a-2b3c-4d5e6f7a8b9c',
    personaName: 'health-auditor',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    createdAt: '2026-04-14T18:33:07Z',
  },
];

const SEED_SESSIONS: Session[] = [
  {
    id: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    personaName: 'coding-agent',
    status: 'running',
    model: 'claude-sonnet-4-6',
    createdAt: '2026-04-15T09:12:34Z',
  },
  {
    id: 'b7e2c9d1-3a4f-4b8e-a1c6-5d7f8e9a0b2c',
    ravnId: 'b7e2c9d1-3a4f-4b8e-a1c6-5d7f8e9a0b2c',
    personaName: 'reviewer',
    status: 'running',
    model: 'claude-opus-4-6',
    createdAt: '2026-04-15T08:45:11Z',
  },
  {
    id: 'c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    ravnId: 'c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    personaName: 'security',
    status: 'idle',
    model: 'claude-haiku-4-5',
    createdAt: '2026-04-15T08:30:00Z',
  },
  {
    id: 'd8e9f0a1-2b3c-4d5e-6f7a-8b9c0d1e2f3a',
    ravnId: 'd8e9f0a1-2b3c-4d5e-6f7a-8b9c0d1e2f3a',
    personaName: 'qa-agent',
    status: 'running',
    model: 'claude-sonnet-4-6',
    createdAt: '2026-04-15T07:55:22Z',
  },
  {
    id: 'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
    ravnId: 'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
    personaName: 'investigator',
    status: 'stopped',
    model: 'claude-opus-4-6',
    createdAt: '2026-04-14T22:10:45Z',
  },
  {
    id: 'f5a6b7c8-9d0e-4f1a-2b3c-4d5e6f7a8b9c',
    ravnId: 'f5a6b7c8-9d0e-4f1a-2b3c-4d5e6f7a8b9c',
    personaName: 'health-auditor',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    createdAt: '2026-04-14T18:33:07Z',
  },
];

const SEED_TRIGGERS: Trigger[] = [
  {
    id: 'aa000001-0000-4000-8000-000000000001',
    kind: 'cron',
    personaName: 'health-auditor',
    spec: '0 * * * *',
    enabled: true,
    createdAt: '2026-04-01T00:00:00Z',
  },
  {
    id: 'aa000001-0000-4000-8000-000000000002',
    kind: 'event',
    personaName: 'reviewer',
    spec: 'code.changed',
    enabled: true,
    createdAt: '2026-04-01T00:00:00Z',
  },
  {
    id: 'aa000001-0000-4000-8000-000000000003',
    kind: 'event',
    personaName: 'qa-agent',
    spec: 'review.completed',
    enabled: true,
    createdAt: '2026-04-01T00:00:00Z',
  },
  {
    id: 'aa000001-0000-4000-8000-000000000004',
    kind: 'webhook',
    personaName: 'coding-agent',
    spec: '/hooks/dispatch',
    enabled: false,
    createdAt: '2026-04-10T12:00:00Z',
  },
  {
    id: 'aa000001-0000-4000-8000-000000000005',
    kind: 'manual',
    personaName: 'investigator',
    spec: 'investigate-incident',
    enabled: true,
    createdAt: '2026-04-12T09:00:00Z',
  },
];

const SEED_MESSAGES: Message[] = [
  {
    id: '00000001-0000-4000-8000-000000000001',
    sessionId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    kind: 'user',
    content: 'Please implement the login form',
    ts: '2026-04-15T09:12:35Z',
  },
  {
    id: '00000001-0000-4000-8000-000000000002',
    sessionId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    kind: 'think',
    content: 'I need to check the existing auth setup first.',
    ts: '2026-04-15T09:12:36Z',
  },
  {
    id: '00000001-0000-4000-8000-000000000003',
    sessionId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    kind: 'tool_call',
    content: '{"path": "src/auth/LoginForm.tsx"}',
    ts: '2026-04-15T09:12:37Z',
    toolName: 'file.read',
  },
  {
    id: '00000001-0000-4000-8000-000000000004',
    sessionId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    kind: 'tool_result',
    content: '{"content": "// file not found"}',
    ts: '2026-04-15T09:12:38Z',
    toolName: 'file.read',
  },
  {
    id: '00000001-0000-4000-8000-000000000005',
    sessionId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    kind: 'asst',
    content: "I'll create the login form at `src/auth/LoginForm.tsx`.",
    ts: '2026-04-15T09:12:40Z',
  },
  {
    id: '00000001-0000-4000-8000-000000000006',
    sessionId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
    kind: 'emit',
    content: '{"event":"code.changed","payload":{"file":"src/auth/LoginForm.tsx"}}',
    ts: '2026-04-15T09:13:01Z',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDetail(summary: PersonaSummary, req?: PersonaCreateRequest): PersonaDetail {
  return {
    ...summary,
    systemPromptTemplate:
      req?.systemPromptTemplate ?? `# ${summary.name}\nYou are the ${summary.name} persona.`,
    forbiddenTools: req?.forbiddenTools ?? [],
    llm: {
      primaryAlias: req?.llmPrimaryAlias ?? 'claude-sonnet-4-6',
      thinkingEnabled: req?.llmThinkingEnabled ?? false,
      maxTokens: req?.llmMaxTokens ?? 8192,
    },
    produces: {
      eventType: summary.producesEvent,
      schemaDef: {},
    },
    consumes: {
      eventTypes: summary.consumesEvents,
      injects: req?.consumesInjects ?? [],
    },
    fanIn: {
      strategy: req?.fanInStrategy ?? 'merge',
      contributesTo: req?.fanInContributesTo ?? '',
    },
    yamlSource: '[mock]',
  };
}

let nextTriggerSeq = 6;
function nextTriggerUuid(): string {
  const n = nextTriggerSeq++;
  return `aa000001-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/** Create a mock IPersonaStore with the 21 built-in seed personas. */
export function createMockPersonaStore(): IPersonaStore {
  const store = new Map<string, PersonaSummary>(SEED_PERSONAS.map((p) => [p.name, p]));

  return {
    async listPersonas(filter: PersonaFilter = 'all') {
      const all = Array.from(store.values());
      if (filter === 'builtin') return all.filter((p) => p.isBuiltin);
      if (filter === 'custom') return all.filter((p) => !p.isBuiltin);
      return all;
    },

    async getPersona(name: string) {
      const p = store.get(name);
      if (!p) throw new Error(`Persona not found: ${name}`);
      return toDetail(p);
    },

    async getPersonaYaml(name: string) {
      const p = store.get(name);
      if (!p) throw new Error(`Persona not found: ${name}`);
      return `# Mock YAML for ${name}\nname: ${name}\n`;
    },

    async createPersona(req: PersonaCreateRequest) {
      const summary: PersonaSummary = {
        name: req.name,
        permissionMode: req.permissionMode,
        allowedTools: req.allowedTools,
        iterationBudget: req.iterationBudget,
        isBuiltin: false,
        hasOverride: false,
        producesEvent: req.producesEventType,
        consumesEvents: req.consumesEventTypes,
      };
      store.set(req.name, summary);
      return toDetail(summary, req);
    },

    async updatePersona(name: string, req: PersonaCreateRequest) {
      const existing = store.get(name);
      if (!existing) throw new Error(`Persona not found: ${name}`);
      const updated: PersonaSummary = {
        ...existing,
        permissionMode: req.permissionMode,
        allowedTools: req.allowedTools,
        iterationBudget: req.iterationBudget,
        producesEvent: req.producesEventType,
        consumesEvents: req.consumesEventTypes,
      };
      store.set(name, updated);
      return toDetail(updated, req);
    },

    async deletePersona(name: string) {
      store.delete(name);
    },

    async forkPersona(name: string, req: PersonaForkRequest) {
      const source = store.get(name);
      if (!source) throw new Error(`Persona not found: ${name}`);
      const forked: PersonaSummary = { ...source, name: req.newName, isBuiltin: false };
      store.set(req.newName, forked);
      return toDetail(forked);
    },
  };
}

/** Create a mock IRavenStream with a seeded fleet. */
export function createMockRavenStream(): IRavenStream {
  return {
    async listRavens() {
      return SEED_RAVENS;
    },

    async getRaven(id: string) {
      const r = SEED_RAVENS.find((rv) => rv.id === id);
      if (!r) throw new Error(`Ravn not found: ${id}`);
      return r;
    },
  };
}

/** Create a mock ISessionStream with seeded sessions and messages. */
export function createMockSessionStream(): ISessionStream {
  return {
    async listSessions() {
      return SEED_SESSIONS;
    },

    async getSession(id: string) {
      const s = SEED_SESSIONS.find((ss) => ss.id === id);
      if (!s) throw new Error(`Session not found: ${id}`);
      return s;
    },

    async getMessages(sessionId: string) {
      return SEED_MESSAGES.filter((m) => m.sessionId === sessionId);
    },
  };
}

/** Create a mock ITriggerStore with seeded triggers. */
export function createMockTriggerStore(): ITriggerStore {
  const store = new Map<string, Trigger>(SEED_TRIGGERS.map((t) => [t.id, t]));

  return {
    async listTriggers() {
      return Array.from(store.values());
    },

    async createTrigger(t) {
      const trigger: Trigger = {
        ...t,
        id: nextTriggerUuid(),
        createdAt: new Date().toISOString(),
      };
      store.set(trigger.id, trigger);
      return trigger;
    },

    async deleteTrigger(id: string) {
      store.delete(id);
    },
  };
}

/** Create a mock IBudgetStream with fixed demo values. */
export function createMockBudgetStream(): IBudgetStream {
  const perRavn: Record<string, BudgetState> = {
    'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c': { spentUsd: 1.24, capUsd: 5.0, warnAt: 0.8 },
    'b7e2c9d1-3a4f-4b8e-a1c6-5d7f8e9a0b2c': { spentUsd: 3.87, capUsd: 5.0, warnAt: 0.8 },
    'c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e5f': { spentUsd: 0.12, capUsd: 2.0, warnAt: 0.8 },
    'd8e9f0a1-2b3c-4d5e-6f7a-8b9c0d1e2f3a': { spentUsd: 0.95, capUsd: 3.0, warnAt: 0.8 },
    'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b': { spentUsd: 0.0, capUsd: 5.0, warnAt: 0.8 },
    'f5a6b7c8-9d0e-4f1a-2b3c-4d5e6f7a8b9c': { spentUsd: 0.43, capUsd: 2.0, warnAt: 0.8 },
  };

  return {
    async getBudget(ravnId: string) {
      return perRavn[ravnId] ?? { spentUsd: 0, capUsd: 5.0, warnAt: 0.8 };
    },

    async getFleetBudget() {
      const total = Object.values(perRavn).reduce(
        (acc, b) => ({
          spentUsd: acc.spentUsd + b.spentUsd,
          capUsd: acc.capUsd + b.capUsd,
          warnAt: 0.8,
        }),
        { spentUsd: 0, capUsd: 0, warnAt: 0.8 },
      );
      return total;
    },
  };
}
