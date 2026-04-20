import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('renders an SVG with a polyline when enough data points are provided', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 4, 5, 6, 7, 8, 9, 10];
    const { container } = render(<Sparkline values={values} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute('points')).toBeTruthy();
  });

  it('returns null when fewer than 2 data points are provided', () => {
    const { container } = render(<Sparkline values={[5]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for empty values array', () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('uses custom width and height', () => {
    const values = [1, 2, 3, 4, 5];
    const { container } = render(<Sparkline values={values} width={100} height={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('100');
    expect(svg?.getAttribute('height')).toBe('32');
  });

  it('renders at 50% opacity', () => {
    const values = [1, 2, 3, 4, 5];
    const { container } = render(<Sparkline values={values} />);
    const svg = container.querySelector('svg');
    expect(svg?.style.opacity).toBe('0.5');
  });

  it('uses only the last 24 data points when given more', () => {
    const values = Array.from({ length: 30 }, (_, i) => i);
    const { container } = render(<Sparkline values={values} width={48} height={16} />);
    const polyline = container.querySelector('polyline');
    const points = polyline?.getAttribute('points') ?? '';
    // 24 points → 23 pairs of x,y coords
    const pointCount = points.split(' ').length;
    expect(pointCount).toBe(24);
  });

  it('handles flat values without crashing (range = 0)', () => {
    const values = [5, 5, 5, 5, 5];
    const { container } = render(<Sparkline values={values} />);
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  it('applies aria-hidden', () => {
    const values = [1, 2, 3, 4, 5];
    const { container } = render(<Sparkline values={values} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies custom className', () => {
    const values = [1, 2, 3, 4, 5];
    const { container } = render(<Sparkline values={values} className="niuu-text-brand" />);
    const svg = container.querySelector('svg');
    // SVG elements expose className as SVGAnimatedString — check baseVal
    const cls = svg?.className as SVGAnimatedString | string;
    const classString = typeof cls === 'string' ? cls : (cls as SVGAnimatedString)?.baseVal ?? '';
    expect(classString).toContain('niuu-text-brand');
  });
});
