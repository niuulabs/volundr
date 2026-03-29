import { describe, it, expect } from 'vitest';
import { getStatusColor, isSessionBooting, isSessionActive } from './status.model';
import type {
  OdinStatus,
  HealthStatus,
  WorkerStatus,
  SessionStatus,
  CampaignStatus,
  PhaseStatus,
  ValkyrieStatus,
  OutcomeStatus,
  StatusType,
  ConsciousnessPhase,
  CircadianMode,
  ChronicleType,
  ActionZone,
  MemoryType,
  Severity,
} from './status.model';

describe('status.model', () => {
  describe('getStatusColor', () => {
    it('returns correct color for Odin phases', () => {
      expect(getStatusColor('sensing')).toBe('cyan');
      expect(getStatusColor('thinking')).toBe('amber');
      expect(getStatusColor('deciding')).toBe('purple');
      expect(getStatusColor('acting')).toBe('emerald');
    });

    it('returns correct color for health statuses', () => {
      expect(getStatusColor('healthy')).toBe('emerald');
      expect(getStatusColor('warning')).toBe('amber');
      expect(getStatusColor('critical')).toBe('red');
      expect(getStatusColor('offline')).toBe('zinc');
    });

    it('returns correct color for worker statuses', () => {
      expect(getStatusColor('working')).toBe('emerald');
      expect(getStatusColor('idle')).toBe('zinc');
    });

    it('returns correct color for session statuses', () => {
      expect(getStatusColor('running')).toBe('emerald');
      expect(getStatusColor('stopped')).toBe('zinc');
      expect(getStatusColor('error')).toBe('red');
      expect(getStatusColor('starting')).toBe('amber');
      expect(getStatusColor('provisioning')).toBe('cyan');
    });

    it('returns correct color for campaign statuses', () => {
      expect(getStatusColor('active')).toBe('emerald');
      expect(getStatusColor('queued')).toBe('amber');
      expect(getStatusColor('complete')).toBe('zinc');
    });

    it('returns correct color for phase statuses', () => {
      expect(getStatusColor('pending')).toBe('zinc');
    });

    it('returns correct color for valkyrie statuses', () => {
      expect(getStatusColor('observing')).toBe('cyan');
      expect(getStatusColor('processing')).toBe('purple');
      expect(getStatusColor('coordinating')).toBe('amber');
      expect(getStatusColor('watching')).toBe('cyan');
    });

    it('returns correct color for outcome statuses', () => {
      expect(getStatusColor('success')).toBe('emerald');
      expect(getStatusColor('failed')).toBe('red');
    });

    it('returns zinc for unknown status', () => {
      expect(getStatusColor('unknown' as StatusType)).toBe('zinc');
    });
  });

  describe('type definitions', () => {
    it('OdinStatus values are valid', () => {
      const statuses: OdinStatus[] = ['sensing', 'thinking', 'deciding', 'acting'];
      expect(statuses).toHaveLength(4);
    });

    it('HealthStatus values are valid', () => {
      const statuses: HealthStatus[] = ['healthy', 'warning', 'critical', 'offline'];
      expect(statuses).toHaveLength(4);
    });

    it('WorkerStatus values are valid', () => {
      const statuses: WorkerStatus[] = ['working', 'idle'];
      expect(statuses).toHaveLength(2);
    });

    it('SessionStatus values are valid', () => {
      const statuses: SessionStatus[] = ['running', 'stopped', 'error', 'starting', 'provisioning'];
      expect(statuses).toHaveLength(5);
    });

    it('CampaignStatus values are valid', () => {
      const statuses: CampaignStatus[] = ['active', 'queued', 'complete'];
      expect(statuses).toHaveLength(3);
    });

    it('PhaseStatus values are valid', () => {
      const statuses: PhaseStatus[] = ['complete', 'active', 'pending'];
      expect(statuses).toHaveLength(3);
    });

    it('ValkyrieStatus values are valid', () => {
      const statuses: ValkyrieStatus[] = ['observing', 'processing', 'coordinating', 'watching'];
      expect(statuses).toHaveLength(4);
    });

    it('OutcomeStatus values are valid', () => {
      const statuses: OutcomeStatus[] = ['success', 'failed'];
      expect(statuses).toHaveLength(2);
    });

    it('ConsciousnessPhase values are valid', () => {
      const phases: ConsciousnessPhase[] = ['SENSE', 'THINK', 'DECIDE', 'ACT'];
      expect(phases).toHaveLength(4);
    });

    it('CircadianMode values are valid', () => {
      const modes: CircadianMode[] = ['morning', 'active', 'evening', 'night'];
      expect(modes).toHaveLength(4);
    });

    it('ChronicleType values are valid', () => {
      const types: ChronicleType[] = [
        'think',
        'observe',
        'decide',
        'act',
        'complete',
        'merge',
        'sense',
        'checkpoint',
        'mimic',
      ];
      expect(types).toHaveLength(9);
    });

    it('ActionZone values are valid', () => {
      const zones: ActionZone[] = ['green', 'yellow', 'red'];
      expect(zones).toHaveLength(3);
    });

    it('MemoryType values are valid', () => {
      const types: MemoryType[] = ['preference', 'pattern', 'fact', 'outcome'];
      expect(types).toHaveLength(4);
    });

    it('Severity values are valid', () => {
      const severities: Severity[] = ['info', 'warning', 'critical'];
      expect(severities).toHaveLength(3);
    });
  });

  describe('isSessionBooting', () => {
    it('returns true for starting and provisioning', () => {
      expect(isSessionBooting('starting')).toBe(true);
      expect(isSessionBooting('provisioning')).toBe(true);
    });

    it('returns false for other statuses', () => {
      expect(isSessionBooting('created')).toBe(false);
      expect(isSessionBooting('running')).toBe(false);
      expect(isSessionBooting('stopped')).toBe(false);
      expect(isSessionBooting('error')).toBe(false);
      expect(isSessionBooting('archived')).toBe(false);
    });
  });

  describe('isSessionActive', () => {
    it('returns true for running, starting, and provisioning', () => {
      expect(isSessionActive('running')).toBe(true);
      expect(isSessionActive('starting')).toBe(true);
      expect(isSessionActive('provisioning')).toBe(true);
    });

    it('returns false for inactive statuses', () => {
      expect(isSessionActive('created')).toBe(false);
      expect(isSessionActive('stopped')).toBe(false);
      expect(isSessionActive('stopping')).toBe(false);
      expect(isSessionActive('error')).toBe(false);
      expect(isSessionActive('archived')).toBe(false);
    });
  });
});
