import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfBadge } from './ConfBadge';

describe('ConfBadge', () => {
  it('renders percentage value', () => {
    render(<ConfBadge value={0.85} />);
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('applies data-level="high" for values >= 0.75', () => {
    const { container } = render(<ConfBadge value={0.9} />);
    const badge = container.querySelector('[data-level]');
    expect(badge).toHaveAttribute('data-level', 'high');
  });

  it('applies data-level="med" for values >= 0.45 and < 0.75', () => {
    const { container } = render(<ConfBadge value={0.6} />);
    const badge = container.querySelector('[data-level]');
    expect(badge).toHaveAttribute('data-level', 'med');
  });

  it('applies data-level="low" for values < 0.45', () => {
    const { container } = render(<ConfBadge value={0.2} />);
    const badge = container.querySelector('[data-level]');
    expect(badge).toHaveAttribute('data-level', 'low');
  });

  it('rounds percentage to nearest integer', () => {
    render(<ConfBadge value={0.456} />);
    expect(screen.getByText('46%')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<ConfBadge value={0.5} className="custom" />);
    const badge = container.querySelector('[data-level]');
    expect(badge).toHaveClass('custom');
  });
});
