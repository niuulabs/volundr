import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IssuePicker } from './IssuePicker';

vi.mock('@/hooks/useIssues', () => ({
  useIssues: () => ({
    issues: [],
    loading: false,
    error: null,
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
  }),
}));

describe('IssuePicker', () => {
  it('renders search input when no issue selected', () => {
    render(<IssuePicker onSelect={vi.fn()} />);

    expect(screen.getByPlaceholderText('Search issues...')).toBeInTheDocument();
  });

  it('renders selected issue with clear button', () => {
    const onClear = vi.fn();
    const issue = {
      id: '1',
      identifier: 'NIU-42',
      title: 'Fix auth bug',
      status: 'In Progress',
      assignee: null,
      labels: [],
      priority: 1,
      url: 'https://linear.app/NIU-42',
    };

    render(<IssuePicker onSelect={vi.fn()} onClear={onClear} selectedIssue={issue} />);

    expect(screen.getByText('NIU-42')).toBeInTheDocument();
    expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
    fireEvent.click(screen.getByText('\u00d7'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('renders selected issue without clear button when onClear not provided', () => {
    const issue = {
      id: '1',
      identifier: 'NIU-42',
      title: 'Fix auth bug',
      status: 'Done',
      assignee: null,
      labels: [],
      priority: 0,
      url: '',
    };

    render(<IssuePicker onSelect={vi.fn()} selectedIssue={issue} />);

    expect(screen.getByText('NIU-42')).toBeInTheDocument();
    expect(screen.queryByText('\u00d7')).not.toBeInTheDocument();
  });
});
