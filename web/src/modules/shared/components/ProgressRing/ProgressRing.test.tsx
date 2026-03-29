import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';

describe('ProgressRing', () => {
  it('renders with default props', () => {
    render(<ProgressRing value={50} />);

    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('displays the correct value', () => {
    render(<ProgressRing value={75} />);

    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('handles 0% value', () => {
    render(<ProgressRing value={0} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('handles 100% value', () => {
    render(<ProgressRing value={100} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('hides value when showValue is false', () => {
    render(<ProgressRing value={50} showValue={false} />);

    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('renders SVG with circles', () => {
    const { container } = render(<ProgressRing value={50} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2); // Background and progress circles
  });

  it('applies custom size', () => {
    const { container } = render(<ProgressRing value={50} size={60} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '60');
    expect(svg).toHaveAttribute('height', '60');
  });

  it('applies custom color to progress circle', () => {
    const { container } = render(<ProgressRing value={50} color="#ff0000" />);

    const circles = container.querySelectorAll('circle');
    const progressCircle = circles[1]; // Second circle is progress
    expect(progressCircle).toHaveAttribute('stroke', '#ff0000');
  });

  it('applies custom strokeWidth', () => {
    const { container } = render(<ProgressRing value={50} strokeWidth={8} />);

    const circles = container.querySelectorAll('circle');
    expect(circles[0]).toHaveAttribute('stroke-width', '8');
    expect(circles[1]).toHaveAttribute('stroke-width', '8');
  });

  it('applies custom className', () => {
    const { container } = render(<ProgressRing value={50} className="custom-class" />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('custom-class');
  });

  it('calculates correct stroke-dashoffset for 0%', () => {
    const { container } = render(<ProgressRing value={0} size={44} strokeWidth={4} />);

    const progressCircle = container.querySelectorAll('circle')[1];
    const radius = (44 - 4) / 2;
    const circumference = radius * 2 * Math.PI;

    expect(progressCircle).toHaveAttribute('stroke-dashoffset', String(circumference));
  });

  it('calculates correct stroke-dashoffset for 100%', () => {
    const { container } = render(<ProgressRing value={100} size={44} strokeWidth={4} />);

    const progressCircle = container.querySelectorAll('circle')[1];
    expect(progressCircle).toHaveAttribute('stroke-dashoffset', '0');
  });

  it('calculates correct stroke-dashoffset for 50%', () => {
    const { container } = render(<ProgressRing value={50} size={44} strokeWidth={4} />);

    const progressCircle = container.querySelectorAll('circle')[1];
    const radius = (44 - 4) / 2;
    const circumference = radius * 2 * Math.PI;
    const expectedOffset = circumference / 2;

    expect(progressCircle).toHaveAttribute('stroke-dashoffset', String(expectedOffset));
  });
});
