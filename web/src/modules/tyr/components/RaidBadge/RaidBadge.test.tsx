import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RaidBadge } from './RaidBadge';
import type { RaidStatus } from '../../models';

describe('RaidBadge', () => {
  const cases: [RaidStatus, string][] = [
    ['pending', 'pending'],
    ['queued', 'queued'],
    ['running', '\u25CF running'],
    ['review', '\u29D6 review'],
    ['merged', '\u2713 merged'],
    ['failed', '\u2715 failed'],
  ];

  it.each(cases)('renders correct label for status "%s"', (status, label) => {
    render(<RaidBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each(cases)('sets data-status="%s"', status => {
    const { container } = render(<RaidBadge status={status} />);
    const badge = container.querySelector('[data-status]');
    expect(badge).toHaveAttribute('data-status', status);
  });

  it('applies custom className', () => {
    const { container } = render(<RaidBadge status="running" className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });
});
