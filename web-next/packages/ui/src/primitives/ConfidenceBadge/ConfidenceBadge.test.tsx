import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceBadge } from './ConfidenceBadge';

describe('ConfidenceBadge', () => {
  it('renders em-dash for null value', () => {
    render(<ConfidenceBadge value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders em-dash for zero value', () => {
    render(<ConfidenceBadge value={0} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('applies empty class for null value', () => {
    const { container } = render(<ConfidenceBadge value={null} />);
    expect(container.querySelector('.niuu-confidence-badge--empty')).not.toBeNull();
  });

  it('applies empty class for zero value', () => {
    const { container } = render(<ConfidenceBadge value={0} />);
    expect(container.querySelector('.niuu-confidence-badge--empty')).not.toBeNull();
  });

  it('renders percentage for positive value', () => {
    render(<ConfidenceBadge value={0.75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders a meter element for non-zero value', () => {
    render(<ConfidenceBadge value={0.5} />);
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('does not render meter for null', () => {
    render(<ConfidenceBadge value={null} />);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('uses high fill class for value >= 0.7', () => {
    const { container } = render(<ConfidenceBadge value={0.7} />);
    expect(container.querySelector('.niuu-confidence-badge__fill--high')).not.toBeNull();
  });

  it('uses medium fill class for value between 0.4 and 0.7', () => {
    const { container } = render(<ConfidenceBadge value={0.5} />);
    expect(container.querySelector('.niuu-confidence-badge__fill--medium')).not.toBeNull();
  });

  it('uses low fill class for value < 0.4', () => {
    const { container } = render(<ConfidenceBadge value={0.3} />);
    expect(container.querySelector('.niuu-confidence-badge__fill--low')).not.toBeNull();
  });

  it('sets fill width proportional to value', () => {
    const { container } = render(<ConfidenceBadge value={0.8} />);
    const fill = container.querySelector('.niuu-confidence-badge__fill') as HTMLElement;
    expect(fill.style.width).toBe('80%');
  });

  it('clamps value above 1 to 100%', () => {
    const { container } = render(<ConfidenceBadge value={1.5} />);
    const fill = container.querySelector('.niuu-confidence-badge__fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('applies high pct class for high confidence', () => {
    const { container } = render(<ConfidenceBadge value={0.9} />);
    expect(container.querySelector('.niuu-confidence-badge__pct--high')).not.toBeNull();
  });

  it('applies medium pct class for medium confidence', () => {
    const { container } = render(<ConfidenceBadge value={0.55} />);
    expect(container.querySelector('.niuu-confidence-badge__pct--medium')).not.toBeNull();
  });

  it('applies low pct class for low confidence', () => {
    const { container } = render(<ConfidenceBadge value={0.2} />);
    expect(container.querySelector('.niuu-confidence-badge__pct--low')).not.toBeNull();
  });

  it('passes className through for non-empty value', () => {
    render(<ConfidenceBadge value={0.5} className="my-badge" />);
    expect(screen.getByRole('meter')).toHaveClass('my-badge');
  });

  it('passes className through for empty value', () => {
    render(<ConfidenceBadge value={null} className="my-badge" />);
    expect(document.querySelector('.my-badge')).not.toBeNull();
  });

  it('sets aria attributes on the meter', () => {
    render(<ConfidenceBadge value={0.65} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '65');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });
});
