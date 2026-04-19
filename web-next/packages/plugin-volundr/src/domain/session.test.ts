import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transition,
  isTerminalState,
  isActiveState,
  isProvisioningState,
  isReadyOrBeyond,
  type SessionState,
} from './session';

describe('canTransition', () => {
  it('allows requested → provisioning', () => {
    expect(canTransition('requested', 'provisioning')).toBe(true);
  });

  it('allows requested → failed', () => {
    expect(canTransition('requested', 'failed')).toBe(true);
  });

  it('allows provisioning → ready', () => {
    expect(canTransition('provisioning', 'ready')).toBe(true);
  });

  it('allows provisioning → failed', () => {
    expect(canTransition('provisioning', 'failed')).toBe(true);
  });

  it('allows ready → running', () => {
    expect(canTransition('ready', 'running')).toBe(true);
  });

  it('allows ready → terminating', () => {
    expect(canTransition('ready', 'terminating')).toBe(true);
  });

  it('allows ready → failed', () => {
    expect(canTransition('ready', 'failed')).toBe(true);
  });

  it('allows running → idle', () => {
    expect(canTransition('running', 'idle')).toBe(true);
  });

  it('allows running → terminating', () => {
    expect(canTransition('running', 'terminating')).toBe(true);
  });

  it('allows running → failed', () => {
    expect(canTransition('running', 'failed')).toBe(true);
  });

  it('allows idle → running (resume)', () => {
    expect(canTransition('idle', 'running')).toBe(true);
  });

  it('allows idle → terminating', () => {
    expect(canTransition('idle', 'terminating')).toBe(true);
  });

  it('allows idle → failed', () => {
    expect(canTransition('idle', 'failed')).toBe(true);
  });

  it('allows terminating → terminated', () => {
    expect(canTransition('terminating', 'terminated')).toBe(true);
  });

  it('allows terminating → failed', () => {
    expect(canTransition('terminating', 'failed')).toBe(true);
  });

  it('rejects terminated → anything', () => {
    const targets: SessionState[] = [
      'requested', 'provisioning', 'ready', 'running', 'idle', 'terminating', 'failed',
    ];
    for (const to of targets) {
      expect(canTransition('terminated', to)).toBe(false);
    }
  });

  it('rejects failed → anything', () => {
    const targets: SessionState[] = [
      'requested', 'provisioning', 'ready', 'running', 'idle', 'terminating', 'terminated',
    ];
    for (const to of targets) {
      expect(canTransition('failed', to)).toBe(false);
    }
  });

  it('rejects requested → running (skips states)', () => {
    expect(canTransition('requested', 'running')).toBe(false);
  });

  it('rejects requested → idle (skips states)', () => {
    expect(canTransition('requested', 'idle')).toBe(false);
  });

  it('rejects provisioning → running (skips ready)', () => {
    expect(canTransition('provisioning', 'running')).toBe(false);
  });

  it('rejects running → requested', () => {
    expect(canTransition('running', 'requested')).toBe(false);
  });

  it('rejects running → provisioning', () => {
    expect(canTransition('running', 'provisioning')).toBe(false);
  });

  it('rejects idle → provisioning', () => {
    expect(canTransition('idle', 'provisioning')).toBe(false);
  });
});

describe('transition', () => {
  it('returns the target state on a valid transition', () => {
    expect(transition('requested', 'provisioning')).toBe('provisioning');
    expect(transition('provisioning', 'ready')).toBe('ready');
    expect(transition('ready', 'running')).toBe('running');
    expect(transition('running', 'idle')).toBe('idle');
    expect(transition('idle', 'running')).toBe('running');
    expect(transition('running', 'terminating')).toBe('terminating');
    expect(transition('terminating', 'terminated')).toBe('terminated');
  });

  it('throws on an invalid transition', () => {
    expect(() => transition('terminated', 'running')).toThrow(
      'Invalid session state transition: terminated → running',
    );
  });

  it('throws when skipping states', () => {
    expect(() => transition('requested', 'running')).toThrow();
  });

  it('throws from a failed state', () => {
    expect(() => transition('failed', 'provisioning')).toThrow();
  });
});

describe('isTerminalState', () => {
  it('returns true for terminated', () => {
    expect(isTerminalState('terminated')).toBe(true);
  });

  it('returns true for failed', () => {
    expect(isTerminalState('failed')).toBe(true);
  });

  it('returns false for all non-terminal states', () => {
    const live: SessionState[] = [
      'requested', 'provisioning', 'ready', 'running', 'idle', 'terminating',
    ];
    for (const s of live) {
      expect(isTerminalState(s)).toBe(false);
    }
  });
});

describe('isActiveState', () => {
  it('returns true for running', () => {
    expect(isActiveState('running')).toBe(true);
  });

  it('returns true for idle', () => {
    expect(isActiveState('idle')).toBe(true);
  });

  it('returns false for non-active states', () => {
    const inactive: SessionState[] = [
      'requested', 'provisioning', 'ready', 'terminating', 'terminated', 'failed',
    ];
    for (const s of inactive) {
      expect(isActiveState(s)).toBe(false);
    }
  });
});

describe('isProvisioningState', () => {
  it('returns true for requested', () => {
    expect(isProvisioningState('requested')).toBe(true);
  });

  it('returns true for provisioning', () => {
    expect(isProvisioningState('provisioning')).toBe(true);
  });

  it('returns false for ready and beyond', () => {
    const others: SessionState[] = [
      'ready', 'running', 'idle', 'terminating', 'terminated', 'failed',
    ];
    for (const s of others) {
      expect(isProvisioningState(s)).toBe(false);
    }
  });
});

describe('isReadyOrBeyond', () => {
  it('returns false for early states', () => {
    expect(isReadyOrBeyond('requested')).toBe(false);
    expect(isReadyOrBeyond('provisioning')).toBe(false);
    expect(isReadyOrBeyond('failed')).toBe(false);
  });

  it('returns true for ready through terminated', () => {
    const advanced: SessionState[] = ['ready', 'running', 'idle', 'terminating', 'terminated'];
    for (const s of advanced) {
      expect(isReadyOrBeyond(s)).toBe(true);
    }
  });
});
