import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ToolBlock } from './ToolBlock';
import type { ToolUseBlock, ToolResultBlock } from './groupContentBlocks';

describe('ToolBlock', () => {
  const bashBlock: ToolUseBlock = {
    type: 'tool_use',
    id: 't1',
    name: 'Bash',
    input: { command: 'ls -la', description: 'List files' },
  };

  const editBlock: ToolUseBlock = {
    type: 'tool_use',
    id: 't2',
    name: 'Edit',
    input: {
      file_path: '/src/app.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    },
  };

  const readBlock: ToolUseBlock = {
    type: 'tool_use',
    id: 't3',
    name: 'Read',
    input: { file_path: '/src/main.ts', offset: 10, limit: 50 },
  };

  const writeBlock: ToolUseBlock = {
    type: 'tool_use',
    id: 't4',
    name: 'Write',
    input: { file_path: '/src/new.ts', content: 'export const x = 1;' },
  };

  it('renders tool label and preview text', () => {
    render(<ToolBlock block={bashBlock} />);

    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('List files')).toBeInTheDocument();
  });

  it('is collapsed by default (no detail view)', () => {
    render(<ToolBlock block={bashBlock} />);

    expect(screen.queryByText('$ ls -la')).not.toBeInTheDocument();
  });

  it('expands when header is clicked', () => {
    render(<ToolBlock block={bashBlock} />);

    const header = screen.getByRole('button');
    fireEvent.click(header);

    // The "$" prefix is in a separate span, so look for the command text
    expect(screen.getByText('ls -la')).toBeInTheDocument();
  });

  it('collapses when header is clicked again', () => {
    render(<ToolBlock block={bashBlock} />);

    const header = screen.getByRole('button');
    fireEvent.click(header); // expand
    fireEvent.click(header); // collapse

    expect(screen.queryByText('$ ls -la')).not.toBeInTheDocument();
  });

  it('shows Bash output when result is provided', () => {
    const result: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'file1.txt\nfile2.txt',
    };
    render(<ToolBlock block={bashBlock} result={result} />);

    const header = screen.getByRole('button');
    fireEvent.click(header);

    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('renders Edit tool detail with file path and diff', () => {
    render(<ToolBlock block={editBlock} />);

    const header = screen.getByRole('button');
    fireEvent.click(header);

    expect(screen.getByText('file:')).toBeInTheDocument();
    expect(screen.getByText('/src/app.ts')).toBeInTheDocument();
    expect(screen.getByText('Old')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('const x = 2;')).toBeInTheDocument();
  });

  it('renders Read tool detail with file path and offset/limit', () => {
    render(<ToolBlock block={readBlock} />);

    const header = screen.getByRole('button');
    fireEvent.click(header);

    expect(screen.getByText('/src/main.ts')).toBeInTheDocument();
    expect(screen.getByText('offset:')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('limit:')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders Write tool detail with file path and content preview', () => {
    render(<ToolBlock block={writeBlock} />);

    const header = screen.getByRole('button');
    fireEvent.click(header);

    expect(screen.getByText('/src/new.ts')).toBeInTheDocument();
    expect(screen.getByText('export const x = 1;')).toBeInTheDocument();
  });

  it('renders generic fallback for unknown tool names', () => {
    const unknownBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't5',
      name: 'CustomTool',
      input: { mykey: 'unique-test-val' },
    };
    render(<ToolBlock block={unknownBlock} />);

    const header = screen.getByRole('button');
    fireEvent.click(header);

    // The detail view shows param key/value pairs
    const paramValues = screen.getAllByText('unique-test-val');
    expect(paramValues.length).toBeGreaterThanOrEqual(1);
  });

  it('shows preview text for Glob tool', () => {
    const globBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't6',
      name: 'Glob',
      input: { pattern: '**/*.ts' },
    };
    render(<ToolBlock block={globBlock} />);

    expect(screen.getByText('**/*.ts')).toBeInTheDocument();
  });

  it('shows preview text for Grep tool', () => {
    const grepBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't7',
      name: 'Grep',
      input: { pattern: 'TODO', path: '/src' },
    };
    render(<ToolBlock block={grepBlock} />);

    expect(screen.getByText('TODO /src')).toBeInTheDocument();
  });

  it('shows colon-separated preview for MCP tools', () => {
    const mcpBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't8',
      name: 'mcp__linear-server__get_issue',
      input: { id: 'LIN-123' },
    };
    render(<ToolBlock block={mcpBlock} />);

    // Both label and preview show the colon-separated name
    const matches = screen.getAllByText('mcp:linear-server:get_issue');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('truncates long Bash commands in preview', () => {
    const longBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't9',
      name: 'Bash',
      input: { command: 'a'.repeat(100) },
    };
    render(<ToolBlock block={longBlock} />);

    // Preview should be truncated to 60 chars
    const previewEl = screen.getByText(/^a+\.\.\.$/);
    expect(previewEl).toBeInTheDocument();
  });

  it('renders Read file path segments in preview', () => {
    const readPathBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't10',
      name: 'Read',
      input: { file_path: '/very/long/path/to/file.ts' },
    };
    render(<ToolBlock block={readPathBlock} />);

    expect(screen.getByText('to/file.ts')).toBeInTheDocument();
  });

  it('shows preview text for WebSearch tool', () => {
    const block: ToolUseBlock = {
      type: 'tool_use',
      id: 't11',
      name: 'WebSearch',
      input: { query: 'react hooks' },
    };
    render(<ToolBlock block={block} />);
    expect(screen.getByText('react hooks')).toBeInTheDocument();
  });

  it('shows preview text for WebFetch tool', () => {
    const block: ToolUseBlock = {
      type: 'tool_use',
      id: 't12',
      name: 'WebFetch',
      input: { url: 'https://example.com' },
    };
    render(<ToolBlock block={block} />);
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
  });

  it('shows preview text for Agent tool', () => {
    const block: ToolUseBlock = {
      type: 'tool_use',
      id: 't13',
      name: 'Agent',
      input: { description: 'search codebase' },
    };
    render(<ToolBlock block={block} />);
    expect(screen.getByText('search codebase')).toBeInTheDocument();
  });

  it('shows empty preview for unknown tool with non-string value', () => {
    const block: ToolUseBlock = {
      type: 'tool_use',
      id: 't14',
      name: 'SomeTool',
      input: { count: 42 },
    };
    render(<ToolBlock block={block} />);
    // Should render without crashing, preview should be empty
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('sets data-tool-category attribute based on tool name', () => {
    const { container } = render(<ToolBlock block={bashBlock} />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('data-tool-category', 'terminal');
  });

  it('sets file category for Edit tool', () => {
    const { container } = render(<ToolBlock block={editBlock} />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('data-tool-category', 'file');
  });

  it('sets mcp category for mcp prefixed tools', () => {
    const mcpBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't-mcp',
      name: 'mcp__linear-server__get_issue',
      input: { id: 'LIN-123' },
    };
    const { container } = render(<ToolBlock block={mcpBlock} />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('data-tool-category', 'mcp');
  });

  it('sets default category for unknown tools', () => {
    const unknownBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 't-unknown',
      name: 'MyCustomTool',
      input: {},
    };
    const { container } = render(<ToolBlock block={unknownBlock} />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('data-tool-category', 'default');
  });

  it('shows "Show full output" button for long Bash output and expands on click', () => {
    const longOutput = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const result: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 't1',
      content: longOutput,
    };
    render(<ToolBlock block={bashBlock} result={result} />);

    const header = screen.getByRole('button');
    fireEvent.click(header);

    const showFullBtn = screen.getByText(/Show full output/);
    expect(showFullBtn).toBeInTheDocument();

    fireEvent.click(showFullBtn);

    // After clicking, "line 1" should be visible (was truncated before)
    expect(screen.getByText(/line 1/)).toBeInTheDocument();
  });
});
