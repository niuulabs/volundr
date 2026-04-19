/**
 * Domain type tests.
 *
 * Covers:
 * 1. Legacy helpers copied from web/ (transitionJob, isTerminal)
 * 2. Round-trip construction of new rich types (Page, Zone, LintIssue, DreamCycle)
 */

import { describe, it, expect } from 'vitest';
import { transitionJob, isTerminal } from './types';
import type {
  IngestJob,
  Page,
  ZoneKeyFacts,
  ZoneRelationships,
  ZoneAssessment,
  ZoneTimeline,
  Zone,
  LintIssue,
  DreamCycle,
  DreamCycleSummary,
} from './types';

// ---------------------------------------------------------------------------
// Legacy helpers (copied + migrated from web/src/modules/mimir/api/types.test.ts)
// ---------------------------------------------------------------------------

const baseJob: IngestJob = {
  id: 'job-1',
  title: 'Test Job',
  sourceType: 'document',
  status: 'queued',
  instanceName: 'worker-1',
  pagesUpdated: [],
};

describe('transitionJob', () => {
  it('merges update into job', () => {
    const result = transitionJob(baseJob, { status: 'running' });
    expect(result.status).toBe('running');
    expect(result.id).toBe('job-1');
  });

  it('preserves fields not in update', () => {
    const result = transitionJob(baseJob, { currentActivity: 'Processing...' });
    expect(result.title).toBe('Test Job');
    expect(result.currentActivity).toBe('Processing...');
  });

  it('returns a new object (does not mutate original)', () => {
    const result = transitionJob(baseJob, { status: 'complete' });
    expect(result).not.toBe(baseJob);
    expect(baseJob.status).toBe('queued');
  });
});

