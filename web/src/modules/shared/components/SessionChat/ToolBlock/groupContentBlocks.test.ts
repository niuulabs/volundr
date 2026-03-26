import { describe, it, expect } from 'vitest';
import { groupContentBlocks } from './groupContentBlocks';
import type { ContentBlock } from './groupContentBlocks';

describe('groupContentBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(groupContentBlocks([])).toEqual([]);
  });

  it('wraps a single tool_use as a SingleBlock', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
    ];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('single');
    if (result[0].kind === 'single') {
      expect(result[0].block.name).toBe('Bash');
    }
  });

  it('groups consecutive same-name tool_use blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/b.ts' } },
      { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/c.ts' } },
    ];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');
    if (result[0].kind === 'group') {
      expect(result[0].toolName).toBe('Read');
      expect(result[0].blocks).toHaveLength(3);
    }
  });

  it('separates different tool names into distinct entries', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a.ts' } },
    ];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('single');
    expect(result[1].kind).toBe('single');
  });

  it('passes text blocks through as TextSegment', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'Hello world' }];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('text');
    if (result[0].kind === 'text') {
      expect(result[0].text).toBe('Hello world');
    }
  });

  it('attaches tool_result to preceding tool_use', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'hi' },
    ];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('single');
    if (result[0].kind === 'single') {
      expect(result[0].result).toBeDefined();
      expect(result[0].result?.content).toBe('hi');
    }
  });

  it('handles mixed text, tool_use, and tool_result blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Let me check...' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'file.txt' },
      { type: 'text', text: 'Found the file.' },
    ];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe('text');
    expect(result[1].kind).toBe('single');
    expect(result[2].kind).toBe('text');
  });

  it('flushes pending tool_use when text block appears', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/b.ts' } },
      { type: 'text', text: 'Here are the results:' },
    ];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('group');
    expect(result[1].kind).toBe('text');
  });

  it('handles tool_result without preceding tool_use (edge case)', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'orphan', content: 'orphaned result' },
    ];
    const result = groupContentBlocks(blocks);

    // tool_result with no pending tool_use is silently consumed
    expect(result).toHaveLength(0);
  });

  it('ignores unknown block types', () => {
    const blocks: ContentBlock[] = [{ type: 'unknown_type' }];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(0);
  });

  it('flushes pending before unknown block type', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'unknown_type' },
    ];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('single');
  });

  it('handles tool_use without id', () => {
    const blocks: ContentBlock[] = [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }];
    const result = groupContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('single');
  });
});
