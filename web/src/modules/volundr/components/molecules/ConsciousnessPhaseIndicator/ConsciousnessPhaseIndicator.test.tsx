import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsciousnessPhaseIndicator } from './ConsciousnessPhaseIndicator';
import type { ConsciousnessPhase } from '@/modules/volundr/models';

describe('ConsciousnessPhaseIndicator', () => {
  it('renders all four phases', () => {
    const { container } = render(<ConsciousnessPhaseIndicator phase="THINK" />);

    const dots = container.querySelectorAll('[data-phase]');
    expect(dots.length).toBe(4);
  });

  it('shows label by default', () => {
    render(<ConsciousnessPhaseIndicator phase="THINK" />);

    expect(screen.getByText('THINK')).toBeInTheDocument();
  });

  it('hides label when showLabel is false', () => {
    render(<ConsciousnessPhaseIndicator phase="THINK" showLabel={false} />);

    expect(screen.queryByText('THINK')).not.toBeInTheDocument();
  });

  it('marks current phase as active', () => {
    const { container } = render(<ConsciousnessPhaseIndicator phase="DECIDE" />);

    const activePhase = container.querySelector('[data-phase="DECIDE"]');
    expect(activePhase?.className).toContain('active');
  });

  it('renders connectors between phases', () => {
    const { container } = render(<ConsciousnessPhaseIndicator phase="THINK" />);

    // There should be 3 connectors between 4 phases
    const connectors = container.querySelectorAll('[class*="connector"]');
    expect(connectors.length).toBe(3);
  });

  it('applies custom className', () => {
    const { container } = render(
      <ConsciousnessPhaseIndicator phase="THINK" className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('works with all phases', () => {
    const phases: ConsciousnessPhase[] = ['SENSE', 'THINK', 'DECIDE', 'ACT'];

    for (const phase of phases) {
      const { container, unmount } = render(<ConsciousnessPhaseIndicator phase={phase} />);

      expect(screen.getByText(phase)).toBeInTheDocument();

      const activePhase = container.querySelector(`[data-phase="${phase}"]`);
      expect(activePhase?.className).toContain('active');

      unmount();
    }
  });

  it('applies phase-specific class to dots', () => {
    const { container } = render(<ConsciousnessPhaseIndicator phase="THINK" />);

    const phases = ['sense', 'think', 'decide', 'act'];
    const dots = container.querySelectorAll('[data-phase]');

    dots.forEach((dot, i) => {
      expect(dot.className).toContain(phases[i]);
    });
  });
});
