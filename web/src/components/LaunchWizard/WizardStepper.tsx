import { Check } from 'lucide-react';
import { cn } from '@/utils';
import styles from './WizardStepper.module.css';

export interface WizardStepperProps {
  currentStep: number;
  steps: string[];
}

export function WizardStepper({ currentStep, steps }: WizardStepperProps) {
  return (
    <div className={styles.stepper} role="navigation" aria-label="Wizard steps">
      {steps.map((label, idx) => {
        const stepNum = idx + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;

        return (
          <div
            key={label}
            className={cn(
              styles.step,
              isCompleted && styles.stepCompleted,
              isCurrent && styles.stepCurrent
            )}
            aria-current={isCurrent ? 'step' : undefined}
          >
            {idx > 0 && (
              <div className={cn(styles.connector, isCompleted && styles.connectorCompleted)} />
            )}
            <div className={styles.stepCircle}>
              {isCompleted ? (
                <Check className={styles.checkIcon} aria-hidden="true" />
              ) : (
                <span>{stepNum}</span>
              )}
            </div>
            <span className={styles.stepLabel}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
