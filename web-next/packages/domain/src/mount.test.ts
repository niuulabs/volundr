import { describe, it, expect } from 'vitest';
import { mountRoleSchema, mountStatusSchema, mountSchema } from './mount.js';

const VALID_MOUNT = {
  name: 'asgard-shared',
  role: 'shared' as const,
  host: 'mimir-shared.asgard.niuu.internal',
  url: 'https://mimir-shared.asgard.niuu.internal',
  priority: 10,
  categories: ['ops', 'infra'],
  status: 'healthy' as const,
  pages: 1234,
  sources: 567,
  lintIssues: 3,
  lastWrite: '2026-04-19T10:30:00Z',
  embedding: 'all-MiniLM-L6-v2',
  sizeKb: 48200,
  desc: 'Shared Asgard knowledge mount',
};

describe('mountRoleSchema', () => {
  it('accepts all valid roles', () => {
    for (const role of ['local', 'shared', 'domain']) {
      expect(mountRoleSchema.parse(role)).toBe(role);
    }
  });

  it('rejects invalid roles', () => {
    expect(() => mountRoleSchema.parse('global')).toThrow();
  });
});

describe('mountStatusSchema', () => {
  it('accepts all valid statuses', () => {
    for (const status of ['healthy', 'degraded', 'down']) {
      expect(mountStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects invalid statuses', () => {
    expect(() => mountStatusSchema.parse('unknown')).toThrow();
  });
});

describe('mountSchema', () => {
  it('round-trips a full mount', () => {
    const parsed = mountSchema.parse(VALID_MOUNT);
    expect(parsed).toEqual(VALID_MOUNT);
  });

  it('round-trips with null categories', () => {
    const mount = { ...VALID_MOUNT, categories: null };
    const parsed = mountSchema.parse(mount);
    expect(parsed).toEqual(mount);
    expect(parsed.categories).toBeNull();
  });

  it('preserves data through JSON round-trip', () => {
    const json = JSON.stringify(VALID_MOUNT);
    const parsed = mountSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects missing required fields', () => {
    const { name, ...noName } = VALID_MOUNT;
    void name;
    expect(() => mountSchema.parse(noName)).toThrow();
  });

  it('rejects invalid url', () => {
    expect(() => mountSchema.parse({ ...VALID_MOUNT, url: 'not-a-url' })).toThrow();
  });

  it('rejects negative priority', () => {
    expect(() => mountSchema.parse({ ...VALID_MOUNT, priority: -1 })).toThrow();
  });

  it('rejects negative page count', () => {
    expect(() => mountSchema.parse({ ...VALID_MOUNT, pages: -5 })).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => mountSchema.parse({ ...VALID_MOUNT, status: 'offline' })).toThrow();
  });
});
