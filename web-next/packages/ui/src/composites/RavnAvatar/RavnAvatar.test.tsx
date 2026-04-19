import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PersonaRole } from '@niuulabs/domain';
import { RavnAvatar } from './RavnAvatar';

describe('RavnAvatar', () => {
  it('renders with role img', () => {
    render(<RavnAvatar role="build" rune="ᚺ" state="idle" />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('shows the rune character', () => {
    render(<RavnAvatar role="plan" rune="ᚱ" state="idle" />);
    expect(screen.getByText('ᚱ')).toBeInTheDocument();
  });

  it('includes state dot in the DOM', () => {
    render(<RavnAvatar role="verify" rune="ᛗ" state="running" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('passes state to StateDot', () => {
    render(<RavnAvatar role="gate" rune="ᚷ" state="failed" />);
    const dot = screen.getByRole('status');
    expect(dot).toHaveClass('niuu-state-dot--failed');
  });

  it('adds pulse class for running state', () => {
    render(<RavnAvatar role="ship" rune="ᛋ" state="running" />);
    const dot = screen.getByRole('status');
    expect(dot).toHaveClass('niuu-state-dot--pulse');
  });

  it('does not add pulse class for idle state', () => {
    render(<RavnAvatar role="audit" rune="ᚨ" state="idle" />);
    const dot = screen.getByRole('status');
    expect(dot).not.toHaveClass('niuu-state-dot--pulse');
  });

  it('uses title prop for aria-label when provided', () => {
    render(<RavnAvatar role="report" rune="ᚱ" state="healthy" title="My Ravn" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'My Ravn');
  });

  it('applies custom className', () => {
    render(<RavnAvatar role="index" rune="ᛗ" state="idle" className="custom" />);
    expect(screen.getByRole('img')).toHaveClass('custom');
  });

  it('renders for all persona roles without throwing', () => {
    const roles: PersonaRole[] = [
      'plan',
      'build',
      'verify',
      'review',
      'gate',
      'audit',
      'ship',
      'index',
      'report',
    ];
    for (const role of roles) {
      expect(() => render(<RavnAvatar role={role} rune="ᚺ" state="idle" />)).not.toThrow();
    }
  });
});
