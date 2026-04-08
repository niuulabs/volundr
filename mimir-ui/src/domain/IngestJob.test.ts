import { describe, it, expect } from 'vitest';
import { transitionJob, isTerminal } from './IngestJob';
import type { IngestJob } from './IngestJob';

const baseJob: IngestJob = {
  id: 'job-001',
  title: 'Test Document',
  sourceType: 'document',
  status: 'queued',
  instanceName: 'local',
  pagesUpdated: [],
};

describe('transitionJob', () => {
  it('merges status field correctly', () => {
    const result = transitionJob(baseJob, { status: 'running' });
    expect(result.status).toBe('running');
  });

  it('merges multiple fields at once', () => {
    const result = transitionJob(baseJob, {
      status: 'running',
      currentActivity: 'Parsing content',
      startedAt: '2026-04-08T12:00:00Z',
    });
    expect(result.status).toBe('running');
    expect(result.currentActivity).toBe('Parsing content');
    expect(result.startedAt).toBe('2026-04-08T12:00:00Z');
  });

  it('merges pagesUpdated field correctly', () => {
    const result = transitionJob(baseJob, {
      status: 'complete',
      pagesUpdated: ['technical/doc/page.md'],
    });
    expect(result.pagesUpdated).toEqual(['technical/doc/page.md']);
  });

  it('merges errorMessage field correctly', () => {
    const result = transitionJob(baseJob, {
      status: 'failed',
      errorMessage: 'Something went wrong',
    });
    expect(result.errorMessage).toBe('Something went wrong');
  });

  it('preserves fields not present in update', () => {
    const result = transitionJob(baseJob, { status: 'running' });
    expect(result.id).toBe(baseJob.id);
    expect(result.title).toBe(baseJob.title);
    expect(result.sourceType).toBe(baseJob.sourceType);
    expect(result.instanceName).toBe(baseJob.instanceName);
  });

  it('does not mutate the original job', () => {
    const original: IngestJob = { ...baseJob };
    transitionJob(baseJob, { status: 'running' });
    expect(baseJob.status).toBe(original.status);
  });

  it('returns a new object reference', () => {
    const result = transitionJob(baseJob, { status: 'running' });
    expect(result).not.toBe(baseJob);
  });

  it('can transition from running to complete', () => {
    const running = transitionJob(baseJob, { status: 'running' });
    const complete = transitionJob(running, {
      status: 'complete',
      completedAt: '2026-04-08T12:01:00Z',
      pagesUpdated: ['technical/doc/result.md'],
    });
    expect(complete.status).toBe('complete');
    expect(complete.completedAt).toBe('2026-04-08T12:01:00Z');
    expect(complete.pagesUpdated).toEqual(['technical/doc/result.md']);
  });

  it('can transition from running to failed', () => {
    const running = transitionJob(baseJob, { status: 'running' });
    const failed = transitionJob(running, {
      status: 'failed',
      errorMessage: 'Network timeout',
    });
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toBe('Network timeout');
  });
});

describe('isTerminal', () => {
  it('returns true for complete status', () => {
    expect(isTerminal('complete')).toBe(true);
  });

  it('returns true for failed status', () => {
    expect(isTerminal('failed')).toBe(true);
  });

  it('returns false for queued status', () => {
    expect(isTerminal('queued')).toBe(false);
  });

  it('returns false for running status', () => {
    expect(isTerminal('running')).toBe(false);
  });
});
