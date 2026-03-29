import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourceBar } from './ResourceBar';

describe('ResourceBar', () => {
  it('renders label', () => {
    render(<ResourceBar label="Memory" used={50} total={100} />);

    expect(screen.getByText('Memory')).toBeInTheDocument();
  });

  it('shows values by default', () => {
    render(<ResourceBar label="Memory" used={50} total={100} unit="GB" />);

    expect(screen.getByText('50/100 GB')).toBeInTheDocument();
  });

  it('hides values when showValues is false', () => {
    render(<ResourceBar label="Memory" used={50} total={100} unit="GB" showValues={false} />);

    expect(screen.queryByText('50/100 GB')).not.toBeInTheDocument();
  });

  it('renders without unit', () => {
    render(<ResourceBar label="Memory" used={50} total={100} />);

    expect(screen.getByText('50/100')).toBeInTheDocument();
  });

  it('calculates correct fill width percentage', () => {
    const { container } = render(<ResourceBar label="Test" used={25} total={100} />);

    const fill = container.querySelector('[class*="fill"]');
    expect(fill).toHaveStyle({ width: '25%' });
  });

  it('handles 0% usage', () => {
    const { container } = render(<ResourceBar label="Test" used={0} total={100} />);

    const fill = container.querySelector('[class*="fill"]');
    expect(fill).toHaveStyle({ width: '0%' });
  });

  it('handles 100% usage', () => {
    const { container } = render(<ResourceBar label="Test" used={100} total={100} />);

    const fill = container.querySelector('[class*="fill"]');
    expect(fill).toHaveStyle({ width: '100%' });
  });

  it('handles zero total without error', () => {
    const { container } = render(<ResourceBar label="Test" used={0} total={0} />);

    const fill = container.querySelector('[class*="fill"]');
    expect(fill).toHaveStyle({ width: '0%' });
  });

  it('rounds percentage to integer', () => {
    const { container } = render(<ResourceBar label="Test" used={33} total={100} />);

    const fill = container.querySelector('[class*="fill"]');
    expect(fill).toHaveStyle({ width: '33%' });
  });

  it('applies color class', () => {
    const { container } = render(<ResourceBar label="Test" used={50} total={100} color="amber" />);

    const fill = container.querySelector('[class*="fill"]');
    expect(fill?.className).toContain('amber');
  });

  it('uses emerald as default color', () => {
    const { container } = render(<ResourceBar label="Test" used={50} total={100} />);

    const fill = container.querySelector('[class*="fill"]');
    expect(fill?.className).toContain('emerald');
  });

  it('applies custom className', () => {
    const { container } = render(
      <ResourceBar label="Test" used={50} total={100} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('supports all color variants', () => {
    const colors: Array<'emerald' | 'amber' | 'cyan' | 'purple' | 'red'> = [
      'emerald',
      'amber',
      'cyan',
      'purple',
      'red',
    ];

    for (const color of colors) {
      const { container, unmount } = render(
        <ResourceBar label="Test" used={50} total={100} color={color} />
      );

      const fill = container.querySelector('[class*="fill"]');
      expect(fill?.className).toContain(color);
      unmount();
    }
  });

  it('handles decimal values', () => {
    render(<ResourceBar label="Storage" used={2.5} total={4.0} unit="TB" />);

    expect(screen.getByText('2.5/4 TB')).toBeInTheDocument();
  });

  it('uses formatValue to display human-readable values', () => {
    const formatter = (v: number) => `${(v / 1_000_000_000).toFixed(0)} GB`;
    render(
      <ResourceBar
        label="Capacity"
        used={820_000_000_000}
        total={2_000_000_000_000}
        formatValue={formatter}
      />
    );

    expect(screen.getByText('820 GB/2000 GB')).toBeInTheDocument();
  });
});
