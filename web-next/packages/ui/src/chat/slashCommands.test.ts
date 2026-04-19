import { buildCommandList } from './slashCommands';

describe('buildCommandList', () => {
  it('returns empty array when both inputs are empty', () => {
    expect(buildCommandList([], [])).toEqual([]);
  });

  it('maps slash commands with type "command"', () => {
    const result = buildCommandList(['init', 'deploy'], []);
    expect(result).toEqual([
      { name: 'init', type: 'command' },
      { name: 'deploy', type: 'command' },
    ]);
  });

  it('maps skills with type "skill"', () => {
    const result = buildCommandList([], ['review', 'test']);
    expect(result).toEqual([
      { name: 'review', type: 'skill' },
      { name: 'test', type: 'skill' },
    ]);
  });

  it('returns commands before skills in mixed input', () => {
    const result = buildCommandList(['cmd1'], ['skill1']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'cmd1', type: 'command' });
    expect(result[1]).toEqual({ name: 'skill1', type: 'skill' });
  });

  it('preserves order of commands', () => {
    const cmds = ['a', 'b', 'c'];
    const result = buildCommandList(cmds, []);
    expect(result.map(r => r.name)).toEqual(['a', 'b', 'c']);
  });

  it('preserves order of skills', () => {
    const skills = ['x', 'y', 'z'];
    const result = buildCommandList([], skills);
    expect(result.map(r => r.name)).toEqual(['x', 'y', 'z']);
  });

  it('handles single command and single skill', () => {
    const result = buildCommandList(['deploy'], ['analyze']);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'deploy', type: 'command' });
    expect(result[1]).toMatchObject({ name: 'analyze', type: 'skill' });
  });
});
