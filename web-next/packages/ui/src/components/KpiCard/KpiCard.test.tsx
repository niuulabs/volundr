import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiCard } from './KpiCard';

describe('KpiCard', () => {
  it('renders label and value', () => {
    render(<KpiCard label="Active Sessions" value={42} />);
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string value', () => {
    render(<KpiCard label="Uptime" value="99.9%" />);
    expect(screen.getByText('99.9%')).toBeInTheDocument();
  });

  it('renders delta with up direction', () => {
    render(<KpiCard label="Requests" value={1200} delta={{ value: '+12%', direction: 'up' }} />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
    const delta = screen.getByText('+12%').closest('.niuu-kpi-card__delta');
    expect(delta).toHaveClass('niuu-kpi-card__delta--up');
  });

  it('renders delta with down direction', () => {
    render(<KpiCard label="Errors" value={5} delta={{ value: '-3', direction: 'down' }} />);
    const delta = screen.getByText('-3').closest('.niuu-kpi-card__delta');
    expect(delta).toHaveClass('niuu-kpi-card__delta--down');
  });

  it('renders delta with neutral direction', () => {
    render(
      <KpiCard label="Latency" value="120ms" delta={{ value: '0ms', direction: 'neutral' }} />,
    );
    const delta = screen.getByText('0ms').closest('.niuu-kpi-card__delta');
    expect(delta).toHaveClass('niuu-kpi-card__delta--neutral');
  });

  it('renders delta label when provided', () => {
    render(
      <KpiCard
        label="Score"
        value={95}
        delta={{ value: '+5', direction: 'up', label: 'vs last week' }}
      />,
    );
    expect(screen.getByText('vs last week')).toBeInTheDocument();
  });

  it('does not render delta section when not provided', () => {
    const { container } = render(<KpiCard label="Score" value={95} />);
    expect(container.querySelector('.niuu-kpi-card__delta')).not.toBeInTheDocument();
  });

  it('renders sparkline slot when provided', () => {
    render(<KpiCard label="Trend" value={77} sparkline={<svg data-testid="sparkline" />} />);
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });

  it('does not render sparkline section when not provided', () => {
    const { container } = render(<KpiCard label="Score" value={95} />);
    expect(container.querySelector('.niuu-kpi-card__sparkline')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<KpiCard label="A" value="B" className="my-card" />);
    expect(container.querySelector('.my-card')).toBeInTheDocument();
  });
});
