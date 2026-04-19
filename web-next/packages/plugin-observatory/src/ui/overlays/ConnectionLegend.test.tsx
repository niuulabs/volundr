import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionLegend } from './ConnectionLegend';

describe('ConnectionLegend', () => {
  it('renders all 5 edge kind entries', () => {
    render(<ConnectionLegend />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('renders each edge kind with a data-kind attribute', () => {
    render(<ConnectionLegend />);
    expect(screen.getByTestId('legend-solid')).toBeInTheDocument();
    expect(screen.getByTestId('legend-dashed-anim')).toBeInTheDocument();
    expect(screen.getByTestId('legend-dashed-long')).toBeInTheDocument();
    expect(screen.getByTestId('legend-soft')).toBeInTheDocument();
    expect(screen.getByTestId('legend-raid')).toBeInTheDocument();
  });

  it('has accessible list role with label', () => {
    render(<ConnectionLegend />);
    expect(screen.getByRole('list', { name: /connection types/i })).toBeInTheDocument();
  });

  it('renders label text for each edge kind', () => {
    render(<ConnectionLegend />);
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Async')).toBeInTheDocument();
    expect(screen.getByText('Cache')).toBeInTheDocument();
    expect(screen.getByText('Coord')).toBeInTheDocument();
  });

  it('renders description text for each edge kind', () => {
    render(<ConnectionLegend />);
    expect(screen.getByText('coordinator link')).toBeInTheDocument();
    expect(screen.getByText('raid dispatch')).toBeInTheDocument();
    expect(screen.getByText('memory access')).toBeInTheDocument();
    expect(screen.getByText('weak reference')).toBeInTheDocument();
    expect(screen.getByText('inter-raven')).toBeInTheDocument();
  });

  it('renders an SVG line for each edge kind', () => {
    const { container } = render(<ConnectionLegend />);
    const svgs = container.querySelectorAll('svg.obs-conn-legend__line-svg');
    expect(svgs).toHaveLength(5);
  });

  it('renders SVG lines with correct markup for each kind', () => {
    render(<ConnectionLegend />);
    // solid: plain line
    const solidItem = screen.getByTestId('legend-solid');
    expect(solidItem.querySelector('line')).toBeInTheDocument();
    // dashed-anim: line with animate child
    const animItem = screen.getByTestId('legend-dashed-anim');
    expect(animItem.querySelector('animate')).toBeInTheDocument();
    // raid: line + circle
    const raidItem = screen.getByTestId('legend-raid');
    expect(raidItem.querySelector('circle')).toBeInTheDocument();
    expect(raidItem.querySelector('g')).toBeInTheDocument();
  });
});
