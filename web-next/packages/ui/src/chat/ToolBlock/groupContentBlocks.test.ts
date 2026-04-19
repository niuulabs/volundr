import {
  groupContentBlocks,
  type ContentBlock,
  type SingleBlock,
  type GroupedBlocks,
  type TextSegment,
} from './groupContentBlocks';

describe('groupContentBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(groupContentBlocks([])).toEqual([]);
  });

  it('passes through a text block as TextSegment', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hello world' }];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'text', text: 'hello world' });
  });

  it('converts a single tool_use into a SingleBlock', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: '1', name: 'Bash', input: { command: 'ls' } },
    ];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(1);
    const single = result[0] as SingleBlock;
    expect(single.kind).toBe('single');
    expect(single.block.name).toBe('Bash');
  });

  it('groups consecutive same-name tool_use blocks into GroupedBlocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: '2', name: 'Read', input: { file_path: 'b.ts' } },
    ];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(1);
    const group = result[0] as GroupedBlocks;
    expect(group.kind).toBe('group');
    expect(group.toolName).toBe('Read');
    expect(group.blocks).toHaveLength(2);
  });

  it('flushes to separate groups for different tool names', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: '2', name: 'Bash', input: { command: 'ls' } },
    ];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(2);
    expect((result[0] as SingleBlock).kind).toBe('single');
    expect((result[0] as SingleBlock).block.name).toBe('Read');
    expect((result[1] as SingleBlock).kind).toBe('single');
    expect((result[1] as SingleBlock).block.name).toBe('Bash');
  });

  it('attaches tool_result to the preceding tool_use', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: '1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', tool_use_id: '1', content: 'file1.ts\nfile2.ts' },
    ];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(1);
    const single = result[0] as SingleBlock;
    expect(single.kind).toBe('single');
    expect(single.result).toBeDefined();
    expect(single.result?.content).toBe('file1.ts\nfile2.ts');
  });

  it('attaches tool_result within a group', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool_result', tool_use_id: '1', content: 'content-a' },
      { type: 'tool_use', id: '2', name: 'Read', input: { file_path: 'b.ts' } },
      { type: 'tool_result', tool_use_id: '2', content: 'content-b' },
    ];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(1);
    const group = result[0] as GroupedBlocks;
    expect(group.kind).toBe('group');
    expect(group.blocks[0]?.result?.content).toBe('content-a');
    expect(group.blocks[1]?.result?.content).toBe('content-b');
  });

  it('handles mixed content: text, tool_use, tool_result, text', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'intro' },
      { type: 'tool_use', id: '1', name: 'Bash', input: { command: 'echo hi' } },
      { type: 'tool_result', tool_use_id: '1', content: 'hi' },
      { type: 'text', text: 'outro' },
    ];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(3);
    expect((result[0] as TextSegment).kind).toBe('text');
    expect((result[0] as TextSegment).text).toBe('intro');
    expect((result[1] as SingleBlock).kind).toBe('single');
    expect((result[1] as SingleBlock).result?.content).toBe('hi');
    expect((result[2] as TextSegment).kind).toBe('text');
    expect((result[2] as TextSegment).text).toBe('outro');
  });

  it('flushes group when text block appears mid-stream', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: '2', name: 'Read', input: { file_path: 'b.ts' } },
      { type: 'text', text: 'between' },
      { type: 'tool_use', id: '3', name: 'Read', input: { file_path: 'c.ts' } },
    ];
    const result = groupContentBlocks(blocks);
    expect(result).toHaveLength(3);
    expect((result[0] as GroupedBlocks).kind).toBe('group');
    expect((result[1] as TextSegment).kind).toBe('text');
    expect((result[2] as SingleBlock).kind).toBe('single');
  });
});
