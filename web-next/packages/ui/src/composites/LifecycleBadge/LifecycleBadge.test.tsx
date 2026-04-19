import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LifecycleState } from './LifecycleBadge';
import { LifecycleBadge } from './LifecycleBadge';

const ALL_STATES: LifecycleState[] = [
  'requested',
  'provisioning',
  'ready',
  'running',
  'idle',
  'terminating',
  'terminated',
  'failed',
];

describe('LifecycleBadge', () => {
  it('renders the state label', () => {
    render(<LifecycleBadge state="running" />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('has accessible aria-label', () => {
    render(<LifecycleBadge state="provisioning" />);
    expect(screen.getByLabelText('session state: provisioning')).toBeInTheDocument();
  });

  it('applies state modifier class', () => {
    render(<LifecycleBadge state="failed" />);
    expect(screen.getByLabelText('session state: failed')).toHaveClass(
      'niuu-lifecycle-badge--failed',
    );
  });

  it('adds pulse class for provisioning state', () => {
    render(<LifecycleBadge state="provisioning" />);
    expect(screen.getByLabelText('session state: provisioning')).toHaveClass(
      'niuu-lifecycle-badge--pulse',
    );
  });

  it('adds pulse class for running state', () => {
    render(<LifecycleBadge state="running" />);
    expect(screen.getByLabelText('session state: running')).toHaveClass(
      'niuu-lifecycle-badge--pulse',
    );
  });

  it('adds pulse class for terminating state', () => {
    render(<LifecycleBadge state="terminating" />);
    expect(screen.getByLabelText('session state: terminating')).toHaveClass(
      'niuu-lifecycle-badge--pulse',
    );
  });

  it('does not add pulse class for idle state', () => {
    render(<LifecycleBadge state="idle" />);
    expect(screen.getByLabelText('session state: idle')).not.toHaveClass(
      'niuu-lifecycle-badge--pulse',
    );
  });

  it('does not add pulse class for terminated state', () => {
    render(<LifecycleBadge state="terminated" />);
    expect(screen.getByLabelText('session state: terminated')).not.toHaveClass(
      'niuu-lifecycle-badge--pulse',
    );
  });

  it('does not add pulse class for failed state', () => {
    render(<LifecycleBadge state="failed" />);
    expect(screen.getByLabelText('session state: failed')).not.toHaveClass(
      'niuu-lifecycle-badge--pulse',
    );
  });

  it('applies custom className', () => {
    render(<LifecycleBadge state="ready" className="my-class" />);
    expect(screen.getByLabelText('session state: ready')).toHaveClass('my-class');
  });

  it('renders all states without throwing', () => {
    for (const state of ALL_STATES) {
      expect(() => render(<LifecycleBadge state={state} />)).not.toThrow();
    }
  });
});
