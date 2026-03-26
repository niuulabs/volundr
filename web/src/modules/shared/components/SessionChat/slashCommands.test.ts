import { describe, it, expect } from 'vitest';
import { buildCommandList } from './slashCommands';

describe('buildCommandList', () => {
  it('builds commands from slash_commands and skills arrays', () => {
    const result = buildCommandList(['help', 'clear'], ['simplify', 'commit']);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ name: 'help', type: 'command' });
    expect(result[1]).toEqual({ name: 'clear', type: 'command' });
    expect(result[2]).toEqual({ name: 'simplify', type: 'skill' });
    expect(result[3]).toEqual({ name: 'commit', type: 'skill' });
  });

  it('returns empty array when both inputs are empty', () => {
    expect(buildCommandList([], [])).toEqual([]);
  });

  it('handles only slash_commands', () => {
    const result = buildCommandList(['help'], []);
    expect(result).toEqual([{ name: 'help', type: 'command' }]);
  });

  it('handles only skills', () => {
    const result = buildCommandList([], ['simplify']);
    expect(result).toEqual([{ name: 'simplify', type: 'skill' }]);
  });
});
