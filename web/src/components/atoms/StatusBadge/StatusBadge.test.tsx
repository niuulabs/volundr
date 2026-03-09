import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';
import type { StatusType } from '@/models';

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="healthy" />);

    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('sets data-status attribute', () => {
    render(<StatusBadge status="warning" />);

    const badge = screen.getByText('warning');
    expect(badge).toHaveAttribute('data-status', 'warning');
  });

  it('applies custom className', () => {
    render(<StatusBadge status="healthy" className="custom-class" />);

    const badge = screen.getByText('healthy');
    expect(badge).toHaveClass('custom-class');
  });

  it('renders all Odin status variants', () => {
    const odinStatuses: StatusType[] = ['sensing', 'thinking', 'deciding', 'acting'];

    for (const status of odinStatuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders all health status variants', () => {
    const healthStatuses: StatusType[] = ['healthy', 'warning', 'critical', 'offline'];

    for (const status of healthStatuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders all session status variants', () => {
    const sessionStatuses: StatusType[] = [
      'running',
      'stopped',
      'error',
      'starting',
      'provisioning',
    ];

    for (const status of sessionStatuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });
});
