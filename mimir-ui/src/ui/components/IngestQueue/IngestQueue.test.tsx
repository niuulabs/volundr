import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IngestQueue } from './IngestQueue';
import type { IngestJob } from '@/domain';

const queuedJob: IngestJob = {
  id: 'job-001',
  title: 'My Document',
  sourceType: 'document',
  status: 'queued',
  instanceName: 'local',
  pagesUpdated: [],
};

const runningJob: IngestJob = {
  id: 'job-002',
  title: 'Running Job',
  sourceType: 'web',
  status: 'running',
  instanceName: 'local',
  pagesUpdated: [],
  currentActivity: 'Parsing markdown',
};

const completeJob: IngestJob = {
  id: 'job-003',
  title: 'Complete Job',
  sourceType: 'text',
  status: 'complete',
  instanceName: 'production',
  pagesUpdated: ['technical/doc/page.md', 'technical/doc/intro.md'],
};

const failedJob: IngestJob = {
  id: 'job-004',
  title: 'Failed Job',
  sourceType: 'document',
  status: 'failed',
  instanceName: 'local',
  pagesUpdated: [],
  errorMessage: 'Network timeout',
};

describe('IngestQueue', () => {
  describe('empty state', () => {
    it('shows "No ingest jobs" when jobs is empty', () => {
      render(<IngestQueue jobs={[]} />);
      expect(screen.getByText('No ingest jobs')).toBeDefined();
    });
  });

  describe('with jobs', () => {
    it('renders job titles', () => {
      render(<IngestQueue jobs={[queuedJob, runningJob]} />);
      expect(screen.getByText('My Document')).toBeDefined();
      expect(screen.getByText('Running Job')).toBeDefined();
    });

    it('shows queue header with Ingest Queue title', () => {
      render(<IngestQueue jobs={[queuedJob]} />);
      expect(screen.getByText('Ingest Queue')).toBeDefined();
    });

    it('shows running count in stats', () => {
      render(<IngestQueue jobs={[runningJob]} />);
      expect(screen.getByText('1 running')).toBeDefined();
    });

    it('shows queued count in stats', () => {
      render(<IngestQueue jobs={[queuedJob]} />);
      expect(screen.getByText('1 queued')).toBeDefined();
    });

    it('shows done count in stats', () => {
      render(<IngestQueue jobs={[completeJob, failedJob]} />);
      expect(screen.getByText('2 done')).toBeDefined();
    });

    it('does not show running stat when no running jobs', () => {
      render(<IngestQueue jobs={[queuedJob]} />);
      expect(screen.queryByText(/running/i)).toBeNull();
    });

    it('does not show queued stat when no queued jobs', () => {
      render(<IngestQueue jobs={[completeJob]} />);
      expect(screen.queryByText(/queued/i)).toBeNull();
    });
  });

  describe('job card status badges', () => {
    it('shows Queued label for queued jobs', () => {
      render(<IngestQueue jobs={[queuedJob]} />);
      expect(screen.getByText('Queued')).toBeDefined();
    });

    it('shows Running label for running jobs', () => {
      render(<IngestQueue jobs={[runningJob]} />);
      expect(screen.getByText('Running')).toBeDefined();
    });

    it('shows Complete label for complete jobs', () => {
      render(<IngestQueue jobs={[completeJob]} />);
      expect(screen.getByText('Complete')).toBeDefined();
    });

    it('shows Failed label for failed jobs', () => {
      render(<IngestQueue jobs={[failedJob]} />);
      expect(screen.getByText('Failed')).toBeDefined();
    });
  });

  describe('job card details', () => {
    it('shows current activity for running jobs', () => {
      render(<IngestQueue jobs={[runningJob]} />);
      expect(screen.getByText('Parsing markdown')).toBeDefined();
    });

    it('shows error message for failed jobs', () => {
      render(<IngestQueue jobs={[failedJob]} />);
      expect(screen.getByText('Network timeout')).toBeDefined();
    });

    it('shows pages updated for complete jobs', () => {
      render(<IngestQueue jobs={[completeJob]} />);
      expect(screen.getByText('technical/doc/page.md')).toBeDefined();
      expect(screen.getByText('technical/doc/intro.md')).toBeDefined();
    });

    it('shows source type', () => {
      render(<IngestQueue jobs={[queuedJob]} />);
      expect(screen.getByText('document')).toBeDefined();
    });

    it('shows instance name', () => {
      render(<IngestQueue jobs={[queuedJob]} />);
      expect(screen.getByText('local')).toBeDefined();
    });

    it('does not show current activity for queued job with no activity', () => {
      render(<IngestQueue jobs={[queuedJob]} />);
      // queuedJob has no currentActivity
      expect(screen.queryByText('Parsing markdown')).toBeNull();
    });
  });
});
