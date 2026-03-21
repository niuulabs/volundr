import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ToolGroupBlock } from './ToolGroupBlock';
import type { ToolUseBlock, ToolResultBlock } from './groupContentBlocks';

describe('ToolGroupBlock', () => {
  const blocks: { block: ToolUseBlock; result?: ToolResultBlock }[] = [
    { block: { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } } },
    { block: { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/b.ts' } } },
    { block: { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/c.ts' } } },
  ];

  it('renders tool label and count badge', () => {
    render(<ToolGroupBlock toolName="Read" blocks={blocks} />);

    expect(screen.getByText('Read File')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('is collapsed by default', () => {
    render(<ToolGroupBlock toolName="Read" blocks={blocks} />);

    // Individual tool blocks should not be visible
    expect(screen.queryByText('a.ts')).not.toBeInTheDocument();
  });

  it('expands to show individual tool blocks when clicked', () => {
    render(<ToolGroupBlock toolName="Read" blocks={blocks} />);

    // The group header is the first button
    const groupHeader = screen.getAllByRole('button')[0];
    fireEvent.click(groupHeader);

    // After expanding, the nested ToolBlock components should render
    // Each will have its own header button with preview text
    const buttons = screen.getAllByRole('button');
    // 1 group header + 3 individual tool block headers
    expect(buttons.length).toBe(4);
  });

  it('collapses when clicked again', () => {
    render(<ToolGroupBlock toolName="Read" blocks={blocks} />);

    const groupHeader = screen.getAllByRole('button')[0];
    fireEvent.click(groupHeader); // expand
    expect(screen.getAllByRole('button').length).toBe(4);

    fireEvent.click(groupHeader); // collapse
    expect(screen.getAllByRole('button').length).toBe(1);
  });

  it('renders tool icon', () => {
    const { container } = render(<ToolGroupBlock toolName="Read" blocks={blocks} />);

    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('handles blocks with results', () => {
    const blocksWithResults: { block: ToolUseBlock; result?: ToolResultBlock }[] = [
      {
        block: { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        result: { type: 'tool_result', tool_use_id: 't1', content: 'file.txt' },
      },
      {
        block: { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'pwd' } },
        result: { type: 'tool_result', tool_use_id: 't2', content: '/home' },
      },
    ];

    render(<ToolGroupBlock toolName="Bash" blocks={blocksWithResults} />);

    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
