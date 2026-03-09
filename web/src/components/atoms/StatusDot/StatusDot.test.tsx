import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('renders with default props', () => {
    render(<StatusDot status="healthy" />);

    const dot = screen.getByLabelText('healthy');
    expect(dot).toBeInTheDocument();
  });

  it('sets data-status attribute', () => {
    render(<StatusDot status="warning" />);

    const dot = screen.getByLabelText('warning');
    expect(dot).toHaveAttribute('data-status', 'warning');
  });

  it('sets aria-label for accessibility', () => {
    render(<StatusDot status="critical" />);

    expect(screen.getByLabelText('critical')).toBeInTheDocument();
  });

  it('applies pulse class when pulse is true', () => {
    render(<StatusDot status="healthy" pulse />);

    const dot = screen.getByLabelText('healthy');
    expect(dot.className).toContain('pulse');
  });

  it('does not apply pulse class when pulse is false', () => {
    render(<StatusDot status="healthy" pulse={false} />);

    const dot = screen.getByLabelText('healthy');
    expect(dot.className).not.toContain('pulse');
  });

  it('applies size class for sm variant', () => {
    render(<StatusDot status="healthy" size="sm" />);

    const dot = screen.getByLabelText('healthy');
    expect(dot.className).toContain('sm');
  });

  it('applies size class for md variant', () => {
    render(<StatusDot status="healthy" size="md" />);

    const dot = screen.getByLabelText('healthy');
    expect(dot.className).toContain('md');
  });

  it('applies custom className', () => {
    render(<StatusDot status="healthy" className="custom-class" />);

    const dot = screen.getByLabelText('healthy');
    expect(dot).toHaveClass('custom-class');
  });

  it('combines multiple classes correctly', () => {
    render(<StatusDot status="healthy" size="sm" pulse className="custom" />);

    const dot = screen.getByLabelText('healthy');
    expect(dot.className).toContain('sm');
    expect(dot.className).toContain('pulse');
    expect(dot).toHaveClass('custom');
  });
});
