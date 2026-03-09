/**
 * Status Types - Foundation for all component status variants
 */

// Odin consciousness loop phases
export type OdinStatus = 'sensing' | 'thinking' | 'deciding' | 'acting';

// Health statuses for realms/systems
export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'offline';

// Worker (Einherjar) statuses
export type WorkerStatus = 'working' | 'idle';

// Völundr session statuses
export type SessionStatus =
  | 'created'
  | 'starting'
  | 'provisioning'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'archived';

// Campaign statuses
export type CampaignStatus = 'active' | 'queued' | 'complete';

// Campaign phase statuses
export type PhaseStatus = 'complete' | 'active' | 'pending';

// Valkyrie statuses
export type ValkyrieStatus = 'observing' | 'processing' | 'coordinating' | 'watching';

// Outcome statuses
export type OutcomeStatus = 'success' | 'failed';

// Chronicle record statuses (Volundr session chronicles)
export type ChronicleRecordStatus = 'draft' | 'complete';

// Union type for StatusBadge - covers all ~20 variants
export type StatusType =
  | OdinStatus
  | HealthStatus
  | WorkerStatus
  | SessionStatus
  | CampaignStatus
  | PhaseStatus
  | ValkyrieStatus
  | OutcomeStatus
  | ChronicleRecordStatus;

// Consciousness loop phases (uppercase for display)
export type ConsciousnessPhase = 'SENSE' | 'THINK' | 'DECIDE' | 'ACT';

// Circadian modes for time-of-day display
export type CircadianMode = 'morning' | 'active' | 'evening' | 'night';

// Chronicle entry types
export type ChronicleType =
  | 'think'
  | 'observe'
  | 'decide'
  | 'act'
  | 'complete'
  | 'merge'
  | 'sense'
  | 'checkpoint'
  | 'mimic';

// Action zones for decision urgency
export type ActionZone = 'green' | 'yellow' | 'red';

// Memory types for Muninn
export type MemoryType = 'preference' | 'pattern' | 'fact' | 'outcome';

// Severity levels for observations
export type Severity = 'info' | 'warning' | 'critical';

/**
 * Maps a status to its color accent name
 * Used for CSS custom property lookups
 */
/**
 * Returns true if the session is in a booting state (not yet ready for use).
 */
export function isSessionBooting(status: SessionStatus): boolean {
  return status === 'starting' || status === 'provisioning';
}

/**
 * Returns true if the session is considered active (consuming resources).
 */
export function isSessionActive(status: SessionStatus): boolean {
  return status === 'running' || status === 'starting' || status === 'provisioning';
}

/**
 * Maps a status to its color accent name
 * Used for CSS custom property lookups
 */
export function getStatusColor(status: StatusType): string {
  const colorMap: Record<StatusType, string> = {
    // Odin phases
    sensing: 'cyan',
    thinking: 'amber',
    deciding: 'purple',
    acting: 'emerald',

    // Health statuses
    healthy: 'emerald',
    warning: 'amber',
    critical: 'red',
    offline: 'zinc',

    // Worker statuses
    working: 'emerald',
    idle: 'zinc',

    // Session statuses
    created: 'zinc',
    starting: 'amber',
    provisioning: 'cyan',
    running: 'emerald',
    stopping: 'amber',
    stopped: 'zinc',
    error: 'red',
    archived: 'zinc',

    // Campaign statuses
    active: 'emerald',
    queued: 'amber',
    complete: 'zinc',

    // Phase statuses
    pending: 'zinc',

    // Valkyrie statuses
    observing: 'cyan',
    processing: 'purple',
    coordinating: 'amber',
    watching: 'cyan',

    // Outcome statuses
    success: 'emerald',
    failed: 'red',

    // Chronicle record statuses
    draft: 'amber',
  };

  return colorMap[status] || 'zinc';
}
