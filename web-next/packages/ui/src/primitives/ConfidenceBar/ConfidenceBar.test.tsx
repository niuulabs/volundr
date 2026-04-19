import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceBar } from './ConfidenceBar';
import type { ConfidenceLevel } from './ConfidenceBar';

describe('ConfidenceBar', () => {
  it('renders a meter element', () => {
    render(<ConfidenceBar level="high" value={0.8} />);
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('applies the level fill modifier class', () => {
    const { container } = render(<ConfidenceBar level="high" value={0.8} />);
    expect(container.querySelector('.niuu-confidence-bar__fill--high')).not.toBeNull();
  });

  it('applies medium fill class for medium level', () => {
    const { container } = render(<ConfidenceBar level="medium" value={0.5} />);
    expect(container.querySelector('.niuu-confidence-bar__fill--medium')).not.toBeNull();
  });

  it('applies low fill class for low level', () => {
    const { container } = render(<ConfidenceBar level="low" value={0.2} />);
    expect(container.querySelector('.niuu-confidence-bar__fill--low')).not.toBeNull();
  });

  it('sets width style based on value', () => {
    const { container } = render(<ConfidenceBar level="high" value={0.75} />);
    const fill = container.querySelector('.niuu-confidence-bar__fill') as HTMLElement;
    expect(fill.style.width).toBe('75%');
  });

  it('clamps value above 1 to 100%', () => {
    const { container } = render(<ConfidenceBar level="high" value={1.5} />);
    const fill = container.querySelector('.niuu-confidence-bar__fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('clamps negative value to 0%', () => {
    const { container } = render(<ConfidenceBar level="low" value={-0.5} />);
    const fill = container.querySelector('.niuu-confidence-bar__fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('does not render label by default', () => {
    render(<ConfidenceBar level="high" value={0.8} />);
    expect(document.querySelector('.niuu-confidence-bar__label')).toBeNull();
  });

  it('renders label when showLabel is true', () => {
    render(<ConfidenceBar level="high" value={0.8} showLabel />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders correct label for each level', () => {
    const levels: ConfidenceLevel[] = ['high', 'medium', 'low'];
    for (const level of levels) {
      const { unmount } = render(<ConfidenceBar level={level} value={0.5} showLabel />);
      expect(screen.getByText(level)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies label level modifier class when showLabel', () => {
    const { container } = render(<ConfidenceBar level="medium" value={0.5} showLabel />);
    expect(container.querySelector('.niuu-confidence-bar__label--medium')).not.toBeNull();
  });

  it('sets aria attributes on the meter', () => {
    render(<ConfidenceBar level="high" value={0.6} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '60');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });

  it('passes className through', () => {
    render(<ConfidenceBar level="high" value={0.5} className="my-bar" />);
    expect(screen.getByRole('meter')).toHaveClass('my-bar');
  });
});
