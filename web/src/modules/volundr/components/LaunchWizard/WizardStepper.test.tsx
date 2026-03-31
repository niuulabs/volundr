import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { WizardStepper } from './WizardStepper';

const STEPS = ['Choose Template', 'Configure', 'Review & Launch'];

describe('WizardStepper', () => {
  it('renders all step labels', () => {
    render(<WizardStepper currentStep={1} steps={STEPS} />);

    for (const label of STEPS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders step numbers for non-completed steps', () => {
    render(<WizardStepper currentStep={1} steps={STEPS} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks the current step with aria-current', () => {
    const { container } = render(<WizardStepper currentStep={2} steps={STEPS} />);

    const currentSteps = container.querySelectorAll('[aria-current="step"]');
    expect(currentSteps).toHaveLength(1);
    expect(currentSteps[0].textContent).toContain('Configure');
  });

  it('shows checkmark for completed steps', () => {
    render(<WizardStepper currentStep={3} steps={STEPS} />);

    // Steps 1 and 2 are completed, so their numbers (1, 2) should not be rendered
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    // Step 3 is current, should show number
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('has navigation role', () => {
    render(<WizardStepper currentStep={1} steps={STEPS} />);

    expect(screen.getByRole('navigation', { name: 'Wizard steps' })).toBeInTheDocument();
  });

  it('renders connectors between steps', () => {
    const { container } = render(<WizardStepper currentStep={2} steps={STEPS} />);

    // There should be 2 connectors (between step 1-2 and step 2-3)
    const connectors = container.querySelectorAll('[class*="connector"]');
    expect(connectors.length).toBe(2);
  });
});
