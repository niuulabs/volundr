import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';
import type { StatusBadgeStatus } from './StatusBadge';

describe('StatusBadge', () => {
  const statuses: StatusBadgeStatus[] = ['running', 'queued', 'ok', 'review', 'failed', 'archived'];

  it('renders the label for each status', () => {
    for (const status of statuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status === 'ok' ? 'ok' : status)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies the status modifier class', () => {
    render(<StatusBadge status="failed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveClass('niuu-status-badge--failed');
  });

  it('renders a dot element', () => {
    render(<StatusBadge status="running" />);
    const badge = screen.getByRole('status');
    expect(badge.querySelector('.niuu-status-badge__dot')).not.toBeNull();
  });

  it('applies running modifier class for running status', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByRole('status')).toHaveClass('niuu-status-badge--running');
  });

  it('applies queued modifier class for queued status', () => {
    render(<StatusBadge status="queued" />);
    expect(screen.getByRole('status')).toHaveClass('niuu-status-badge--queued');
  });

  it('applies ok modifier class for ok status', () => {
    render(<StatusBadge status="ok" />);
    expect(screen.getByRole('status')).toHaveClass('niuu-status-badge--ok');
  });

  it('applies review modifier class for review status', () => {
    render(<StatusBadge status="review" />);
    expect(screen.getByRole('status')).toHaveClass('niuu-status-badge--review');
  });

  it('applies archived modifier class for archived status', () => {
    render(<StatusBadge status="archived" />);
    expect(screen.getByRole('status')).toHaveClass('niuu-status-badge--archived');
  });

  it('passes className through', () => {
    render(<StatusBadge status="ok" className="my-class" />);
    expect(screen.getByRole('status')).toHaveClass('my-class');
  });

  it('sets aria-label to the status value', () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'failed');
  });
});
