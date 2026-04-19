import { describe, it, expect } from 'vitest';
import {
  ravenStateSchema,
  ravenMountSchema,
  ravenSchema,
  messageKindSchema,
  messageSchema,
  sessionStateSchema,
  sessionSchema,
  cronTriggerSchema,
  eventTriggerSchema,
  webhookTriggerSchema,
  manualTriggerSchema,
  triggerSchema,
} from './domain';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validMount = { name: 'local', role: 'primary' as const, priority: 0 };

const validRaven = {
  id: 'r1',
  name: 'coder-asgard',
  rune: 'ᚱ',
  persona: 'coding-agent',
  location: 'asgard',
  deployment: 'k8s',
  state: 'active' as const,
  uptime: 7200,
  lastTick: '2026-04-19T09:55:00Z',
  budget: { spentUsd: 2.4, capUsd: 10.0, warnAt: 8.0 },
  mounts: [validMount],
};

const validMessage = {
  id: 'm1',
  sessionId: 's1',
  kind: 'user' as const,
  body: 'hello',
  ts: '2026-04-19T09:00:00Z',
};

const validSession = {
  id: 's1',
  ravnId: 'r1',
  title: 'implement auth',
  state: 'active' as const,
  startedAt: '2026-04-19T09:00:00Z',
  messages: [validMessage],
};

// ---------------------------------------------------------------------------
// ravenStateSchema
// ---------------------------------------------------------------------------

