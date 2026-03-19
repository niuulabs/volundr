import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TrackerIssue } from '@/models';
import { TrackerIssueSection } from './TrackerIssueSection';

describe('TrackerIssueSection', () => {
  const issue: TrackerIssue = {
    id: 'lin-001',
    identifier: 'NIU-44',
    title: 'Implement thermal calibration PID improvements',
    status: 'in_progress',
    assignee: 'Jozef',
    labels: ['firmware', 'printer'],
    priority: 2,
    url: 'https://linear.app/niuu/issue/NIU-44',
  };

  const mockOnStatusChange = vi.fn();

  it('renders issue identifier as a link', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    const link = screen.getByText('NIU-44');
    expect(link.closest('a')).toHaveAttribute('href', 'https://linear.app/niuu/issue/NIU-44');
  });

  it('renders issue title', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    expect(screen.getByText('Implement thermal calibration PID improvements')).toBeInTheDocument();
  });

  it('renders status dropdown with current status', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('in_progress');
  });

  it('calls onStatusChange when status is changed', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'done' } });
    expect(mockOnStatusChange).toHaveBeenCalledWith('lin-001', 'done');
  });

  it('renders assignee when present', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    expect(screen.getByText('Jozef')).toBeInTheDocument();
  });

  it('does not render assignee when not present', () => {
    const noAssignee = { ...issue, assignee: undefined };
    render(<TrackerIssueSection issue={noAssignee} onStatusChange={mockOnStatusChange} />);
    expect(screen.queryByText('Jozef')).not.toBeInTheDocument();
  });

  it('renders labels', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    expect(screen.getByText('firmware')).toBeInTheDocument();
    expect(screen.getByText('printer')).toBeInTheDocument();
  });

  it('renders priority when present and > 0', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('does not render priority when 0', () => {
    const noPriority = { ...issue, priority: 0 };
    render(<TrackerIssueSection issue={noPriority} onStatusChange={mockOnStatusChange} />);
    expect(screen.queryByText('No priority')).not.toBeInTheDocument();
  });

  it('renders all status options in dropdown', () => {
    render(<TrackerIssueSection issue={issue} onStatusChange={mockOnStatusChange} />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(5);
    expect(options.map(o => o.textContent)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'Done',
      'Cancelled',
    ]);
  });
});
