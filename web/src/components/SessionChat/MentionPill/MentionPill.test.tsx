import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MentionPill } from './MentionPill';
import type { FileTreeEntry } from '@/models';

describe('MentionPill', () => {
  const fileEntry: FileTreeEntry = {
    name: 'App.tsx',
    path: 'src/App.tsx',
    type: 'file',
  };

  const dirEntry: FileTreeEntry = {
    name: 'src',
    path: 'src',
    type: 'directory',
  };

  it('renders file path', () => {
    render(<MentionPill entry={fileEntry} onRemove={vi.fn()} />);
    expect(screen.getByText('src/App.tsx')).toBeDefined();
  });

  it('renders directory path', () => {
    render(<MentionPill entry={dirEntry} onRemove={vi.fn()} />);
    expect(screen.getByText('src')).toBeDefined();
  });

  it('calls onRemove with path when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<MentionPill entry={fileEntry} onRemove={onRemove} />);

    const removeBtn = screen.getByLabelText('Remove src/App.tsx');
    fireEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalledWith('src/App.tsx');
  });

  it('sets data-type attribute for file', () => {
    render(<MentionPill entry={fileEntry} onRemove={vi.fn()} />);
    const pill = screen.getByTestId('mention-pill');
    expect(pill.dataset.type).toBe('file');
  });

  it('sets data-type attribute for directory', () => {
    render(<MentionPill entry={dirEntry} onRemove={vi.fn()} />);
    const pill = screen.getByTestId('mention-pill');
    expect(pill.dataset.type).toBe('directory');
  });
});