describe('ravenStateSchema', () => {
  it('accepts all valid states', () => {
    for (const s of ['active', 'idle', 'suspended', 'failed']) {
      expect(ravenStateSchema.parse(s)).toBe(s);
    }
  });

  it('rejects unknown state', () => {
    expect(() => ravenStateSchema.parse('flying')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ravenMountSchema
// ---------------------------------------------------------------------------

describe('ravenMountSchema', () => {
  it('parses a valid mount', () => {
    const result = ravenMountSchema.parse(validMount);
    expect(result.name).toBe('local');
    expect(result.role).toBe('primary');
    expect(result.priority).toBe(0);
  });

  it('accepts all role values', () => {
    for (const role of ['primary', 'archive', 'ro']) {
      expect(ravenMountSchema.parse({ ...validMount, role })).toMatchObject({ role });
    }
  });

  it('rejects negative priority', () => {
    expect(() => ravenMountSchema.parse({ ...validMount, priority: -1 })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => ravenMountSchema.parse({ ...validMount, name: '' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ravenSchema
// ---------------------------------------------------------------------------

describe('ravenSchema', () => {
  it('parses a valid raven', () => {
    const result = ravenSchema.parse(validRaven);
    expect(result.id).toBe('r1');
    expect(result.state).toBe('active');
    expect(result.mounts).toHaveLength(1);
  });

  it('round-trips through parse', () => {
    const result = ravenSchema.parse(validRaven);
    expect(ravenSchema.parse(result)).toEqual(result);
  });

  it('rejects negative uptime', () => {
    expect(() => ravenSchema.parse({ ...validRaven, uptime: -1 })).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => ravenSchema.parse({ ...validRaven, id: '' })).toThrow();
  });

  it('rejects invalid budget', () => {
    expect(() =>
      ravenSchema.parse({ ...validRaven, budget: { spentUsd: -1, capUsd: 10, warnAt: 8 } }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// messageKindSchema
// ---------------------------------------------------------------------------

describe('messageKindSchema', () => {
  it('accepts all 7 kinds', () => {
    for (const k of ['user', 'asst', 'system', 'tool_call', 'tool_result', 'emit', 'think']) {
      expect(messageKindSchema.parse(k)).toBe(k);
    }
  });

  it('rejects unknown kind', () => {
    expect(() => messageKindSchema.parse('narrate')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// messageSchema
// ---------------------------------------------------------------------------

describe('messageSchema', () => {
  it('parses minimal message', () => {
    const result = messageSchema.parse(validMessage);
    expect(result.kind).toBe('user');
    expect(result.toolName).toBeUndefined();
    expect(result.eventName).toBeUndefined();
  });

  it('parses tool_call message with toolName', () => {
    const msg = { ...validMessage, kind: 'tool_call', toolName: 'read' };
    const result = messageSchema.parse(msg);
    expect(result.toolName).toBe('read');
  });

  it('parses emit message with eventName', () => {
    const msg = { ...validMessage, kind: 'emit', eventName: 'code.changed' };
    const result = messageSchema.parse(msg);
    expect(result.eventName).toBe('code.changed');
  });

  it('round-trips through parse', () => {
    const result = messageSchema.parse(validMessage);
    expect(messageSchema.parse(result)).toEqual(result);
  });

  it('rejects empty id', () => {
    expect(() => messageSchema.parse({ ...validMessage, id: '' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// sessionStateSchema
// ---------------------------------------------------------------------------

describe('sessionStateSchema', () => {
  it('accepts all 5 states', () => {
    for (const s of ['active', 'idle', 'suspended', 'failed', 'completed']) {
      expect(sessionStateSchema.parse(s)).toBe(s);
    }
  });

  it('rejects unknown state', () => {
    expect(() => sessionStateSchema.parse('pending')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// sessionSchema
// ---------------------------------------------------------------------------

describe('sessionSchema', () => {
  it('parses a valid session', () => {
    const result = sessionSchema.parse(validSession);
    expect(result.id).toBe('s1');
    expect(result.messages).toHaveLength(1);
    expect(result.triggerId).toBeUndefined();
    expect(result.lastAt).toBeUndefined();
  });

  it('parses session with optional fields', () => {
    const result = sessionSchema.parse({
      ...validSession,
      triggerId: 't1',
      lastAt: '2026-04-19T10:00:00Z',
    });
    expect(result.triggerId).toBe('t1');
    expect(result.lastAt).toBe('2026-04-19T10:00:00Z');
  });

  it('round-trips through parse', () => {
    const result = sessionSchema.parse(validSession);
    expect(sessionSchema.parse(result)).toEqual(result);
  });

  it('rejects empty ravnId', () => {
    expect(() => sessionSchema.parse({ ...validSession, ravnId: '' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Trigger schemas
// ---------------------------------------------------------------------------

describe('cronTriggerSchema', () => {
  const validCron = {
    id: 't1',
    ravnId: 'r1',
    kind: 'cron' as const,
    schedule: '0 * * * *',
    description: 'hourly health check',
  };

  it('parses a valid cron trigger', () => {
    const result = cronTriggerSchema.parse(validCron);
    expect(result.kind).toBe('cron');
    expect(result.schedule).toBe('0 * * * *');
  });

  it('rejects empty schedule', () => {
    expect(() => cronTriggerSchema.parse({ ...validCron, schedule: '' })).toThrow();
  });
});

describe('eventTriggerSchema', () => {
  const validEvent = {
    id: 't2',
    ravnId: 'r1',
    kind: 'event' as const,
    topic: 'code.changed',
    producesEvent: 'review.started',
  };

  it('parses a valid event trigger', () => {
    const result = eventTriggerSchema.parse(validEvent);
    expect(result.kind).toBe('event');
    expect(result.producesEvent).toBe('review.started');
  });

  it('allows omitting producesEvent', () => {
    const { producesEvent: _, ...noProduces } = validEvent;
    const result = eventTriggerSchema.parse(noProduces);
    expect(result.producesEvent).toBeUndefined();
  });
});

describe('webhookTriggerSchema', () => {
  const validWebhook = {
    id: 't3',
    ravnId: 'r1',
    kind: 'webhook' as const,
    path: '/hooks/github',
  };

  it('parses a valid webhook trigger', () => {
    const result = webhookTriggerSchema.parse(validWebhook);
    expect(result.kind).toBe('webhook');
    expect(result.path).toBe('/hooks/github');
  });

  it('rejects empty path', () => {
    expect(() => webhookTriggerSchema.parse({ ...validWebhook, path: '' })).toThrow();
  });
});

describe('manualTriggerSchema', () => {
  const validManual = { id: 't4', ravnId: 'r1', kind: 'manual' as const };

  it('parses a valid manual trigger', () => {
    const result = manualTriggerSchema.parse(validManual);
    expect(result.kind).toBe('manual');
  });
});

describe('triggerSchema (discriminated union)', () => {
  it('dispatches to correct variant by kind', () => {
    const cron = triggerSchema.parse({
      id: 't1',
      ravnId: 'r1',
      kind: 'cron',
      schedule: '0 * * * *',
      description: 'hourly',
    });
    expect(cron.kind).toBe('cron');

    const manual = triggerSchema.parse({ id: 't4', ravnId: 'r1', kind: 'manual' });
    expect(manual.kind).toBe('manual');
  });

  it('rejects unknown kind', () => {
    expect(() =>
      triggerSchema.parse({ id: 't9', ravnId: 'r1', kind: 'timer' }),
    ).toThrow();
  });

  it('round-trips all kinds', () => {
    const triggers = [
      { id: 't1', ravnId: 'r1', kind: 'cron' as const, schedule: '* * * * *', description: '' },
      { id: 't2', ravnId: 'r1', kind: 'event' as const, topic: 'code.changed' },
      { id: 't3', ravnId: 'r1', kind: 'webhook' as const, path: '/hook' },
      { id: 't4', ravnId: 'r1', kind: 'manual' as const },
    ];
    for (const t of triggers) {
      expect(triggerSchema.parse(triggerSchema.parse(t))).toEqual(triggerSchema.parse(t));
    }
  });
});
