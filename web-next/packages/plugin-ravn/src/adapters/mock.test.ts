import { describe, it, expect, beforeEach } from 'vitest';
import { createMockRavnService } from './mock';
import type { IRavnService } from '../ports';

let svc: IRavnService;

beforeEach(() => {
  svc = createMockRavnService();
});

// ---------------------------------------------------------------------------
// Persona store
// ---------------------------------------------------------------------------

describe('mock persona store — listPersonas', () => {
  it('returns all 21 builtin personas by default', async () => {
    const result = await svc.personas.listPersonas();
    expect(result.length).toBeGreaterThanOrEqual(21);
  });

  it('returns only builtins when filter=builtin', async () => {
    const result = await svc.personas.listPersonas('builtin');
    expect(result.every((p) => p.isBuiltin)).toBe(true);
    expect(result.length).toBe(21);
  });

  it('returns empty list for custom when none created', async () => {
    const result = await svc.personas.listPersonas('custom');
    expect(result).toHaveLength(0);
  });

  it('includes custom personas in all filter', async () => {
    await svc.personas.createPersona({
      name: 'my-agent',
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
    const all = await svc.personas.listPersonas('all');
    const custom = await svc.personas.listPersonas('custom');
    expect(all.length).toBe(22);
    expect(custom).toHaveLength(1);
    expect(custom[0]?.name).toBe('my-agent');
  });
});

describe('mock persona store — getPersona', () => {
  it('returns detail for a builtin persona', async () => {
    const result = await svc.personas.getPersona('coding-agent');
    expect(result.name).toBe('coding-agent');
    expect(result.systemPromptTemplate).toBeTruthy();
    expect(result.llm).toHaveProperty('primaryAlias');
  });

  it('throws for unknown persona', async () => {
    await expect(svc.personas.getPersona('nonexistent')).rejects.toThrow('"nonexistent" not found');
  });

  it('returns custom persona after creation', async () => {
    await svc.personas.createPersona({
      name: 'custom-one',
      systemPromptTemplate: 'Custom template',
      allowedTools: [],
      forbiddenTools: [],
      permissionMode: 'safe',
      iterationBudget: 5,
      llmPrimaryAlias: 'fast',
      llmThinkingEnabled: true,
      llmMaxTokens: 1024,
      producesEventType: 'custom.done',
      consumesEventTypes: ['custom.start'],
      consumesInjects: ['repo'],
      fanInStrategy: 'any_passes',
      fanInContributesTo: '',
    });
    const result = await svc.personas.getPersona('custom-one');
    expect(result.name).toBe('custom-one');
    expect(result.llm.thinkingEnabled).toBe(true);
    expect(result.llm.maxTokens).toBe(1024);
  });
});

describe('mock persona store — getPersonaYaml', () => {
  it('returns yaml string for builtin', async () => {
    const result = await svc.personas.getPersonaYaml('coder');
    expect(typeof result).toBe('string');
    expect(result).toContain('coder');
  });

  it('throws for unknown persona', async () => {
    await expect(svc.personas.getPersonaYaml('ghost')).rejects.toThrow();
  });
});

describe('mock persona store — updatePersona', () => {
  it('updates a custom persona', async () => {
    await svc.personas.createPersona({
      name: 'updatable',
      systemPromptTemplate: 'original',
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
    const updated = await svc.personas.updatePersona('updatable', {
      name: 'updatable',
      systemPromptTemplate: 'updated',
      allowedTools: ['file', 'git'],
      forbiddenTools: [],
      permissionMode: 'workspace-write',
      iterationBudget: 20,
      llmPrimaryAlias: 'large',
      llmThinkingEnabled: true,
      llmMaxTokens: 2048,
      producesEventType: '',
      consumesEventTypes: [],
      consumesInjects: [],
      fanInStrategy: 'merge',
      fanInContributesTo: '',
    });
    expect(updated.systemPromptTemplate).toBe('updated');
    expect(updated.iterationBudget).toBe(20);
  });

  it('updates produces/consumes/fanIn fields', async () => {
    await svc.personas.createPersona({
      name: 'event-driven',
      systemPromptTemplate: 'base',
      allowedTools: [],
      forbiddenTools: [],
      permissionMode: 'read-only',
      iterationBudget: 5,
      llmPrimaryAlias: 'balanced',
      llmThinkingEnabled: false,
      llmMaxTokens: 0,
      producesEventType: 'original.event',
      consumesEventTypes: ['a'],
      consumesInjects: ['x'],
      fanInStrategy: 'first',
      fanInContributesTo: 'group-a',
    });
    const updated = await svc.personas.updatePersona('event-driven', {
      name: 'event-driven',
      systemPromptTemplate: 'base',
      allowedTools: [],
      forbiddenTools: [],
      permissionMode: 'read-only',
      iterationBudget: 5,
      llmPrimaryAlias: 'balanced',
      llmThinkingEnabled: false,
      llmMaxTokens: 0,
      producesEventType: 'updated.event',
      consumesEventTypes: ['b', 'c'],
      consumesInjects: ['y'],
      fanInStrategy: 'merge',
      fanInContributesTo: 'group-b',
    });
    expect(updated.producesEvent).toBe('updated.event');
    expect(updated.consumesEvents).toEqual(['b', 'c']);
    expect(updated.produces.eventType).toBe('updated.event');
    expect(updated.consumes.eventTypes).toEqual(['b', 'c']);
    expect(updated.consumes.injects).toEqual(['y']);
    expect(updated.fanIn.strategy).toBe('merge');
    expect(updated.fanIn.contributesTo).toBe('group-b');
  });

  it('throws when updating nonexistent or builtin persona', async () => {
    await expect(
      svc.personas.updatePersona('coding-agent', {
        name: 'coding-agent',
        systemPromptTemplate: '',
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
      }),
    ).rejects.toThrow();
  });
});

describe('mock persona store — deletePersona', () => {
  it('deletes a custom persona', async () => {
    await svc.personas.createPersona({
      name: 'deletable',
      systemPromptTemplate: '',
      allowedTools: [],
      forbiddenTools: [],
      permissionMode: 'read-only',
      iterationBudget: 5,
      llmPrimaryAlias: 'balanced',
      llmThinkingEnabled: false,
      llmMaxTokens: 0,
      producesEventType: '',
      consumesEventTypes: [],
      consumesInjects: [],
      fanInStrategy: 'merge',
      fanInContributesTo: '',
    });
    await svc.personas.deletePersona('deletable');
    const customs = await svc.personas.listPersonas('custom');
    expect(customs.find((p) => p.name === 'deletable')).toBeUndefined();
  });

  it('throws when deleting a builtin persona', async () => {
    await expect(svc.personas.deletePersona('coder')).rejects.toThrow();
  });
});

describe('mock persona store — forkPersona', () => {
  it('forks a builtin persona under a new name', async () => {
    const forked = await svc.personas.forkPersona('coder', { newName: 'my-coder' });
    expect(forked.name).toBe('my-coder');
    expect(forked.isBuiltin).toBe(false);
    expect(forked.allowedTools).toEqual(expect.arrayContaining(['file', 'git']));
  });

  it('forked persona appears in custom list', async () => {
    await svc.personas.forkPersona('reviewer', { newName: 'my-reviewer' });
    const customs = await svc.personas.listPersonas('custom');
    expect(customs.find((p) => p.name === 'my-reviewer')).toBeDefined();
  });

  it('throws when forking nonexistent persona', async () => {
    await expect(svc.personas.forkPersona('ghost', { newName: 'ghost-fork' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Raven stream
// ---------------------------------------------------------------------------

describe('mock raven stream', () => {
  it('lists all 5 seed ravens', async () => {
    const ravens = await svc.ravens.listRavens();
    expect(ravens).toHaveLength(5);
  });

  it('returns raven by id', async () => {
    const raven = await svc.ravens.getRaven('r1');
    expect(raven.name).toBe('coder-asgard');
    expect(raven.state).toBe('active');
    expect(raven.mounts.length).toBeGreaterThan(0);
  });

  it('throws for unknown raven id', async () => {
    await expect(svc.ravens.getRaven('r999')).rejects.toThrow('"r999" not found');
  });

  it('ravens have valid budget', async () => {
    const ravens = await svc.ravens.listRavens();
    for (const r of ravens) {
      expect(r.budget.spentUsd).toBeGreaterThanOrEqual(0);
      expect(r.budget.capUsd).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Session stream
// ---------------------------------------------------------------------------

describe('mock session stream', () => {
  it('lists all sessions', async () => {
    const sessions = await svc.sessions.listSessions();
    expect(sessions).toHaveLength(3);
  });

  it('filters sessions by ravnId', async () => {
    const sessions = await svc.sessions.listSessions('r1');
    expect(sessions.every((s) => s.ravnId === 'r1')).toBe(true);
    expect(sessions).toHaveLength(1);
  });

  it('returns empty array for raven with no sessions', async () => {
    const sessions = await svc.sessions.listSessions('r5');
    expect(sessions).toHaveLength(0);
  });

  it('returns session by id', async () => {
    const session = await svc.sessions.getSession('s1');
    expect(session.title).toBe('implement auth middleware');
    expect(session.state).toBe('active');
  });

  it('throws for unknown session id', async () => {
    await expect(svc.sessions.getSession('s999')).rejects.toThrow('"s999" not found');
  });

  it('returns messages for a session', async () => {
    const messages = await svc.sessions.getMessages('s1');
    expect(messages.length).toBeGreaterThan(0);
    const kinds = messages.map((m) => m.kind);
    expect(kinds).toContain('user');
    expect(kinds).toContain('asst');
    expect(kinds).toContain('think');
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('emit');
  });

  it('returns empty messages for session with none', async () => {
    const messages = await svc.sessions.getMessages('s3');
    expect(messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Trigger store
// ---------------------------------------------------------------------------

describe('mock trigger store', () => {
  it('lists all seed triggers', async () => {
    const triggers = await svc.triggers.listTriggers();
    expect(triggers.length).toBeGreaterThanOrEqual(6);
  });

  it('filters triggers by ravnId', async () => {
    const triggers = await svc.triggers.listTriggers('r4');
    expect(triggers.every((t) => t.ravnId === 'r4')).toBe(true);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('creates a cron trigger', async () => {
    const created = await svc.triggers.createTrigger({
      ravnId: 'r2',
      kind: 'cron',
      schedule: '0 8 * * *',
      description: 'daily morning run',
    });
    expect(created.kind).toBe('cron');
    expect(created.id).toBeTruthy();
    const all = await svc.triggers.listTriggers('r2');
    expect(all.find((t) => t.id === created.id)).toBeDefined();
  });

  it('creates a manual trigger', async () => {
    const created = await svc.triggers.createTrigger({ ravnId: 'r3', kind: 'manual' });
    expect(created.kind).toBe('manual');
  });

  it('deletes a created trigger', async () => {
    const created = await svc.triggers.createTrigger({ ravnId: 'r1', kind: 'manual' });
    await svc.triggers.deleteTrigger(created.id);
    const all = await svc.triggers.listTriggers('r1');
    expect(all.find((t) => t.id === created.id)).toBeUndefined();
  });

  it('throws when deleting a seed trigger', async () => {
    await expect(svc.triggers.deleteTrigger('trig1')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Budget stream
// ---------------------------------------------------------------------------

describe('mock budget stream', () => {
  it('returns fleet budget', async () => {
    const budget = await svc.budget.getFleetBudget();
    expect(budget.spentUsd).toBeGreaterThan(0);
    expect(budget.capUsd).toBeGreaterThan(budget.spentUsd);
  });

  it('returns raven budget by id', async () => {
    const budget = await svc.budget.getRavenBudget('r1');
    expect(budget.capUsd).toBe(10.0);
    expect(budget.spentUsd).toBe(2.4);
  });

  it('throws for unknown raven', async () => {
    await expect(svc.budget.getRavenBudget('r999')).rejects.toThrow('"r999" not found');
  });
});
