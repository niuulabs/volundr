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