describe('isTerminal', () => {
  it('returns true for complete', () => {
    expect(isTerminal('complete')).toBe(true);
  });

  it('returns true for failed', () => {
    expect(isTerminal('failed')).toBe(true);
  });

  it('returns false for queued', () => {
    expect(isTerminal('queued')).toBe(false);
  });

  it('returns false for running', () => {
    expect(isTerminal('running')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Page round-trip
// ---------------------------------------------------------------------------

describe('Page domain type round-trip', () => {
  it('constructs a page with all zones', () => {
    const keyFacts: ZoneKeyFacts = {
      kind: 'key-facts',
      items: ['Hexagonal architecture', 'No ORM'],
    };
    const relationships: ZoneRelationships = {
      kind: 'relationships',
      items: [{ slug: '/arch/api-design', note: 'API conventions' }],
    };
    const assessment: ZoneAssessment = {
      kind: 'assessment',
      text: 'Architecture is stable.',
    };
    const timeline: ZoneTimeline = {
      kind: 'timeline',
      entries: [{ date: '2026-01-10', note: 'Created', source: 'src-001' }],
    };
    const zones: Zone[] = [keyFacts, relationships, assessment, timeline];

    const page: Page = {
      path: '/arch/overview',
      title: 'Architecture Overview',
      type: 'topic',
      confidence: 'high',
      category: 'architecture',
      summary: 'Overview of the Niuu platform.',
      mounts: ['shared', 'engineering'],
      updatedAt: '2026-04-15T10:00:00Z',
      updatedBy: 'ravn-vidarr',
      sourceIds: ['src-001'],
      related: ['/arch/api-design'],
      size: 4096,
      zones,
    };

    expect(page.type).toBe('topic');
    expect(page.confidence).toBe('high');
    expect(page.mounts).toHaveLength(2);
    expect(page.zones).toHaveLength(4);
  });

  it('constructs an entity page', () => {
    const page: Page = {
      path: '/entities/niuulabs',
      title: 'Niuulabs',
      type: 'entity',
      confidence: 'high',
      entityType: 'org',
      category: 'entities',
      summary: 'The organisation behind Niuu.',
      mounts: ['shared'],
      updatedAt: '2026-04-01T08:00:00Z',
      updatedBy: 'ravn-saga',
      sourceIds: [],
      related: [],
      size: 512,
    };

    expect(page.type).toBe('entity');
    expect(page.entityType).toBe('org');
    expect(page.zones).toBeUndefined();
  });

  it('discriminates zone kinds correctly', () => {
    const zones: Zone[] = [
      { kind: 'key-facts', items: ['fact one'] },
      { kind: 'relationships', items: [] },
      { kind: 'assessment', text: 'looks good' },
      { kind: 'timeline', entries: [] },
    ];

    zones.forEach((zone) => {
      switch (zone.kind) {
        case 'key-facts':
          expect(zone.items).toBeDefined();
          break;
        case 'relationships':
          expect(zone.items).toBeDefined();
          break;
        case 'assessment':
          expect(zone.text).toBeDefined();
          break;
        case 'timeline':
          expect(zone.entries).toBeDefined();
          break;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// LintIssue round-trip
// ---------------------------------------------------------------------------

describe('LintIssue domain type round-trip', () => {
  it('constructs a lint issue with all fields', () => {
    const issue: LintIssue = {
      id: 'li-001',
      rule: 'L05',
      severity: 'warning',
      message: 'Broken wikilink [[/missing-page]]',
      pagePath: '/arch/overview',
      mount: 'shared',
      assignee: 'ravn-vidarr',
      autoFix: false,
      suggestedFix: 'Remove the wikilink',
    };

    expect(issue.rule).toBe('L05');
    expect(issue.severity).toBe('warning');
    expect(issue.autoFix).toBe(false);
  });

  it('constructs a lint issue with auto-fix', () => {
    const issue: LintIssue = {
      id: 'li-002',
      rule: 'L12',
      severity: 'error',
      message: 'Missing category in frontmatter',
      pagePath: '/infra/k8s',
      mount: 'engineering',
      autoFix: true,
    };

    expect(issue.rule).toBe('L12');
    expect(issue.autoFix).toBe(true);
    expect(issue.assignee).toBeUndefined();
  });

  it('supports all lint severity levels', () => {
    const severities: LintIssue['severity'][] = ['error', 'warning', 'info'];
    severities.forEach((severity) => {
      const issue: LintIssue = {
        id: `li-${severity}`,
        rule: 'L01',
        severity,
        message: `${severity} issue`,
        pagePath: '/test',
        mount: 'local',
        autoFix: false,
      };
      expect(issue.severity).toBe(severity);
    });
  });
});

// ---------------------------------------------------------------------------
// DreamCycle round-trip
// ---------------------------------------------------------------------------

describe('DreamCycle domain type round-trip', () => {
  it('constructs a dream cycle with summary', () => {
    const summary: DreamCycleSummary = {
      pagesUpdated: 8,
      entitiesCreated: 2,
      lintFixes: 1,
    };

    const cycle: DreamCycle = {
      id: 'dc-001',
      ravnId: 'ravn-vidarr',
      mounts: ['shared'],
      startedAt: '2026-04-19T02:00:00Z',
      endedAt: '2026-04-19T02:04:12Z',
      durationMs: 252000,
      summary,
      changelog: ['Updated /arch/overview', 'Created entity /entities/fjolnir'],
    };

    expect(cycle.summary.pagesUpdated).toBe(8);
    expect(cycle.summary.entitiesCreated).toBe(2);
    expect(cycle.changelog).toHaveLength(2);
    expect(cycle.durationMs).toBe(252000);
  });

  it('supports multiple mounts in a dream cycle', () => {
    const cycle: DreamCycle = {
      id: 'dc-002',
      ravnId: 'ravn-saga',
      mounts: ['shared', 'engineering', 'local'],
      startedAt: '2026-04-18T14:00:00Z',
      endedAt: '2026-04-18T14:07:33Z',
      durationMs: 453000,
      summary: { pagesUpdated: 14, entitiesCreated: 0, lintFixes: 3 },
      changelog: [],
    };

    expect(cycle.mounts).toHaveLength(3);
    expect(cycle.summary.lintFixes).toBe(3);
  });
});
