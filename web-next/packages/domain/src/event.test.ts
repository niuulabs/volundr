import { describe, it, expect } from 'vitest';
import { eventSpecSchema, eventCatalogSchema } from './event.js';

const VALID_EVENT_SPEC = {
  name: 'code.changed',
  schema: { path: 'string', diff: 'string', language: 'string' },
};

describe('eventSpecSchema', () => {
  it('round-trips a valid event spec', () => {
    const parsed = eventSpecSchema.parse(VALID_EVENT_SPEC);
    expect(parsed).toEqual(VALID_EVENT_SPEC);
  });

  it('round-trips with empty schema', () => {
    const input = { name: 'heartbeat', schema: {} };
    expect(eventSpecSchema.parse(input)).toEqual(input);
  });

  it('preserves data through JSON round-trip', () => {
    const json = JSON.stringify(VALID_EVENT_SPEC);
    const parsed = eventSpecSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects empty name', () => {
    expect(() => eventSpecSchema.parse({ name: '', schema: {} })).toThrow();
  });

  it('rejects missing schema', () => {
    expect(() => eventSpecSchema.parse({ name: 'test' })).toThrow();
  });
});

describe('eventCatalogSchema', () => {
  it('round-trips a catalog with multiple events', () => {
    const catalog = [
      VALID_EVENT_SPEC,
      { name: 'review.done', schema: { verdict: 'string', score: 'number' } },
      { name: 'deploy.complete', schema: { env: 'string', success: 'boolean' } },
    ];
    const parsed = eventCatalogSchema.parse(catalog);
    expect(parsed).toEqual(catalog);
  });

  it('round-trips an empty catalog', () => {
    expect(eventCatalogSchema.parse([])).toEqual([]);
  });

  it('preserves data through JSON round-trip', () => {
    const catalog = [VALID_EVENT_SPEC];
    const json = JSON.stringify(catalog);
    const parsed = eventCatalogSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects catalog with invalid event', () => {
    expect(() => eventCatalogSchema.parse([{ name: '' }])).toThrow();
  });
});
