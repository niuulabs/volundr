import { describe, it, expect } from 'vitest';
import {
  personaRoleSchema,
  permissionModeSchema,
  mimirWriteRoutingSchema,
  fanInStrategyNameSchema,
  fanInConfigSchema,
  personaLlmSchema,
  consumedEventSchema,
  personaProducesSchema,
  personaConsumesSchema,
  personaSchema,
} from './persona.js';

const VALID_PERSONA = {
  name: 'Fjölnir',
  role: 'index' as const,
  color: '#a855f7',
  letter: 'F',
  summary: 'Knowledge indexer and compiler',
  description: 'Fjölnir reads sources, extracts entities, and compiles pages.',
  llm: { alias: 'claude-3-opus', thinking: true, maxTokens: 4096, temperature: 0.7 },
  permissionMode: 'safe' as const,
  allowed: ['read', 'mimir.write', 'mimir.read'],
  forbidden: ['bash', 'write'],
  produces: { event: 'index.complete', schema: { pages: 'number', entities: 'number' } },
  consumes: {
    events: [
      { name: 'source.ingested', injects: ['source_text'], trust: 0.8 },
      { name: 'dream.start' },
    ],
  },
  fanIn: { strategy: 'merge' as const, params: { dedup: true } },
  mimirWriteRouting: 'shared' as const,
};

describe('personaRoleSchema', () => {
  it('accepts all valid roles', () => {
    const roles = ['plan', 'build', 'verify', 'review', 'gate', 'audit', 'ship', 'index', 'report'];
    for (const role of roles) {
      expect(personaRoleSchema.parse(role)).toBe(role);
    }
  });

  it('rejects invalid roles', () => {
    expect(() => personaRoleSchema.parse('wizard')).toThrow();
  });
});

describe('permissionModeSchema', () => {
  it('accepts all valid modes', () => {
    for (const mode of ['default', 'safe', 'loose']) {
      expect(permissionModeSchema.parse(mode)).toBe(mode);
    }
  });

  it('rejects invalid modes', () => {
    expect(() => permissionModeSchema.parse('admin')).toThrow();
  });
});

describe('mimirWriteRoutingSchema', () => {
  it('accepts all valid routings', () => {
    for (const routing of ['local', 'shared', 'domain']) {
      expect(mimirWriteRoutingSchema.parse(routing)).toBe(routing);
    }
  });

  it('rejects invalid routings', () => {
    expect(() => mimirWriteRoutingSchema.parse('global')).toThrow();
  });
});

describe('fanInStrategyNameSchema', () => {
  it('accepts all valid strategies', () => {
    const strategies = [
      'all_must_pass',
      'any_passes',
      'quorum',
      'merge',
      'first_wins',
      'weighted_score',
    ];
    for (const s of strategies) {
      expect(fanInStrategyNameSchema.parse(s)).toBe(s);
    }
  });

  it('rejects invalid strategies', () => {
    expect(() => fanInStrategyNameSchema.parse('random')).toThrow();
  });
});

describe('fanInConfigSchema', () => {
  it('round-trips a valid config', () => {
    const input = { strategy: 'quorum' as const, params: { n: 3, timeoutMs: 5000 } };
    const parsed = fanInConfigSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  it('rejects missing strategy', () => {
    expect(() => fanInConfigSchema.parse({ params: {} })).toThrow();
  });
});

describe('personaLlmSchema', () => {
  it('round-trips a valid LLM config with temperature', () => {
    const input = { alias: 'claude-3-opus', thinking: true, maxTokens: 4096, temperature: 0.7 };
    expect(personaLlmSchema.parse(input)).toEqual(input);
  });

  it('round-trips without optional temperature', () => {
    const input = { alias: 'gpt-4', thinking: false, maxTokens: 2048 };
    expect(personaLlmSchema.parse(input)).toEqual(input);
  });

  it('rejects empty alias', () => {
    expect(() => personaLlmSchema.parse({ alias: '', thinking: true, maxTokens: 1 })).toThrow();
  });

  it('rejects non-positive maxTokens', () => {
    expect(() =>
      personaLlmSchema.parse({ alias: 'model', thinking: true, maxTokens: 0 }),
    ).toThrow();
  });

  it('rejects temperature out of range', () => {
    expect(() =>
      personaLlmSchema.parse({ alias: 'model', thinking: true, maxTokens: 1, temperature: 3 }),
    ).toThrow();
  });
});

describe('consumedEventSchema', () => {
  it('round-trips with all fields', () => {
    const input = { name: 'code.changed', injects: ['diff', 'path'], trust: 0.9 };
    expect(consumedEventSchema.parse(input)).toEqual(input);
  });

  it('round-trips with only required fields', () => {
    const input = { name: 'code.changed' };
    expect(consumedEventSchema.parse(input)).toEqual(input);
  });

  it('rejects empty name', () => {
    expect(() => consumedEventSchema.parse({ name: '' })).toThrow();
  });

  it('rejects trust out of range', () => {
    expect(() => consumedEventSchema.parse({ name: 'x', trust: 1.5 })).toThrow();
  });
});

describe('personaProducesSchema', () => {
  it('round-trips a valid produces spec', () => {
    const input = { event: 'review.done', schema: { verdict: 'string', score: 'number' } };
    expect(personaProducesSchema.parse(input)).toEqual(input);
  });

  it('rejects empty event name', () => {
    expect(() => personaProducesSchema.parse({ event: '', schema: {} })).toThrow();
  });
});

describe('personaConsumesSchema', () => {
  it('round-trips with multiple events', () => {
    const input = {
      events: [
        { name: 'code.changed', trust: 0.8 },
        { name: 'review.requested', injects: ['pr_body'] },
      ],
    };
    expect(personaConsumesSchema.parse(input)).toEqual(input);
  });

  it('round-trips with empty events array', () => {
    const input = { events: [] };
    expect(personaConsumesSchema.parse(input)).toEqual(input);
  });
});

describe('personaSchema', () => {
  it('round-trips a full persona', () => {
    const parsed = personaSchema.parse(VALID_PERSONA);
    expect(parsed).toEqual(VALID_PERSONA);
  });

  it('round-trips without optional fields', () => {
    const { fanIn, mimirWriteRouting, ...minimal } = VALID_PERSONA;
    void fanIn;
    void mimirWriteRouting;
    const parsed = personaSchema.parse(minimal);
    expect(parsed).toEqual(minimal);
  });

  it('preserves data through JSON round-trip', () => {
    const json = JSON.stringify(VALID_PERSONA);
    const parsed = personaSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects missing required fields', () => {
    const { name, ...noName } = VALID_PERSONA;
    void name;
    expect(() => personaSchema.parse(noName)).toThrow();
  });

  it('rejects invalid role', () => {
    expect(() => personaSchema.parse({ ...VALID_PERSONA, role: 'wizard' })).toThrow();
  });

  it('rejects letter longer than 1 char', () => {
    expect(() => personaSchema.parse({ ...VALID_PERSONA, letter: 'AB' })).toThrow();
  });
});
