const TOOL_LABEL_MAP: Record<string, string> = {
  Bash: 'Terminal',
  Read: 'Read File',
  Write: 'Write File',
  Edit: 'Edit File',
  Glob: 'Find Files',
  Grep: 'Search Content',
  WebSearch: 'Web Search',
  WebFetch: 'Web Fetch',
  Agent: 'Agent',
  TaskCreate: 'Create Task',
  TaskUpdate: 'Update Task',
  TodoWrite: 'Todo',
};

export function getToolLabel(toolName: string): string {
  if (TOOL_LABEL_MAP[toolName]) return TOOL_LABEL_MAP[toolName];
  if (toolName.startsWith('mcp__')) {
    return toolName.replace(/__/g, ':');
  }
  return toolName;
}

export type ToolCategory =
  | 'terminal'
  | 'file'
  | 'search'
  | 'web'
  | 'agent'
  | 'task'
  | 'mcp'
  | 'default';

const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  Bash: 'terminal',
  Read: 'file',
  Write: 'file',
  Edit: 'file',
  Glob: 'search',
  Grep: 'search',
  WebSearch: 'web',
  WebFetch: 'web',
  Agent: 'agent',
  TaskCreate: 'task',
  TaskUpdate: 'task',
  TodoWrite: 'task',
};

export function getToolCategory(toolName: string): ToolCategory {
  if (TOOL_CATEGORY_MAP[toolName]) return TOOL_CATEGORY_MAP[toolName];
  if (toolName.startsWith('mcp__')) return 'mcp';
  return 'default';
}
