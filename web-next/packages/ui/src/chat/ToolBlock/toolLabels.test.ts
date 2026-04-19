import { getToolLabel, getToolCategory, type ToolCategory } from './toolLabels';

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

  it('returns "Todo" for TodoWrite', () => {
    expect(getToolLabel('TodoWrite')).toBe('Todo');
  });

  it('falls back to the tool name itself for unknown tools', () => {
    expect(getToolLabel('UnknownTool')).toBe('UnknownTool');
  });

  it('formats mcp__ tool names with colons', () => {
    expect(getToolLabel('mcp__github__create_pr')).toBe('mcp:github:create_pr');
  });
});

describe('getToolCategory', () => {
  it('returns "terminal" for Bash', () => {
    expect(getToolCategory('Bash')).toBe<ToolCategory>('terminal');
  });

  it('returns "file" for Read', () => {
    expect(getToolCategory('Read')).toBe<ToolCategory>('file');
  });

  it('returns "file" for Write', () => {
    expect(getToolCategory('Write')).toBe<ToolCategory>('file');
  });

  it('returns "file" for Edit', () => {
    expect(getToolCategory('Edit')).toBe<ToolCategory>('file');
  });

  it('returns "search" for Glob', () => {
    expect(getToolCategory('Glob')).toBe<ToolCategory>('search');
  });

  it('returns "search" for Grep', () => {
    expect(getToolCategory('Grep')).toBe<ToolCategory>('search');
  });

  it('returns "web" for WebSearch', () => {
    expect(getToolCategory('WebSearch')).toBe<ToolCategory>('web');
  });

  it('returns "web" for WebFetch', () => {
    expect(getToolCategory('WebFetch')).toBe<ToolCategory>('web');
  });

  it('returns "agent" for Agent', () => {
    expect(getToolCategory('Agent')).toBe<ToolCategory>('agent');
  });

  it('returns "task" for TaskCreate', () => {
    expect(getToolCategory('TaskCreate')).toBe<ToolCategory>('task');
  });

  it('returns "task" for TaskUpdate', () => {
    expect(getToolCategory('TaskUpdate')).toBe<ToolCategory>('task');
  });

  it('returns "task" for TodoWrite', () => {
    expect(getToolCategory('TodoWrite')).toBe<ToolCategory>('task');
  });

  it('returns "mcp" for mcp__ prefixed tools', () => {
    expect(getToolCategory('mcp__github__list_issues')).toBe<ToolCategory>('mcp');
  });

  it('returns "default" for unknown tool names', () => {
    expect(getToolCategory('UnknownTool')).toBe<ToolCategory>('default');
  });
});
