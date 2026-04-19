import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createMockVolundrService,
  createMockClusterAdapter,
  createMockSessionStore,
  createMockTemplateStore,
  createMockPtyStream,
  createMockMetricsStream,
  createMockVolundrServices,
} from './mock';
import type { Session } from '../domain/session';
import type { Template } from '../domain/template';

/* ── IVolundrService ────────────────────────────────────────────── */

describe('createMockVolundrService', () => {
  const svc = createMockVolundrService();

  it('getFeatures returns feature flags', async () => {
    const f = await svc.getFeatures();
    expect(f.localMountsEnabled).toBe(true);
    expect(f.fileManagerEnabled).toBe(true);
    expect(f.miniMode).toBe(false);
  });

  it('getSessions returns an empty array', async () => {
    expect(await svc.getSessions()).toEqual([]);
  });

  it('getSession returns null', async () => {
    expect(await svc.getSession('any')).toBeNull();
  });

  it('getActiveSessions returns an empty array', async () => {
    expect(await svc.getActiveSessions()).toEqual([]);
  });

  it('getStats returns zeroed counters', async () => {
    const stats = await svc.getStats();
    expect(stats.activeSessions).toBe(0);
    expect(stats.totalSessions).toBe(0);
  });

  it('getModels returns an empty record', async () => {
    expect(await svc.getModels()).toEqual({});
  });

  it('getRepos returns an empty array', async () => {
    expect(await svc.getRepos()).toEqual([]);
  });

  it('subscribe returns an unsubscribe function', () => {
    const unsub = svc.subscribe(() => undefined);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('subscribeStats returns an unsubscribe function', () => {
    const unsub = svc.subscribeStats(() => undefined);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('startSession returns a session with the given name', async () => {
    const session = await svc.startSession({
      name: 'test-session',
      source: { type: 'git', repo: 'niuulabs/niuu', branch: 'main' },
      model: 'claude-sonnet',
    });
    expect(session.name).toBe('test-session');
    expect(session.model).toBe('claude-sonnet');
  });

  it('connectSession returns a session with the given hostname', async () => {
    const session = await svc.connectSession({ name: 'manual', hostname: 'pod.cluster.local' });
    expect(session.name).toBe('manual');
    expect(session.hostname).toBe('pod.cluster.local');
  });

  it('sendMessage returns an assistant echo', async () => {
    const msg = await svc.sendMessage('s1', 'hello');
    expect(msg.role).toBe('assistant');
    expect(msg.content).toContain('hello');
    expect(msg.sessionId).toBe('s1');
  });

  it('createSecret returns the name + key list', async () => {
    const result = await svc.createSecret('my-secret', { API_KEY: 'val', TOKEN: 'tok' });
    expect(result.name).toBe('my-secret');
    expect(result.keys).toContain('API_KEY');
    expect(result.keys).toContain('TOKEN');
  });

  it('bulkDeleteWorkspaces returns the deleted count', async () => {
    const result = await svc.bulkDeleteWorkspaces(['a', 'b', 'c']);
    expect(result.deleted).toBe(3);
    expect(result.failed).toEqual([]);
  });

  it('getIdentity returns a mock user', async () => {
    const identity = await svc.getIdentity();
    expect(identity.userId).toBeTruthy();
    expect(identity.email).toContain('@');
  });

  it('createToken returns a token string', async () => {
    const result = await svc.createToken('ci-token');
    expect(result.name).toBe('ci-token');
    expect(result.token).toBeTruthy();
  });

  it('updateAdminSettings merges storage settings', async () => {
    const updated = await svc.updateAdminSettings({
      storage: { homeEnabled: false, fileManagerEnabled: true },
    });
    expect(updated.storage.homeEnabled).toBe(false);
  });

  it('getAdminSettings returns default settings', async () => {
    const settings = await svc.getAdminSettings();
    expect(settings.storage.homeEnabled).toBe(true);
  });

  it('mergePullRequest returns merged: true', async () => {
    const result = await svc.mergePullRequest(1, 'https://github.com/niuulabs/niuu', 'squash');
    expect(result.merged).toBe(true);
  });

  it('getCIStatus returns unknown', async () => {
    const status = await svc.getCIStatus(1, 'https://github.com/niuulabs/niuu', 'main');
    expect(status).toBe('unknown');
  });

  it('getPresets returns seed data', async () => {
    const presets = await svc.getPresets();
    expect(presets.length).toBeGreaterThan(0);
  });

  it('savePreset assigns an id when none provided', async () => {
    const preset = await svc.savePreset({
      name: 'new-preset',
      description: '',
      isDefault: false,
      cliTool: 'claude',
      workloadType: 'standard',
      model: null,
      systemPrompt: null,
      resourceConfig: {},
      mcpServers: [],
      terminalSidecar: { enabled: false, allowedCommands: [] },
      skills: [],
      rules: [],
      envVars: {},
      envSecretRefs: [],
      source: null,
      integrationIds: [],
      setupScripts: [],
      workloadConfig: {},
    });
    expect(preset.id).toBeTruthy();
  });

  it('createCredential returns a StoredCredential', async () => {
    const cred = await svc.createCredential({
      name: 'gh-token',
      secretType: 'api_key',
      data: { TOKEN: 'abc' },
    });
    expect(cred.name).toBe('gh-token');
    expect(cred.secretType).toBe('api_key');
    expect(cred.keys).toContain('TOKEN');
  });

  it('reprovisionUser returns success', async () => {
    const result = await svc.reprovisionUser('user-1');
    expect(result.success).toBe(true);
    expect(result.userId).toBe('user-1');
  });

  it('toggleFeature returns the updated feature', async () => {
    const feat = await svc.toggleFeature('volundr', false);
    expect(feat.key).toBe('volundr');
    expect(feat.enabled).toBe(false);
  });

  it('createPullRequest returns a PR object', async () => {
    const pr = await svc.createPullRequest('s1', 'feat: my pr', 'main');
    expect(pr.number).toBeGreaterThan(0);
    expect(pr.status).toBeTruthy();
  });

  it('getFeatureModules returns modules array', async () => {
    const modules = await svc.getFeatureModules();
    expect(Array.isArray(modules)).toBe(true);
  });

  it('createIntegration returns an integration with id', async () => {
    const integration = await svc.createIntegration({ type: 'github' });
    expect(integration.id).toBeTruthy();
  });

  it('testIntegration returns success', async () => {
    const result = await svc.testIntegration('integration-1');
    expect(result.success).toBe(true);
  });

  it('createTenant returns a tenant', async () => {
    const tenant = await svc.createTenant({
      name: 'Acme',
      tier: 'pro',
      maxSessions: 50,
      maxStorageGb: 100,
    });
    expect(tenant.name).toBe('Acme');
  });
});

/* ── IClusterAdapter ────────────────────────────────────────────── */

describe('createMockClusterAdapter', () => {
  const adapter = createMockClusterAdapter();

  it('listClusters returns at least one cluster', async () => {
    const clusters = await adapter.listClusters();
    expect(clusters.length).toBeGreaterThan(0);
  });

  it('getCluster returns a cluster matching the id', async () => {
    const cluster = await adapter.getCluster('custom-id');
    expect(cluster?.id).toBe('custom-id');
  });

  it('scheduleSession returns a pod name', async () => {
    const session: Session = {
      id: 's1',
      ravnId: 'ravn-1',
      personaName: 'persona-1',
      templateId: 'tpl-1',
      clusterId: 'c1',
      state: 'running',
      startedAt: new Date().toISOString(),
    };
    const podName = await adapter.scheduleSession(session, {
      image: 'ubuntu:22.04',
      mounts: [],
      env: {},
      resources: {
        cpuRequest: 1000,
        cpuLimit: 2000,
        memRequestMi: 512,
        memLimitMi: 1024,
        gpuCount: 0,
      },
    });
    expect(typeof podName).toBe('string');
    expect(podName.length).toBeGreaterThan(0);
  });

  it('releaseSession resolves without error', async () => {
    const session: Session = {
      id: 's1',
      ravnId: 'ravn-1',
      personaName: 'persona-1',
      templateId: 'tpl-1',
      clusterId: 'c1',
      state: 'terminating',
      startedAt: new Date().toISOString(),
    };
    await expect(adapter.releaseSession(session)).resolves.toBeUndefined();
  });
});

/* ── ISessionStore ──────────────────────────────────────────────── */

describe('createMockSessionStore', () => {
  it('round-trips a session via save + get', async () => {
    const store = createMockSessionStore();
    const session: Session = {
      id: 'ses-1',
      ravnId: 'r1',
      personaName: 'p1',
      templateId: 'tpl-1',
      clusterId: 'c1',
      state: 'running',
      startedAt: new Date().toISOString(),
    };
    await store.save(session);
    const found = await store.get('ses-1');
    expect(found).toEqual(session);
  });

  it('returns null for an unknown id', async () => {
    const store = createMockSessionStore();
    expect(await store.get('unknown')).toBeNull();
  });

  it('lists all sessions', async () => {
    const store = createMockSessionStore();
    const s1: Session = {
      id: 'a',
      ravnId: 'r',
      personaName: 'p',
      templateId: 't',
      clusterId: 'c',
      state: 'running',
      startedAt: '',
    };
    const s2: Session = {
      id: 'b',
      ravnId: 'r',
      personaName: 'p',
      templateId: 't',
      clusterId: 'c',
      state: 'idle',
      startedAt: '',
    };
    await store.save(s1);
    await store.save(s2);
    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it('filters sessions by state', async () => {
    const store = createMockSessionStore();
    const s1: Session = {
      id: 'a',
      ravnId: 'r',
      personaName: 'p',
      templateId: 't',
      clusterId: 'c',
      state: 'running',
      startedAt: '',
    };
    const s2: Session = {
      id: 'b',
      ravnId: 'r',
      personaName: 'p',
      templateId: 't',
      clusterId: 'c',
      state: 'idle',
      startedAt: '',
    };
    await store.save(s1);
    await store.save(s2);
    const running = await store.list({ state: 'running' });
    expect(running).toHaveLength(1);
    expect(running[0]?.id).toBe('a');
  });

  it('filters sessions by clusterId', async () => {
    const store = createMockSessionStore();
    const s1: Session = {
      id: 'a',
      ravnId: 'r',
      personaName: 'p',
      templateId: 't',
      clusterId: 'cluster-A',
      state: 'running',
      startedAt: '',
    };
    const s2: Session = {
      id: 'b',
      ravnId: 'r',
      personaName: 'p',
      templateId: 't',
      clusterId: 'cluster-B',
      state: 'running',
      startedAt: '',
    };
    await store.save(s1);
    await store.save(s2);
    const filtered = await store.list({ clusterId: 'cluster-A' });
    expect(filtered).toHaveLength(1);
  });

  it('deletes a session', async () => {
    const store = createMockSessionStore();
    const s: Session = {
      id: 'x',
      ravnId: 'r',
      personaName: 'p',
      templateId: 't',
      clusterId: 'c',
      state: 'terminated',
      startedAt: '',
    };
    await store.save(s);
    await store.delete('x');
    expect(await store.get('x')).toBeNull();
  });
});

/* ── ITemplateStore ─────────────────────────────────────────────── */

describe('createMockTemplateStore', () => {
  it('round-trips a template via save + get', async () => {
    const store = createMockTemplateStore();
    const tpl: Template = {
      id: 'tpl-1',
      name: 'Base Dev',
      version: 1,
      image: 'ubuntu:22.04',
      mounts: [],
      env: {},
      tools: [],
      resources: {
        cpuRequest: 500,
        cpuLimit: 1000,
        memRequestMi: 256,
        memLimitMi: 512,
        gpuCount: 0,
      },
      ttlSec: 3600,
      idleTimeoutSec: 600,
      clusterAffinity: [],
    };
    await store.save(tpl);
    const found = await store.get('tpl-1');
    expect(found).toEqual(tpl);
  });

  it('returns null for an unknown id', async () => {
    const store = createMockTemplateStore();
    expect(await store.get('none')).toBeNull();
  });

  it('lists all templates', async () => {
    const store = createMockTemplateStore();
    const tpl: Template = {
      id: 't1',
      name: 'T',
      version: 1,
      image: 'img',
      mounts: [],
      env: {},
      tools: [],
      resources: { cpuRequest: 0, cpuLimit: 0, memRequestMi: 0, memLimitMi: 0, gpuCount: 0 },
      ttlSec: 3600,
      idleTimeoutSec: 600,
      clusterAffinity: [],
    };
    await store.save(tpl);
    const list = await store.list();
    expect(list).toHaveLength(1);
  });

  it('deletes a template', async () => {
    const store = createMockTemplateStore();
    const tpl: Template = {
      id: 'd1',
      name: 'D',
      version: 1,
      image: 'img',
      mounts: [],
      env: {},
      tools: [],
      resources: { cpuRequest: 0, cpuLimit: 0, memRequestMi: 0, memLimitMi: 0, gpuCount: 0 },
      ttlSec: 3600,
      idleTimeoutSec: 600,
      clusterAffinity: [],
    };
    await store.save(tpl);
    await store.delete('d1');
    expect(await store.get('d1')).toBeNull();
  });
});

/* ── IPtyStream ─────────────────────────────────────────────────── */

describe('createMockPtyStream', () => {
  it('connect resolves without error', async () => {
    const pty = createMockPtyStream();
    await expect(pty.connect('s1')).resolves.toBeUndefined();
  });

  it('write echoes output to subscribers', async () => {
    const pty = createMockPtyStream();
    await pty.connect('s1');
    const outputs: string[] = [];
    pty.subscribe('s1', (out) => outputs.push(out.data));
    await pty.write('s1', 'ls -la');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toContain('ls -la');
  });

  it('unsubscribe stops receiving output', async () => {
    const pty = createMockPtyStream();
    await pty.connect('s1');
    const outputs: string[] = [];
    const unsub = pty.subscribe('s1', (out) => outputs.push(out.data));
    unsub();
    await pty.write('s1', 'pwd');
    expect(outputs).toHaveLength(0);
  });

  it('disconnect clears subscriptions', async () => {
    const pty = createMockPtyStream();
    await pty.connect('s1');
    const outputs: string[] = [];
    pty.subscribe('s1', (out) => outputs.push(out.data));
    await pty.disconnect('s1');
    await pty.write('s1', 'test');
    expect(outputs).toHaveLength(0);
  });
});

/* ── IMetricsStream ─────────────────────────────────────────────── */

describe('createMockMetricsStream', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribe returns an unsubscribe function', () => {
    const stream = createMockMetricsStream();
    const unsub = stream.subscribe('s1', () => undefined);
    expect(typeof unsub).toBe('function');
    unsub();
    stream.unsubscribeAll();
  });

  it('unsubscribeAll clears all active subscriptions', () => {
    const stream = createMockMetricsStream();
    stream.subscribe('s1', () => undefined);
    stream.subscribe('s2', () => undefined);
    expect(() => stream.unsubscribeAll()).not.toThrow();
  });
});

/* ── IMetricsStream timer callback ──────────────────────────────── */

describe('createMockMetricsStream timer callback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits metrics to subscribers when interval fires', () => {
    vi.useFakeTimers();
    const stream = createMockMetricsStream();
    const received: { cpuMillicores: number }[] = [];
    stream.subscribe('s1', (m) => received.push(m));
    vi.advanceTimersByTime(5001);
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toHaveProperty('cpuMillicores');
    expect(received[0]).toHaveProperty('memMi');
    expect(received[0]).toHaveProperty('gpuUtilisation');
    stream.unsubscribeAll();
  });

  it('unsub stops receiving after unsubscribing', () => {
    vi.useFakeTimers();
    const stream = createMockMetricsStream();
    const received: unknown[] = [];
    const unsub = stream.subscribe('s2', (m) => received.push(m));
    vi.advanceTimersByTime(5001);
    unsub();
    vi.advanceTimersByTime(5001);
    const countAfterUnsub = received.length;
    vi.advanceTimersByTime(10000);
    expect(received.length).toBe(countAfterUnsub);
  });
});

/* ── IVolundrService — remaining coverage ───────────────────────── */

describe('createMockVolundrService — remaining methods', () => {
  const svc = createMockVolundrService();

  it('updateSession resolves to a session', async () => {
    const session = await svc.updateSession('s1', { name: 'renamed' });
    expect(session).toBeDefined();
  });

  it('stopSession resolves', async () => {
    await expect(svc.stopSession('s1')).resolves.toBeUndefined();
  });

  it('resumeSession resolves', async () => {
    await expect(svc.resumeSession('s1')).resolves.toBeUndefined();
  });

  it('deleteSession resolves', async () => {
    await expect(svc.deleteSession('s1')).resolves.toBeUndefined();
  });

  it('archiveSession resolves', async () => {
    await expect(svc.archiveSession('s1')).resolves.toBeUndefined();
  });

  it('restoreSession resolves', async () => {
    await expect(svc.restoreSession('s1')).resolves.toBeUndefined();
  });

  it('listArchivedSessions returns empty array', async () => {
    expect(await svc.listArchivedSessions()).toEqual([]);
  });

  it('getMessages returns empty array', async () => {
    expect(await svc.getMessages('s1')).toEqual([]);
  });

  it('subscribeMessages returns unsubscribe', () => {
    const unsub = svc.subscribeMessages('s1', () => undefined);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('getLogs returns empty array', async () => {
    expect(await svc.getLogs('s1')).toEqual([]);
  });

  it('subscribeLogs returns unsubscribe', () => {
    const unsub = svc.subscribeLogs('s1', () => undefined);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('getCodeServerUrl returns null', async () => {
    expect(await svc.getCodeServerUrl('s1')).toBeNull();
  });

  it('getChronicle returns null', async () => {
    expect(await svc.getChronicle('s1')).toBeNull();
  });

  it('subscribeChronicle returns unsubscribe', () => {
    const unsub = svc.subscribeChronicle('s1', () => undefined);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('getPullRequests returns empty array', async () => {
    expect(await svc.getPullRequests('https://github.com/niuulabs/niuu')).toEqual([]);
  });

  it('getSessionMcpServers returns empty array', async () => {
    expect(await svc.getSessionMcpServers('s1')).toEqual([]);
  });

  it('searchTrackerIssues returns empty array', async () => {
    expect(await svc.searchTrackerIssues('test')).toEqual([]);
  });

  it('getProjectRepoMappings returns empty array', async () => {
    expect(await svc.getProjectRepoMappings()).toEqual([]);
  });

  it('listUsers returns empty array', async () => {
    expect(await svc.listUsers()).toEqual([]);
  });

  it('deleteTenant resolves', async () => {
    await expect(svc.deleteTenant('t1')).resolves.toBeUndefined();
  });

  it('getTenantMembers returns empty array', async () => {
    expect(await svc.getTenantMembers('t1')).toEqual([]);
  });

  it('reprovisionTenant returns empty array', async () => {
    expect(await svc.reprovisionTenant('t1')).toEqual([]);
  });

  it('getUserCredentials returns empty array', async () => {
    expect(await svc.getUserCredentials()).toEqual([]);
  });

  it('storeUserCredential resolves', async () => {
    await expect(svc.storeUserCredential('key', { val: '1' })).resolves.toBeUndefined();
  });

  it('deleteUserCredential resolves', async () => {
    await expect(svc.deleteUserCredential('key')).resolves.toBeUndefined();
  });

  it('getTenantCredentials returns empty array', async () => {
    expect(await svc.getTenantCredentials()).toEqual([]);
  });

  it('storeTenantCredential resolves', async () => {
    await expect(svc.storeTenantCredential('key', { val: '1' })).resolves.toBeUndefined();
  });

  it('deleteTenantCredential resolves', async () => {
    await expect(svc.deleteTenantCredential('key')).resolves.toBeUndefined();
  });

  it('getIntegrationCatalog returns empty array', async () => {
    expect(await svc.getIntegrationCatalog()).toEqual([]);
  });

  it('getIntegrations returns empty array', async () => {
    expect(await svc.getIntegrations()).toEqual([]);
  });

  it('deleteIntegration resolves', async () => {
    await expect(svc.deleteIntegration('i1')).resolves.toBeUndefined();
  });

  it('getCredentials returns empty array', async () => {
    expect(await svc.getCredentials()).toEqual([]);
  });

  it('getCredential returns null', async () => {
    expect(await svc.getCredential('cred')).toBeNull();
  });

  it('deleteCredential resolves', async () => {
    await expect(svc.deleteCredential('cred')).resolves.toBeUndefined();
  });

  it('getCredentialTypes returns empty array', async () => {
    expect(await svc.getCredentialTypes()).toEqual([]);
  });

  it('listWorkspaces returns empty array', async () => {
    expect(await svc.listWorkspaces()).toEqual([]);
  });

  it('listAllWorkspaces returns empty array', async () => {
    expect(await svc.listAllWorkspaces()).toEqual([]);
  });

  it('restoreWorkspace resolves', async () => {
    await expect(svc.restoreWorkspace('w1')).resolves.toBeUndefined();
  });

  it('deleteWorkspace resolves', async () => {
    await expect(svc.deleteWorkspace('w1')).resolves.toBeUndefined();
  });

  it('getUserFeaturePreferences returns empty array', async () => {
    expect(await svc.getUserFeaturePreferences()).toEqual([]);
  });

  it('updateUserFeaturePreferences returns input unchanged', async () => {
    const prefs = [{ featureKey: 'volundr', visible: true, sortOrder: 1 }];
    const result = await svc.updateUserFeaturePreferences(prefs);
    expect(result).toEqual(prefs);
  });

  it('listTokens returns empty array', async () => {
    expect(await svc.listTokens()).toEqual([]);
  });

  it('revokeToken resolves', async () => {
    await expect(svc.revokeToken('tok-1')).resolves.toBeUndefined();
  });

  it('getAvailableMcpServers returns empty array', async () => {
    expect(await svc.getAvailableMcpServers()).toEqual([]);
  });

  it('getAvailableSecrets returns empty array', async () => {
    expect(await svc.getAvailableSecrets()).toEqual([]);
  });

  it('getClusterResources returns resource info', async () => {
    const res = await svc.getClusterResources();
    expect(res.resourceTypes).toBeDefined();
    expect(res.nodes).toBeDefined();
  });

  it('getTemplates returns empty array', async () => {
    expect(await svc.getTemplates()).toEqual([]);
  });

  it('getTemplate returns null', async () => {
    expect(await svc.getTemplate('tpl')).toBeNull();
  });

  it('saveTemplate returns the passed template', async () => {
    const tpl = {
      name: 'test',
      description: 'desc',
      isDefault: false,
      repos: [],
      setupScripts: [],
      workspaceLayout: {},
      cliTool: 'claude',
      workloadType: 'standard',
      model: null,
      systemPrompt: null,
      resourceConfig: {},
      mcpServers: [],
      envVars: {},
      envSecretRefs: [],
      workloadConfig: {},
      terminalSidecar: { enabled: false, allowedCommands: [] },
      skills: [],
      rules: [],
    };
    const saved = await svc.saveTemplate(tpl);
    expect(saved.name).toBe('test');
  });

  it('deletePreset resolves', async () => {
    await expect(svc.deletePreset('p1')).resolves.toBeUndefined();
  });

  it('getPreset returns preset with id', async () => {
    const preset = await svc.getPreset('p1');
    expect(preset).not.toBeNull();
    expect(preset?.id).toBeTruthy();
  });

  it('getTenant with id returns tenant with matching id', async () => {
    const tenant = await svc.getTenant('my-tenant');
    expect(tenant?.id).toBe('my-tenant');
  });

  it('getTenants returns at least one tenant', async () => {
    const tenants = await svc.getTenants();
    expect(tenants.length).toBeGreaterThan(0);
  });

  it('updateTenant merges data', async () => {
    const updated = await svc.updateTenant('t1', { tier: 'enterprise' });
    expect(updated.tier).toBe('enterprise');
  });
});

/* ── createMockVolundrServices ──────────────────────────────────── */

describe('createMockVolundrServices', () => {
  it('returns all six services', () => {
    const services = createMockVolundrServices();
    expect(services.volundr).toBeDefined();
    expect(services.clusterAdapter).toBeDefined();
    expect(services.sessionStore).toBeDefined();
    expect(services.templateStore).toBeDefined();
    expect(services.ptyStream).toBeDefined();
    expect(services.metricsStream).toBeDefined();
  });
});
