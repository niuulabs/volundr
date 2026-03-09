import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LinearIssue } from '@/models';
import { LinearIssueBadge } from './LinearIssueBadge';

describe('LinearIssueBadge', () => {
  const inProgressIssue: LinearIssue = {
    id: 'lin-001',
    identifier: 'NIU-44',
    title: 'Implement thermal calibration PID improvements',
    status: 'in_progress',
    assignee: 'Jozef',
    labels: ['firmware'],
    priority: 2,
    url: 'https://linear.app/niuu/issue/NIU-44',
  };

  const doneIssue: LinearIssue = {
    id: 'lin-003',
    identifier: 'NIU-46',
    title: 'Build TrueNAS SCALE adapter',
    status: 'done',
    url: 'https://linear.app/niuu/issue/NIU-46',
  };

  it('renders the issue identifier', () => {
    render(<LinearIssueBadge issue={inProgressIssue} />);
    expect(screen.getByText('NIU-44')).toBeInTheDocument();
  });

  it('renders as a link to the issue URL', () => {
    render(<LinearIssueBadge issue={inProgressIssue} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://linear.app/niuu/issue/NIU-44');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('sets data-status attribute for in_progress', () => {
    render(<LinearIssueBadge issue={inProgressIssue} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('data-status', 'in_progress');
  });

  it('sets data-status attribute for done', () => {
    render(<LinearIssueBadge issue={doneIssue} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('data-status', 'done');
  });

  it('applies custom className', () => {
    render(<LinearIssueBadge issue={inProgressIssue} className="custom" />);
    const link = screen.getByRole('link');
    expect(link).toHaveClass('custom');
  });

  it('includes title tooltip with issue details', () => {
    render(<LinearIssueBadge issue={inProgressIssue} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'title',
      'NIU-44: Implement thermal calibration PID improvements (In Progress)'
    );
  });
});
