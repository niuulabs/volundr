import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolBlock } from './ToolBlock';
import type { ToolUseBlock, ToolResultBlock } from './groupContentBlocks';

vi.mock('./ToolBlock.module.css', () => ({ default: {} }));
vi.mock('./ToolIcon', () => ({ ToolIcon: () => null }));
vi.mock('lucide-react', () => ({
  ChevronRight: () => null,
}));

describe('ToolBlock', () => {
  const bashBlock: ToolUseBlock = {
    type: 'tool_use',
    id: 'tool-1',
    name: 'Bash',
    input: { command: 'ls -la', description: 'List files' },
  };

  it('renders the tool label', () => {
    render(<ToolBlock block={bashBlock} />);
    // Bash maps to "Terminal"
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('is collapsed by default (no expanded content visible)', () => {
    render(<ToolBlock block={bashBlock} />);
    // When collapsed, ToolDetail is not rendered
    expect(screen.queryByText('$')).toBeNull();
  });

  it('clicking the header expands the block', () => {
    render(<ToolBlock block={bashBlock} />);
    const header = screen.getByRole('button');
    fireEvent.click(header);
    // After expansion, the detail view shows the command with "$ " prefix
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('clicking the header twice collapses the block again', () => {
    render(<ToolBlock block={bashBlock} />);
    const header = screen.getByRole('button');
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.queryByText('$')).toBeNull();
  });

  it('shows tool input command when expanded', () => {
    render(<ToolBlock block={bashBlock} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('ls -la')).toBeInTheDocument();
  });

  it('shows result content when provided and expanded', () => {
    const result: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'output line 1\noutput line 2',
    };
    render(<ToolBlock block={bashBlock} result={result} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/output line 1/)).toBeInTheDocument();
  });

  it('renders a Read tool block with correct label', () => {
    const readBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'tool-2',
      name: 'Read',
      input: { file_path: '/src/index.ts' },
    };
    render(<ToolBlock block={readBlock} />);
    expect(screen.getByText('Read File')).toBeInTheDocument();
  });

  it('renders unknown tool with tool name as label', () => {
    const unknownBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'tool-3',
      name: 'MyCustomTool',
      input: { param: 'value' },
    };
    render(<ToolBlock block={unknownBlock} />);
    expect(screen.getByText('MyCustomTool')).toBeInTheDocument();
  });
});
