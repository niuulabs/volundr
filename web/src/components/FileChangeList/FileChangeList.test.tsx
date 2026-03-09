import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionFile } from '@/models';
import { FileChangeList } from './FileChangeList';

const mockFiles: SessionFile[] = [
  { path: 'src/main.ts', status: 'new', ins: 50, del: 0 },
  { path: 'src/utils.ts', status: 'mod', ins: 10, del: 3 },
  { path: 'src/old.ts', status: 'del', ins: 0, del: 25 },
];

describe('FileChangeList', () => {
  it('renders empty state when no files', () => {
    render(<FileChangeList files={[]} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByText('No files changed')).toBeDefined();
  });

  it('renders all files', () => {
    render(<FileChangeList files={mockFiles} selectedFile={null} onSelectFile={vi.fn()} />);

    expect(screen.getByText('src/main.ts')).toBeDefined();
    expect(screen.getByText('src/utils.ts')).toBeDefined();
    expect(screen.getByText('src/old.ts')).toBeDefined();
  });

  it('renders status badges', () => {
    render(<FileChangeList files={mockFiles} selectedFile={null} onSelectFile={vi.fn()} />);

    expect(screen.getByText('Added')).toBeDefined();
    expect(screen.getByText('Modified')).toBeDefined();
    expect(screen.getByText('Deleted')).toBeDefined();
  });

  it('renders insertion counts', () => {
    render(<FileChangeList files={mockFiles} selectedFile={null} onSelectFile={vi.fn()} />);

    expect(screen.getByText('+50')).toBeDefined();
    expect(screen.getByText('+10')).toBeDefined();
  });

  it('renders deletion counts', () => {
    render(<FileChangeList files={mockFiles} selectedFile={null} onSelectFile={vi.fn()} />);

    expect(screen.getByText('-3')).toBeDefined();
    expect(screen.getByText('-25')).toBeDefined();
  });

  it('does not render zero insertion counts', () => {
    render(<FileChangeList files={mockFiles} selectedFile={null} onSelectFile={vi.fn()} />);

    // The deleted file has ins: 0, should not show +0
    const plusZeros = screen.queryAllByText('+0');
    expect(plusZeros.length).toBe(0);
  });

  it('does not render zero deletion counts', () => {
    render(<FileChangeList files={mockFiles} selectedFile={null} onSelectFile={vi.fn()} />);

    // The new file has del: 0, should not show -0
    const minusZeros = screen.queryAllByText('-0');
    expect(minusZeros.length).toBe(0);
  });

  it('calls onSelectFile when a file row is clicked', () => {
    const onSelectFile = vi.fn();
    render(<FileChangeList files={mockFiles} selectedFile={null} onSelectFile={onSelectFile} />);

    fireEvent.click(screen.getByText('src/main.ts'));
    expect(onSelectFile).toHaveBeenCalledWith('src/main.ts');
  });

  it('highlights the selected file', () => {
    const { container } = render(
      <FileChangeList files={mockFiles} selectedFile="src/utils.ts" onSelectFile={vi.fn()} />
    );

    const buttons = container.querySelectorAll('button');
    // Second button should be selected
    expect(buttons[1].className).toContain('fileRowSelected');
    // Others should not be selected
    expect(buttons[0].className).not.toContain('fileRowSelected');
    expect(buttons[2].className).not.toContain('fileRowSelected');
  });

  it('applies custom className', () => {
    const { container } = render(
      <FileChangeList
        files={mockFiles}
        selectedFile={null}
        onSelectFile={vi.fn()}
        className="custom"
      />
    );

    expect(container.firstChild?.className).toContain('custom');
  });
});
