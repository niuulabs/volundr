import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

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
    const odinStatuses = ['sensing', 'thinking', 'deciding', 'acting'];

    for (const status of odinStatuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders all health status variants', () => {
    const healthStatuses = ['healthy', 'warning', 'critical', 'offline'];

    for (const status of healthStatuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders all session status variants', () => {
    const sessionStatuses = ['running', 'stopped', 'error', 'starting', 'provisioning'];

    for (const status of sessionStatuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders label when provided instead of status', () => {
    render(<StatusBadge status="running" label="Active" />);

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
  });

  it('accepts arbitrary string status values', () => {
    render(<StatusBadge status="custom-status" />);

    expect(screen.getByText('custom-status')).toBeInTheDocument();
    expect(screen.getByText('custom-status')).toHaveAttribute('data-status', 'custom-status');
  });
});
