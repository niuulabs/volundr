import { describe, it, expect } from 'vitest';
import {
  createMockTyrService,
  createMockDispatcherService,
  createMockTyrSessionService,
  createMockTrackerService,
  createMockTyrIntegrationService,
} from './mock';

// ---------------------------------------------------------------------------
// createMockTyrService
// ---------------------------------------------------------------------------

describe('createMockTyrService', () => {
  it('returns 3 seed sagas', async () => {
    const svc = createMockTyrService();
    const sagas = await svc.getSagas();
    expect(sagas).toHaveLength(3);
  });

  it('getSaga returns correct saga', async () => {
    const svc = createMockTyrService();
    const saga = await svc.getSaga('00000000-0000-0000-0000-000000000001');
    expect(saga?.name).toBe('Auth Rewrite');
    expect(saga?.status).toBe('active');
  });

  it('getSaga returns null for unknown id', async () => {
    const svc = createMockTyrService();
    const result = await svc.getSaga('does-not-exist');
    expect(result).toBeNull();
  });

  it('getPhases returns phases for first saga', async () => {
    const svc = createMockTyrService();
    const phases = await svc.getPhases('00000000-0000-0000-0000-000000000001');
    expect(phases).toHaveLength(3);
    expect(phases[0]?.name).toBe('Phase 1: Foundation');
  });

  it('getPhases returns empty array for unknown saga', async () => {
    const svc = createMockTyrService();
    const phases = await svc.getPhases('saga-does-not-exist');
    expect(phases).toHaveLength(0);
  });

  it('createSaga adds a new saga', async () => {
    const svc = createMockTyrService();
    const newSaga = await svc.createSaga('My new feature', 'niuulabs/volundr');
    expect(newSaga.name).toBe('My new feature');
    expect(newSaga.status).toBe('active');
    const all = await svc.getSagas();
    expect(all).toHaveLength(4);
  });

  it('commitSaga creates a saga from request', async () => {
    const svc = createMockTyrService();
    const saga = await svc.commitSaga({
      name: 'Committed Saga',
      slug: 'committed-saga',
      description: 'A committed saga',
      repos: ['niuulabs/volundr'],
      baseBranch: 'main',
      phases: [{ name: 'Phase 1', raids: [] }],
    });
    expect(saga.name).toBe('Committed Saga');
    expect(saga.phaseSummary.total).toBe(1);
  });

  it('spawnPlanSession returns a session id', async () => {
    const svc = createMockTyrService();
    const session = await svc.spawnPlanSession('spec', 'repo');
    expect(session.sessionId).toBeTruthy();
    expect(session.chatEndpoint).toBeNull();
  });

  it('extractStructure returns found: false by default', async () => {
    const svc = createMockTyrService();
    const result = await svc.extractStructure('some text');
    expect(result.found).toBe(false);
    expect(result.structure).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createMockDispatcherService
// ---------------------------------------------------------------------------

describe('createMockDispatcherService', () => {
  it('returns initial running state', async () => {
    const svc = createMockDispatcherService();
    const state = await svc.getState();
    expect(state?.running).toBe(true);
    expect(state?.threshold).toBe(70);
    expect(state?.maxConcurrentRaids).toBe(3);
  });

  it('setRunning toggles running state', async () => {
    const svc = createMockDispatcherService();
    await svc.setRunning(false);
    const state = await svc.getState();
    expect(state?.running).toBe(false);
  });

  it('setThreshold updates threshold', async () => {
    const svc = createMockDispatcherService();
    await svc.setThreshold(85);
    const state = await svc.getState();
    expect(state?.threshold).toBe(85);
  });

  it('setAutoContinue updates autoContinue', async () => {
    const svc = createMockDispatcherService();
    await svc.setAutoContinue(true);
    const state = await svc.getState();
    expect(state?.autoContinue).toBe(true);
  });

  it('getLog returns non-empty log', async () => {
    const svc = createMockDispatcherService();
    const log = await svc.getLog();
    expect(log.length).toBeGreaterThan(0);
  });

  it('setRunning appends to log', async () => {
    const svc = createMockDispatcherService();
    await svc.setRunning(false);
    const log = await svc.getLog();
    expect(log.some((l) => l.includes('running'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createMockTyrSessionService
// ---------------------------------------------------------------------------

describe('createMockTyrSessionService', () => {
  it('returns 2 seed sessions', async () => {
    const svc = createMockTyrSessionService();
    const sessions = await svc.getSessions();
    expect(sessions).toHaveLength(2);
  });

  it('getSession returns correct session', async () => {
    const svc = createMockTyrSessionService();
    const session = await svc.getSession('sess-001');
    expect(session?.raidName).toBe('Implement OIDC flow');
    expect(session?.status).toBe('complete');
  });

  it('getSession returns null for unknown id', async () => {
    const svc = createMockTyrSessionService();
    const result = await svc.getSession('does-not-exist');
    expect(result).toBeNull();
  });

  it('approve changes session status to approved', async () => {
    const svc = createMockTyrSessionService();
    await svc.approve('sess-002');
    const session = await svc.getSession('sess-002');
    expect(session?.status).toBe('approved');
  });

  it('approve on unknown session does not throw', async () => {
    const svc = createMockTyrSessionService();
    await expect(svc.approve('no-such-session')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createMockTrackerService
// ---------------------------------------------------------------------------

describe('createMockTrackerService', () => {
  it('returns 2 seed projects', async () => {
    const svc = createMockTrackerService();
    const projects = await svc.listProjects();
    expect(projects).toHaveLength(2);
  });

  it('getProject returns known project', async () => {
    const svc = createMockTrackerService();
    const project = await svc.getProject('proj-niuu-core');
    expect(project.name).toBe('Niuu Core');
    expect(project.milestoneCount).toBe(8);
  });

  it('getProject throws for unknown project', async () => {
    const svc = createMockTrackerService();
    await expect(svc.getProject('unknown')).rejects.toThrow();
  });

  it('listMilestones filters by projectId', async () => {
    const svc = createMockTrackerService();
    const milestones = await svc.listMilestones('proj-niuu-core');
    expect(milestones.every((m) => m.projectId === 'proj-niuu-core')).toBe(true);
  });

  it('listIssues returns issues for project', async () => {
    const svc = createMockTrackerService();
    const issues = await svc.listIssues('proj-niuu-core');
    expect(Array.isArray(issues)).toBe(true);
  });

  it('importProject creates a saga', async () => {
    const svc = createMockTrackerService();
    const saga = await svc.importProject('proj-niuu-core', ['niuulabs/volundr']);
    expect(saga.name).toBe('Niuu Core');
    expect(saga.repos).toEqual(['niuulabs/volundr']);
    expect(saga.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// createMockTyrIntegrationService
// ---------------------------------------------------------------------------

describe('createMockTyrIntegrationService', () => {
  it('returns 2 seed integrations', async () => {
    const svc = createMockTyrIntegrationService();
    const integrations = await svc.listIntegrations();
    expect(integrations).toHaveLength(2);
  });

  it('createIntegration adds to list', async () => {
    const svc = createMockTyrIntegrationService();
    await svc.createIntegration({
      integrationType: 'slack',
      adapter: 'SlackAdapter',
      credentialName: 'slack-token',
      credentialValue: 'xoxb-secret',
      config: {},
    });
    const integrations = await svc.listIntegrations();
    expect(integrations).toHaveLength(3);
  });

  it('deleteIntegration removes from list', async () => {
    const svc = createMockTyrIntegrationService();
    await svc.deleteIntegration('int-linear');
    const integrations = await svc.listIntegrations();
    expect(integrations.find((i) => i.id === 'int-linear')).toBeUndefined();
  });

  it('toggleIntegration updates enabled flag', async () => {
    const svc = createMockTyrIntegrationService();
    const updated = await svc.toggleIntegration('int-linear', false);
    expect(updated.enabled).toBe(false);
  });

  it('toggleIntegration throws for unknown id', async () => {
    const svc = createMockTyrIntegrationService();
    await expect(svc.toggleIntegration('no-such', true)).rejects.toThrow();
  });

  it('testConnection returns success', async () => {
    const svc = createMockTyrIntegrationService();
    const result = await svc.testConnection('int-linear');
    expect(result.success).toBe(true);
  });

  it('getTelegramSetup returns deeplink', async () => {
    const svc = createMockTyrIntegrationService();
    const setup = await svc.getTelegramSetup();
    expect(setup.deeplink).toBeTruthy();
    expect(setup.token).toBeTruthy();
  });
});
