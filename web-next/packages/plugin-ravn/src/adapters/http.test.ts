import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@niuulabs/query';
import { createHttpRavnService } from './http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Raw fixtures
// ---------------------------------------------------------------------------

const rawSummary = {
  name: 'coding-agent',
  permission_mode: 'workspace-write',
  allowed_tools: ['file', 'git'],
  iteration_budget: 40,
  is_builtin: true,
  has_override: false,
  produces_event: 'code.changed',
  consumes_events: ['code.requested'],
};

const rawDetail = {
  ...rawSummary,
  system_prompt_template: 'You are a coding agent.',
  forbidden_tools: [],
  llm: { primary_alias: 'balanced', thinking_enabled: true, max_tokens: 0 },
  produces: { event_type: 'code.changed', schema_def: {} },
  consumes: { event_types: ['code.requested'], injects: ['repo'] },
  fan_in: { strategy: 'merge', contributes_to: '' },
  yaml_source: '[built-in]',
};

const rawRaven = {
  id: 'r1',
  name: 'coder-asgard',
  rune: 'ᚱ',
  persona: 'coding-agent',
  location: 'asgard',
  deployment: 'k8s',
  state: 'active',
  uptime: 3600,
  last_tick: '2026-04-19T09:00:00Z',
  budget: { spent_usd: 2.4, cap_usd: 10.0, warn_at: 8.0 },
  mounts: [{ name: 'local', role: 'primary', priority: 0 }],
};

const rawSession = {
  id: 's1',
  ravn_id: 'r1',
  title: 'implement auth',
  trigger_id: 't1',
  state: 'active',
  started_at: '2026-04-19T09:00:00Z',
  last_at: '2026-04-19T09:55:00Z',
  messages: [
    {
      id: 'm1',
      session_id: 's1',
      kind: 'user',
      body: 'hello',
      ts: '2026-04-19T09:00:01Z',
      tool_name: undefined,
      event_name: undefined,
    },
    {
      id: 'm2',
      session_id: 's1',
      kind: 'tool_call',
      body: 'read("file")',
      ts: '2026-04-19T09:00:02Z',
      tool_name: 'read',
    },
  ],
};

const rawTriggers = [
  { id: 't1', ravn_id: 'r1', kind: 'cron', schedule: '0 * * * *', description: 'hourly' },
  { id: 't2', ravn_id: 'r1', kind: 'event', topic: 'code.changed', produces_event: 'review.done' },
  { id: 't3', ravn_id: 'r1', kind: 'webhook', path: '/hooks/github' },
  { id: 't4', ravn_id: 'r1', kind: 'manual' },
];

const rawBudget = { spent_usd: 8.8, cap_usd: 36.0, warn_at: 28.0 };

// ---------------------------------------------------------------------------
// Persona store
// ---------------------------------------------------------------------------

