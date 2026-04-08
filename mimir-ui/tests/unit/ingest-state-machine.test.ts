import { describe, it, expect } from 'vitest';
import { transitionJob, isTerminal } from '@/domain/IngestJob';
import type { IngestJob } from '@/domain/IngestJob';

describe('IngestJob state machine', () => {
  const initialJob: IngestJob = {
    id: 'job-sm-001',
    title: 'State Machine Test',
    sourceType: 'document',
    status: 'queued',
    instanceName: 'local',
    pagesUpdated: [],
  };

  describe('Full transition sequence: queued → running → complete', () => {
    it('starts in queued status', () => {
      expect(initialJob.status).toBe('queued');
      expect(isTerminal(initialJob.status)).toBe(false);
    });

    it('transitions queued → running', () => {
      const running = transitionJob(initialJob, {
        status: 'running',
        startedAt: '2026-04-08T12:00:00Z',
        currentActivity: 'Parsing document',
      });

      expect(running.status).toBe('running');
      expect(running.startedAt).toBe('2026-04-08T12:00:00Z');
      expect(running.currentActivity).toBe('Parsing document');
      expect(isTerminal(running.status)).toBe(false);
    });

    it('transitions running → complete', () => {
      const running = transitionJob(initialJob, {
        status: 'running',
        startedAt: '2026-04-08T12:00:00Z',
      });
      const complete = transitionJob(running, {
        status: 'complete',
        completedAt: '2026-04-08T12:01:30Z',
        pagesUpdated: ['technical/doc/chapter1.md', 'technical/doc/chapter2.md'],
      });

      expect(complete.status).toBe('complete');
      expect(complete.completedAt).toBe('2026-04-08T12:01:30Z');
      expect(complete.pagesUpdated).toEqual([
        'technical/doc/chapter1.md',
        'technical/doc/chapter2.md',
      ]);
      expect(isTerminal(complete.status)).toBe(true);
    });

    it('preserves all prior fields through the full chain', () => {
      const running = transitionJob(initialJob, { status: 'running' });
      const complete = transitionJob(running, { status: 'complete' });

      expect(complete.id).toBe(initialJob.id);
      expect(complete.title).toBe(initialJob.title);
      expect(complete.sourceType).toBe(initialJob.sourceType);
      expect(complete.instanceName).toBe(initialJob.instanceName);
    });
  });

  describe('Failed transition: queued → running → failed', () => {
    it('transitions queued → running', () => {
      const running = transitionJob(initialJob, {
        status: 'running',
        startedAt: '2026-04-08T12:00:00Z',
      });

      expect(running.status).toBe('running');
      expect(isTerminal(running.status)).toBe(false);
    });

    it('transitions running → failed with errorMessage', () => {
      const running = transitionJob(initialJob, { status: 'running' });
      const failed = transitionJob(running, {
        status: 'failed',
        errorMessage: 'Unable to fetch source URL: timeout after 30s',
        completedAt: '2026-04-08T12:00:31Z',
      });

      expect(failed.status).toBe('failed');
      expect(failed.errorMessage).toBe('Unable to fetch source URL: timeout after 30s');
      expect(failed.completedAt).toBe('2026-04-08T12:00:31Z');
      expect(isTerminal(failed.status)).toBe(true);
    });

    it('failed job has no pagesUpdated', () => {
      const running = transitionJob(initialJob, { status: 'running' });
      const failed = transitionJob(running, {
        status: 'failed',
        errorMessage: 'Parse error',
      });

      expect(failed.pagesUpdated).toEqual([]);
    });
  });

  describe('isTerminal at each step', () => {
    it('queued is not terminal', () => {
      expect(isTerminal('queued')).toBe(false);
    });

    it('running is not terminal', () => {
      expect(isTerminal('running')).toBe(false);
    });

    it('complete is terminal', () => {
      expect(isTerminal('complete')).toBe(true);
    });

    it('failed is terminal', () => {
      expect(isTerminal('failed')).toBe(true);
    });
  });

  describe('Immutability — transitionJob creates new objects', () => {
    it('queued → running does not mutate original', () => {
      const originalStatus = initialJob.status;
      transitionJob(initialJob, { status: 'running' });
      expect(initialJob.status).toBe(originalStatus);
    });

    it('running → complete does not mutate running job', () => {
      const running = transitionJob(initialJob, { status: 'running' });
      const runningStatus = running.status;
      transitionJob(running, { status: 'complete' });
      expect(running.status).toBe(runningStatus);
    });

    it('each transition produces a distinct object reference', () => {
      const running = transitionJob(initialJob, { status: 'running' });
      const complete = transitionJob(running, { status: 'complete' });

      expect(running).not.toBe(initialJob);
      expect(complete).not.toBe(running);
      expect(complete).not.toBe(initialJob);
    });

    it('modifying the returned job does not affect the source job', () => {
      const running = transitionJob(initialJob, { status: 'running' });
      // Mutate the running job directly to test isolation
      (running as Record<string, unknown>)['status'] = 'complete';
      expect(initialJob.status).toBe('queued');
    });
  });
});
