import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('renders label', () => {
    render(<MetricCard label="Test Label" value={42} icon={Activity} />);

    expect(screen.getByText('Test Label')).toBeInTheDocument();
  });

  it('renders numeric value', () => {
    render(<MetricCard label="Count" value={42} icon={Activity} />);

    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string value', () => {
    render(<MetricCard label="Status" value="Active" icon={Activity} />);

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders subtext when provided', () => {
    render(<MetricCard label="Test" value={42} subtext="Additional info" icon={Activity} />);

    expect(screen.getByText('Additional info')).toBeInTheDocument();
  });

  it('does not render subtext when not provided', () => {
    const { container } = render(<MetricCard label="Test" value={42} icon={Activity} />);

    const subtextElement = container.querySelector('[class*="subtext"]');
    expect(subtextElement).not.toBeInTheDocument();
  });

  it('renders the icon', () => {
    const { container } = render(<MetricCard label="Test" value={42} icon={Activity} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('renders with iconColor prop', () => {
    const { container } = render(
      <MetricCard label="Test" value={42} icon={Activity} iconColor="emerald" />
    );

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('renders with default icon color', () => {
    const { container } = render(<MetricCard label="Test" value={42} icon={Activity} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <MetricCard label="Test" value={42} icon={Activity} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders with all icon color variants', () => {
    const colors: Array<'cyan' | 'emerald' | 'amber' | 'purple' | 'red' | 'indigo' | 'orange'> = [
      'cyan',
      'emerald',
      'amber',
      'purple',
      'red',
      'indigo',
      'orange',
    ];

    for (const color of colors) {
      const { container, unmount } = render(
        <MetricCard label="Test" value={42} icon={Activity} iconColor={color} />
      );

      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
      unmount();
    }
  });
});