describe('createHttpRavnService — personas', () => {
  it('listPersonas fetches /personas?source=all by default', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([rawSummary]) });
    const svc = createHttpRavnService(client);
    const result = await svc.personas.listPersonas();
    expect(client.get).toHaveBeenCalledWith('/personas?source=all');
    expect(result[0]).toMatchObject({ name: 'coding-agent', permissionMode: 'workspace-write' });
  });

  it('listPersonas transforms snake_case to camelCase', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([rawSummary]) });
    const svc = createHttpRavnService(client);
    const [p] = await svc.personas.listPersonas();
    expect(p).toMatchObject({
      allowedTools: ['file', 'git'],
      iterationBudget: 40,
      isBuiltin: true,
      hasOverride: false,
      producesEvent: 'code.changed',
      consumesEvents: ['code.requested'],
    });
  });

  it('listPersonas passes filter param', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([]) });
    const svc = createHttpRavnService(client);
    await svc.personas.listPersonas('builtin');
    expect(client.get).toHaveBeenCalledWith('/personas?source=builtin');
  });

  it('getPersona fetches by name and transforms detail', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue(rawDetail) });
    const svc = createHttpRavnService(client);
    const result = await svc.personas.getPersona('coding-agent');
    expect(client.get).toHaveBeenCalledWith('/personas/coding-agent');
    expect(result.systemPromptTemplate).toBe('You are a coding agent.');
    expect(result.llm).toMatchObject({ primaryAlias: 'balanced', thinkingEnabled: true });
    expect(result.produces).toMatchObject({ eventType: 'code.changed' });
    expect(result.consumes).toMatchObject({ injects: ['repo'] });
    expect(result.fanIn).toMatchObject({ strategy: 'merge', contributesTo: '' });
    expect(result.yamlSource).toBe('[built-in]');
  });

  it('getPersonaYaml fetches yaml endpoint', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue('name: coding-agent\n') });
    const svc = createHttpRavnService(client);
    const result = await svc.personas.getPersonaYaml('coding-agent');
    expect(client.get).toHaveBeenCalledWith('/personas/coding-agent/yaml');
    expect(result).toBe('name: coding-agent\n');
  });

  it('createPersona sends POST with snake_case body', async () => {
    const client = mockClient({ post: vi.fn().mockResolvedValue(rawDetail) });
    const svc = createHttpRavnService(client);
    await svc.personas.createPersona({
      name: 'new-agent',
      systemPromptTemplate: 'You help.',
      allowedTools: ['file'],
      forbiddenTools: [],
      permissionMode: 'read-only',
      iterationBudget: 10,
      llmPrimaryAlias: 'balanced',
      llmThinkingEnabled: false,
      llmMaxTokens: 0,
      producesEventType: '',
      consumesEventTypes: [],
      consumesInjects: [],
      fanInStrategy: 'merge',
      fanInContributesTo: '',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/personas',
      expect.objectContaining({
        name: 'new-agent',
        system_prompt_template: 'You help.',
        allowed_tools: ['file'],
        permission_mode: 'read-only',
        iteration_budget: 10,
      }),
    );
  });

  it('updatePersona sends PUT', async () => {
    const client = mockClient({ put: vi.fn().mockResolvedValue(rawDetail) });
    const svc = createHttpRavnService(client);
    await svc.personas.updatePersona('coding-agent', {
      name: 'coding-agent',
      systemPromptTemplate: 'Updated.',
      allowedTools: [],
      forbiddenTools: [],
      permissionMode: '',
      iterationBudget: 0,
      llmPrimaryAlias: '',
      llmThinkingEnabled: false,
      llmMaxTokens: 0,
      producesEventType: '',
      consumesEventTypes: [],
      consumesInjects: [],
      fanInStrategy: 'merge',
      fanInContributesTo: '',
    });
    expect(client.put).toHaveBeenCalledWith(
      '/personas/coding-agent',
      expect.objectContaining({ system_prompt_template: 'Updated.' }),
    );
  });

  it('deletePersona sends DELETE', async () => {
    const client = mockClient({ delete: vi.fn().mockResolvedValue(undefined) });
    const svc = createHttpRavnService(client);
    await svc.personas.deletePersona('my-agent');
    expect(client.delete).toHaveBeenCalledWith('/personas/my-agent');
  });

  it('forkPersona sends POST to /fork with new_name', async () => {
    const client = mockClient({ post: vi.fn().mockResolvedValue(rawDetail) });
    const svc = createHttpRavnService(client);
    await svc.personas.forkPersona('coding-agent', { newName: 'my-fork' });
    expect(client.post).toHaveBeenCalledWith(
      '/personas/coding-agent/fork',
      expect.objectContaining({ new_name: 'my-fork' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Raven stream
// ---------------------------------------------------------------------------

describe('createHttpRavnService — ravens', () => {
  it('listRavens fetches /ravens and transforms response', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([rawRaven]) });
    const svc = createHttpRavnService(client);
    const result = await svc.ravens.listRavens();
    expect(client.get).toHaveBeenCalledWith('/ravens');
    expect(result[0]).toMatchObject({
      id: 'r1',
      lastTick: '2026-04-19T09:00:00Z',
      budget: { spentUsd: 2.4, capUsd: 10.0, warnAt: 8.0 },
    });
    expect(result[0]?.mounts[0]).toMatchObject({ name: 'local', role: 'primary' });
  });

  it('getRaven fetches by id', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue(rawRaven) });
    const svc = createHttpRavnService(client);
    const result = await svc.ravens.getRaven('r1');
    expect(client.get).toHaveBeenCalledWith('/ravens/r1');
    expect(result.name).toBe('coder-asgard');
  });

  it('propagates errors', async () => {
    const client = mockClient({ get: vi.fn().mockRejectedValue(new Error('not found')) });
    const svc = createHttpRavnService(client);
    await expect(svc.ravens.getRaven('r999')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// Session stream
// ---------------------------------------------------------------------------

describe('createHttpRavnService — sessions', () => {
  it('listSessions fetches /sessions', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([rawSession]) });
    const svc = createHttpRavnService(client);
    const result = await svc.sessions.listSessions();
    expect(client.get).toHaveBeenCalledWith('/sessions');
    expect(result[0]).toMatchObject({ id: 's1', ravnId: 'r1', triggerId: 't1' });
  });

  it('listSessions filters by ravnId', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([]) });
    const svc = createHttpRavnService(client);
    await svc.sessions.listSessions('r1');
    expect(client.get).toHaveBeenCalledWith('/sessions?ravn_id=r1');
  });

  it('getSession fetches by id and transforms messages', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue(rawSession) });
    const svc = createHttpRavnService(client);
    const result = await svc.sessions.getSession('s1');
    expect(result.messages[0]).toMatchObject({ id: 'm1', sessionId: 's1', kind: 'user' });
    expect(result.messages[1]).toMatchObject({ toolName: 'read' });
  });

  it('getMessages fetches from /sessions/:id/messages', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([rawSession.messages[0]!]) });
    const svc = createHttpRavnService(client);
    const result = await svc.sessions.getMessages('s1');
    expect(client.get).toHaveBeenCalledWith('/sessions/s1/messages');
    expect(result[0]?.kind).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// Trigger store
