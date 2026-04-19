import { describe, it, expect } from 'vitest';
import { toolGroupSchema, toolSchema, toolRegistrySchema } from './tool.js';

const VALID_TOOL = {
  id: 'git.checkout',
  group: 'git' as const,
  destructive: true,
  desc: 'Switch branches or restore working tree files',
};

describe('toolGroupSchema', () => {
  it('accepts all valid groups', () => {
    const groups = ['fs', 'shell', 'git', 'mimir', 'observe', 'security', 'bus'];
    for (const group of groups) {
      expect(toolGroupSchema.parse(group)).toBe(group);
    }
  });

  it('rejects invalid groups', () => {
    expect(() => toolGroupSchema.parse('network')).toThrow();
  });
});

describe('toolSchema', () => {
  it('round-trips a valid tool', () => {
    const parsed = toolSchema.parse(VALID_TOOL);
    expect(parsed).toEqual(VALID_TOOL);
  });

  it('preserves data through JSON round-trip', () => {
    const json = JSON.stringify(VALID_TOOL);
    const parsed = toolSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects empty id', () => {
    expect(() => toolSchema.parse({ ...VALID_TOOL, id: '' })).toThrow();
  });

  it('rejects missing destructive flag', () => {
    const { destructive, ...noDestructive } = VALID_TOOL;
    void destructive;
    expect(() => toolSchema.parse(noDestructive)).toThrow();
  });

  it('rejects invalid group', () => {
    expect(() => toolSchema.parse({ ...VALID_TOOL, group: 'network' })).toThrow();
  });
});

describe('toolRegistrySchema', () => {
  it('round-trips a registry with multiple tools', () => {
    const registry = [
      VALID_TOOL,
      { id: 'read', group: 'fs' as const, destructive: false, desc: 'Read a file' },
      { id: 'write', group: 'fs' as const, destructive: true, desc: 'Write a file' },
    ];
    const parsed = toolRegistrySchema.parse(registry);
    expect(parsed).toEqual(registry);
  });

  it('round-trips an empty registry', () => {
    expect(toolRegistrySchema.parse([])).toEqual([]);
  });

  it('preserves data through JSON round-trip', () => {
    const registry = [VALID_TOOL];
    const json = JSON.stringify(registry);
    const parsed = toolRegistrySchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it('rejects registry with invalid tool', () => {
    expect(() => toolRegistrySchema.parse([{ id: '' }])).toThrow();
  });
});
