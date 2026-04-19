/**
 * Session lifecycle state machine.
 *
 * Authoritative ordering:
 *   requested → provisioning → ready → running ↔ idle → terminating → terminated
 *
 * Any state can transition to `failed` except `terminated` (terminal).
 */
export type SessionState =
  | 'requested'
  | 'provisioning'
  | 'ready'
  | 'running'
  | 'idle'
  | 'terminating'
  | 'terminated'
  | 'failed';

const VALID_TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  requested: ['provisioning', 'failed'],
  provisioning: ['ready', 'failed'],
  ready: ['running', 'terminating', 'failed'],
  running: ['idle', 'terminating', 'failed'],
  idle: ['running', 'terminating', 'failed'],
  terminating: ['terminated', 'failed'],
  terminated: [],
  failed: [],
};

/** Returns true when `to` is a legal next state from `from`. */
export function canTransition(from: SessionState, to: SessionState): boolean {
  return (VALID_TRANSITIONS[from] as SessionState[]).includes(to);
}

/**
 * Validates and returns the target state.
 * @throws {Error} when the transition is not allowed.
 */
export function transition(from: SessionState, to: SessionState): SessionState {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid session state transition: ${from} → ${to}`);
  }
  return to;
}

/** Returns true for states that have no further valid transitions. */
export function isTerminalState(state: SessionState): boolean {
  return state === 'terminated' || state === 'failed';
}

/** Returns true when the session is consuming resources (running or idle). */
export function isActiveState(state: SessionState): boolean {
  return state === 'running' || state === 'idle';
}

/** Returns true while the session is being provisioned but not yet ready. */
export function isProvisioningState(state: SessionState): boolean {
  return state === 'requested' || state === 'provisioning';
}

/** Returns true once the session pod exists and is accepting connections. */
export function isReadyOrBeyond(state: SessionState): boolean {
  return (
    state === 'ready' ||
    state === 'running' ||
    state === 'idle' ||
    state === 'terminating' ||
    state === 'terminated'
  );
}

/** A Völundr session that runs inside a provisioned pod. */
export interface Session {
  readonly id: string;
  readonly ravnId: string;
  readonly personaName: string;
  readonly sagaId?: string;
  readonly raidId?: string;
  readonly templateId: string;
  readonly clusterId: string;
  readonly state: SessionState;
  readonly startedAt: string;
  readonly readyAt?: string;
  readonly lastActivityAt?: string;
  readonly terminatedAt?: string;
}