// ---------------------------------------------------------------------------

describe('createHttpRavnService — triggers', () => {
  it('listTriggers fetches /triggers and transforms all kinds', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue(rawTriggers) });
    const svc = createHttpRavnService(client);
    const result = await svc.triggers.listTriggers();
    expect(client.get).toHaveBeenCalledWith('/triggers');
    expect(result).toHaveLength(4);
    const cron = result.find((t) => t.kind === 'cron');
    const event = result.find((t) => t.kind === 'event');
    const webhook = result.find((t) => t.kind === 'webhook');
    const manual = result.find((t) => t.kind === 'manual');
    expect(cron).toBeDefined();
    expect(event).toBeDefined();
    expect(webhook).toBeDefined();
    expect(manual).toBeDefined();
  });

  it('listTriggers filters by ravnId', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue([]) });
    const svc = createHttpRavnService(client);
    await svc.triggers.listTriggers('r1');
    expect(client.get).toHaveBeenCalledWith('/triggers?ravn_id=r1');
  });

  it('createTrigger sends POST with snake_case body', async () => {
    const client = mockClient({ post: vi.fn().mockResolvedValue(rawTriggers[0]) });
    const svc = createHttpRavnService(client);
    await svc.triggers.createTrigger({
      ravnId: 'r1',
      kind: 'cron',
      schedule: '0 8 * * *',
      description: 'morning run',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/triggers',
      expect.objectContaining({
        ravn_id: 'r1',
        kind: 'cron',
        schedule: '0 8 * * *',
      }),
    );
  });

  it('createTrigger sends event trigger with topic', async () => {
    const client = mockClient({ post: vi.fn().mockResolvedValue(rawTriggers[1]) });
    const svc = createHttpRavnService(client);
    await svc.triggers.createTrigger({ ravnId: 'r1', kind: 'event', topic: 'code.changed' });
    expect(client.post).toHaveBeenCalledWith(
      '/triggers',
      expect.objectContaining({ kind: 'event', topic: 'code.changed' }),
    );
  });

  it('createTrigger sends webhook trigger with path', async () => {
    const client = mockClient({ post: vi.fn().mockResolvedValue(rawTriggers[2]) });
    const svc = createHttpRavnService(client);
    await svc.triggers.createTrigger({ ravnId: 'r1', kind: 'webhook', path: '/hooks/gh' });
    expect(client.post).toHaveBeenCalledWith(
      '/triggers',
      expect.objectContaining({ kind: 'webhook', path: '/hooks/gh' }),
    );
  });

  it('createTrigger sends manual trigger', async () => {
    const client = mockClient({ post: vi.fn().mockResolvedValue(rawTriggers[3]) });
    const svc = createHttpRavnService(client);
    await svc.triggers.createTrigger({ ravnId: 'r1', kind: 'manual' });
    expect(client.post).toHaveBeenCalledWith(
      '/triggers',
      expect.objectContaining({ kind: 'manual' }),
    );
  });

  it('deleteTrigger sends DELETE', async () => {
    const client = mockClient({ delete: vi.fn().mockResolvedValue(undefined) });
    const svc = createHttpRavnService(client);
    await svc.triggers.deleteTrigger('t1');
    expect(client.delete).toHaveBeenCalledWith('/triggers/t1');
  });
});

// ---------------------------------------------------------------------------
// Budget stream
// ---------------------------------------------------------------------------

describe('createHttpRavnService — budget', () => {
  it('getFleetBudget fetches /budget and transforms', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue(rawBudget) });
    const svc = createHttpRavnService(client);
    const result = await svc.budget.getFleetBudget();
    expect(client.get).toHaveBeenCalledWith('/budget');
    expect(result).toMatchObject({ spentUsd: 8.8, capUsd: 36.0, warnAt: 28.0 });
  });

  it('getRavenBudget fetches /ravens/:id/budget', async () => {
    const client = mockClient({ get: vi.fn().mockResolvedValue(rawBudget) });
    const svc = createHttpRavnService(client);
    const result = await svc.budget.getRavenBudget('r1');
    expect(client.get).toHaveBeenCalledWith('/ravens/r1/budget');
    expect(result.spentUsd).toBe(8.8);
  });

  it('propagates errors', async () => {
    const client = mockClient({ get: vi.fn().mockRejectedValue(new Error('boom')) });
    const svc = createHttpRavnService(client);
    await expect(svc.budget.getFleetBudget()).rejects.toThrow('boom');
  });
});
