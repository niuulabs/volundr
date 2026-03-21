import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfBar } from './ConfBar';

describe('ConfBar', () => {
  it('renders percentage label by default', () => {
    render(<ConfBar value={0.72} />);
    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('hides label when showLabel is false', () => {
    render(<ConfBar value={0.72} showLabel={false} />);
    expect(screen.queryByText('72%')).not.toBeInTheDocument();
  });

  it('applies correct data-level for high confidence', () => {
    const { container } = render(<ConfBar value={0.85} />);
    const bar = container.querySelector('[data-level]');
    expect(bar).toHaveAttribute('data-level', 'high');
  });

  it('applies correct data-level for med confidence', () => {
    const { container } = render(<ConfBar value={0.55} />);
    const bar = container.querySelector('[data-level]');
    expect(bar).toHaveAttribute('data-level', 'med');
  });

  it('applies correct data-level for low confidence', () => {
    const { container } = render(<ConfBar value={0.3} />);
    const bar = container.querySelector('[data-level]');
    expect(bar).toHaveAttribute('data-level', 'low');
  });
});
