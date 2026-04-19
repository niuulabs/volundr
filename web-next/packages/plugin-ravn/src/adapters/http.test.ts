/**
 * HTTP adapter tests — adapted from web/src/modules/ravn/api/client.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { buildRavnPersonaAdapter } from './http';
import type { IPersonaStore, PersonaCreateRequest } from '../ports';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const rawSummary = {
  name: 'coding-agent',
  permission_mode: 'workspace-write',
  allowed_tools: ['file', 'git'],
  iteration_budget: 40,
  is_builtin: true,
  has_override: false,
  produces_event: 'code.done',
  consumes_events: ['task.assigned'],
};

const rawDetail = {
  ...rawSummary,
  system_prompt_template: 'You are a coder.',
  forbidden_tools: ['cascade'],
  llm: { primary_alias: 'balanced', thinking_enabled: true, max_tokens: 0 },
  produces: { event_type: 'code.done', schema_def: {} },
  consumes: { event_types: ['task.assigned'], injects: ['repo'] },
  fan_in: { strategy: 'merge', contributes_to: '' },
  yaml_source: '[built-in]',
};

function makeClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// listPersonas
// ---------------------------------------------------------------------------

describe('listPersonas', () => {
  it('calls GET /personas?source=all by default', async () => {
    const client = makeClient();
    client.get.mockResolvedValue([rawSummary]);
    await buildRavnPersonaAdapter(client).listPersonas();
    expect(client.get).toHaveBeenCalledWith('/personas?source=all');
  });

  it('transforms snake_case to camelCase', async () => {
    const client = makeClient();
    client.get.mockResolvedValue([rawSummary]);
    const result = await buildRavnPersonaAdapter(client).listPersonas();
    expect(result[0]).toMatchObject({
      name: 'coding-agent',
      permissionMode: 'workspace-write',
      allowedTools: ['file', 'git'],
      iterationBudget: 40,
      isBuiltin: true,
      hasOverride: false,
      producesEvent: 'code.done',
      consumesEvents: ['task.assigned'],
    });
  });

  it('fetches builtin personas with source=builtin', async () => {
    const client = makeClient();
    client.get.mockResolvedValue([]);
    await buildRavnPersonaAdapter(client).listPersonas('builtin');
    expect(client.get).toHaveBeenCalledWith('/personas?source=builtin');
  });

  it('fetches custom personas with source=custom', async () => {
    const client = makeClient();
    client.get.mockResolvedValue([]);
    await buildRavnPersonaAdapter(client).listPersonas('custom');
    expect(client.get).toHaveBeenCalledWith('/personas?source=custom');
  });

  it('propagates errors from the HTTP client', async () => {
    const client = makeClient();
    client.get.mockRejectedValue(new Error('network error'));
    await expect(buildRavnPersonaAdapter(client).listPersonas()).rejects.toThrow('network error');
  });
});

// ---------------------------------------------------------------------------
// getPersona
// ---------------------------------------------------------------------------

describe('getPersona', () => {
  it('calls GET /personas/:name', async () => {
    const client = makeClient();
    client.get.mockResolvedValue(rawDetail);
    await buildRavnPersonaAdapter(client).getPersona('coding-agent');
    expect(client.get).toHaveBeenCalledWith('/personas/coding-agent');
  });

  it('URL-encodes persona names with special characters', async () => {
    const client = makeClient();
    client.get.mockResolvedValue(rawDetail);
    await buildRavnPersonaAdapter(client).getPersona('my agent');
    expect(client.get).toHaveBeenCalledWith('/personas/my%20agent');
  });

  it('transforms detail response to camelCase', async () => {
    const client = makeClient();
    client.get.mockResolvedValue(rawDetail);
    const result = await buildRavnPersonaAdapter(client).getPersona('coding-agent');
    expect(result).toMatchObject({
      name: 'coding-agent',
      systemPromptTemplate: 'You are a coder.',
      forbiddenTools: ['cascade'],
      llm: { primaryAlias: 'balanced', thinkingEnabled: true, maxTokens: 0 },
      produces: { eventType: 'code.done', schemaDef: {} },
      consumes: { eventTypes: ['task.assigned'], injects: ['repo'] },
      fanIn: { strategy: 'merge', contributesTo: '' },
      yamlSource: '[built-in]',
    });
  });
});

// ---------------------------------------------------------------------------
// getPersonaYaml
// ---------------------------------------------------------------------------

describe('getPersonaYaml', () => {
  it('calls GET /personas/:name/yaml', async () => {
    const client = makeClient();
    client.get.mockResolvedValue('name: coding-agent\n');
    const result = await buildRavnPersonaAdapter(client).getPersonaYaml('coding-agent');
    expect(client.get).toHaveBeenCalledWith('/personas/coding-agent/yaml');
    expect(result).toBe('name: coding-agent\n');
  });
});

// ---------------------------------------------------------------------------
// createPersona
// ---------------------------------------------------------------------------

describe('createPersona', () => {
  const req: PersonaCreateRequest = {
    name: 'new-agent',
    systemPromptTemplate: 'You are helpful.',
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
  };

  it('calls POST /personas', async () => {
    const client = makeClient();
    client.post.mockResolvedValue(rawDetail);
    await buildRavnPersonaAdapter(client).createPersona(req);
    expect(client.post).toHaveBeenCalledWith('/personas', expect.any(Object));
  });

  it('converts camelCase request to snake_case body', async () => {
    const client = makeClient();
    client.post.mockResolvedValue(rawDetail);
    await buildRavnPersonaAdapter(client).createPersona(req);
    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'new-agent',
      system_prompt_template: 'You are helpful.',
      allowed_tools: ['file'],
      permission_mode: 'read-only',
      iteration_budget: 10,
      llm_primary_alias: 'balanced',
      llm_thinking_enabled: false,
      llm_max_tokens: 0,
    });
  });

  it('returns a camelCase PersonaDetail', async () => {
    const client = makeClient();
    client.post.mockResolvedValue(rawDetail);
    const result = await buildRavnPersonaAdapter(client).createPersona(req);
    expect(result.systemPromptTemplate).toBe('You are a coder.');
    expect(result.llm.primaryAlias).toBe('balanced');
  });
});

// ---------------------------------------------------------------------------
// updatePersona
// ---------------------------------------------------------------------------

describe('updatePersona', () => {
  const req: PersonaCreateRequest = {
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
  };

  it('calls PUT /personas/:name', async () => {
    const client = makeClient();
    client.put.mockResolvedValue(rawDetail);
    await buildRavnPersonaAdapter(client).updatePersona('coding-agent', req);
    expect(client.put).toHaveBeenCalledWith('/personas/coding-agent', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// deletePersona
// ---------------------------------------------------------------------------

describe('deletePersona', () => {
  it('calls DELETE /personas/:name', async () => {
    const client = makeClient();
    client.delete.mockResolvedValue(undefined);
    await buildRavnPersonaAdapter(client).deletePersona('my-agent');
    expect(client.delete).toHaveBeenCalledWith('/personas/my-agent');
  });
});

// ---------------------------------------------------------------------------
// forkPersona
// ---------------------------------------------------------------------------

describe('forkPersona', () => {
  it('calls POST /personas/:name/fork', async () => {
    const client = makeClient();
    client.post.mockResolvedValue(rawDetail);
    await buildRavnPersonaAdapter(client).forkPersona('coding-agent', { newName: 'my-fork' });
    expect(client.post).toHaveBeenCalledWith('/personas/coding-agent/fork', expect.any(Object));
  });

  it('sends new_name in request body', async () => {
    const client = makeClient();
    client.post.mockResolvedValue(rawDetail);
    await buildRavnPersonaAdapter(client).forkPersona('coding-agent', { newName: 'my-fork' });
    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.new_name).toBe('my-fork');
  });

  it('returns a PersonaDetail for the forked persona', async () => {
    const client = makeClient();
    client.post.mockResolvedValue(rawDetail);
    const result = await buildRavnPersonaAdapter(client).forkPersona('coding-agent', {
      newName: 'my-fork',
    });
    expect(result.name).toBe('coding-agent');
  });
});

// ---------------------------------------------------------------------------
// Interface compliance
// ---------------------------------------------------------------------------

describe('buildRavnPersonaAdapter', () => {
  it('satisfies the IPersonaStore interface', () => {
    const client = makeClient();
    const store: IPersonaStore = buildRavnPersonaAdapter(client);
    expect(typeof store.listPersonas).toBe('function');
    expect(typeof store.getPersona).toBe('function');
    expect(typeof store.getPersonaYaml).toBe('function');
    expect(typeof store.createPersona).toBe('function');
    expect(typeof store.updatePersona).toBe('function');
    expect(typeof store.deletePersona).toBe('function');
    expect(typeof store.forkPersona).toBe('function');
  });
});
