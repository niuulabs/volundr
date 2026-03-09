import { describe, it, expect } from 'vitest';
import { getToolLabel } from './toolLabels';

describe('getToolLabel', () => {
  it('returns "Terminal" for Bash', () => {
    expect(getToolLabel('Bash')).toBe('Terminal');
  });

  it('returns "Read File" for Read', () => {
    expect(getToolLabel('Read')).toBe('Read File');
  });

  it('returns "Write File" for Write', () => {
    expect(getToolLabel('Write')).toBe('Write File');
  });

  it('returns "Edit File" for Edit', () => {
    expect(getToolLabel('Edit')).toBe('Edit File');
  });

  it('returns "Find Files" for Glob', () => {
    expect(getToolLabel('Glob')).toBe('Find Files');
  });

  it('returns "Search Content" for Grep', () => {
    expect(getToolLabel('Grep')).toBe('Search Content');
  });

  it('returns "Web Search" for WebSearch', () => {
    expect(getToolLabel('WebSearch')).toBe('Web Search');
  });

  it('returns "Web Fetch" for WebFetch', () => {
    expect(getToolLabel('WebFetch')).toBe('Web Fetch');
  });

  it('returns "Agent" for Agent', () => {
    expect(getToolLabel('Agent')).toBe('Agent');
  });

  it('returns "Create Task" for TaskCreate', () => {
    expect(getToolLabel('TaskCreate')).toBe('Create Task');
  });

  it('returns "Update Task" for TaskUpdate', () => {
    expect(getToolLabel('TaskUpdate')).toBe('Update Task');
  });

  it('returns "Todo" for TodoWrite', () => {
    expect(getToolLabel('TodoWrite')).toBe('Todo');
  });

  it('converts mcp__ prefixed tools to colon-separated format', () => {
    expect(getToolLabel('mcp__linear-server__get_issue')).toBe('mcp:linear-server:get_issue');
  });

  it('returns tool name as-is for unknown non-mcp tools', () => {
    expect(getToolLabel('CustomTool')).toBe('CustomTool');
  });
});
