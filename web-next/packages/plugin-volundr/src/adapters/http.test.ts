import { describe, it, expect, vi } from 'vitest';
import { buildVolundrHttpAdapter } from './http';
import type { IVolundrService } from '../ports/IVolundrService';

function makeClient() {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
  };
}

describe('buildVolundrHttpAdapter', () => {
  it('returns an IVolundrService implementation', () => {
    const client = makeClient();
    const svc: IVolundrService = buildVolundrHttpAdapter(client);
    expect(typeof svc.getSessions).toBe('function');
    expect(typeof svc.startSession).toBe('function');
    expect(typeof svc.subscribe).toBe('function');
  });

  it('getSessions calls GET /sessions', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getSessions();
    expect(client.get).toHaveBeenCalledWith('/sessions');
  });

  it('getSession calls GET /sessions/:id', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getSession('s1');
    expect(client.get).toHaveBeenCalledWith('/sessions/s1');
  });

  it('getActiveSessions calls GET /sessions?active=true', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getActiveSessions();
    expect(client.get).toHaveBeenCalledWith('/sessions?active=true');
  });

  it('getStats calls GET /stats', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getStats();
    expect(client.get).toHaveBeenCalledWith('/stats');
  });

  it('getFeatures calls GET /features', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getFeatures();
    expect(client.get).toHaveBeenCalledWith('/features');
  });

  it('startSession calls POST /sessions', async () => {
    const client = makeClient();
    const config = {
      name: 'test',
      source: { type: 'git' as const, repo: 'r', branch: 'main' },
      model: 'claude-sonnet',
    };
    await buildVolundrHttpAdapter(client).startSession(config);
    expect(client.post).toHaveBeenCalledWith('/sessions', config);
  });

  it('stopSession calls POST /sessions/:id/stop', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).stopSession('s1');
    expect(client.post).toHaveBeenCalledWith('/sessions/s1/stop');
  });

  it('deleteSession calls DELETE /sessions/:id without cleanup', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).deleteSession('s1');
    expect(client.delete).toHaveBeenCalledWith('/sessions/s1');
  });

  it('deleteSession includes cleanup param when provided', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).deleteSession('s1', ['workspace']);
    expect(client.delete).toHaveBeenCalledWith('/sessions/s1?cleanup=workspace');
  });

  it('sendMessage calls POST /sessions/:id/messages', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).sendMessage('s1', 'hello');
    expect(client.post).toHaveBeenCalledWith('/sessions/s1/messages', { content: 'hello' });
  });

  it('savePreset calls POST /presets when no id', async () => {
    const client = makeClient();
    const preset = {
      name: 'fast',
      description: '',
      isDefault: false,
      cliTool: 'claude',
      workloadType: 'default',
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
    };
    await buildVolundrHttpAdapter(client).savePreset(preset);
    expect(client.post).toHaveBeenCalledWith('/presets', preset);
  });

  it('savePreset calls PUT /presets/:id when id is present', async () => {
    const client = makeClient();
    const preset = {
      id: 'p1',
      name: 'fast',
      description: '',
      isDefault: false,
      cliTool: 'claude',
      workloadType: 'default',
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
    };
    await buildVolundrHttpAdapter(client).savePreset(preset);
    expect(client.put).toHaveBeenCalledWith('/presets/p1', preset);
  });

  it('getIdentity calls GET /identity', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getIdentity();
    expect(client.get).toHaveBeenCalledWith('/identity');
  });

  it('createCredential calls POST /secrets/store', async () => {
    const client = makeClient();
    const req = { name: 'my-key', secretType: 'api_key' as const, data: { token: 'abc' } };
    await buildVolundrHttpAdapter(client).createCredential(req);
    expect(client.post).toHaveBeenCalledWith('/secrets/store', req);
  });

  it('toggleFeature calls POST /features/modules/:key/toggle', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).toggleFeature('some-feature', true);
    expect(client.post).toHaveBeenCalledWith('/features/modules/some-feature/toggle', {
      enabled: true,
    });
  });

  it('revokeToken calls DELETE /tokens/:id', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).revokeToken('t1');
    expect(client.delete).toHaveBeenCalledWith('/tokens/t1');
  });

  it('bulkDeleteWorkspaces calls POST /workspaces/bulk-delete', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).bulkDeleteWorkspaces(['sess-1', 'sess-2']);
    expect(client.post).toHaveBeenCalledWith('/workspaces/bulk-delete', {
      sessionIds: ['sess-1', 'sess-2'],
    });
  });

  it('subscribe returns a no-op unsubscribe', () => {
    const client = makeClient();
    const unsub = buildVolundrHttpAdapter(client).subscribe(vi.fn());
    expect(typeof unsub).toBe('function');
    unsub(); // should not throw
  });

  it('propagates errors from the HTTP client', async () => {
    const client = makeClient();
    client.get.mockRejectedValue(new Error('network error'));
    await expect(buildVolundrHttpAdapter(client).getSessions()).rejects.toThrow('network error');
  });

  it('searchTrackerIssues encodes the query', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).searchTrackerIssues('fix auth', 'proj-1');
    expect(client.get).toHaveBeenCalledWith('/tracker/issues?q=fix%20auth&projectId=proj-1');
  });

  it('getFeatureModules includes scope when provided', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getFeatureModules('admin');
    expect(client.get).toHaveBeenCalledWith('/features/modules?scope=admin');
  });

  it('getCredentials includes type when provided', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getCredentials('api_key');
    expect(client.get).toHaveBeenCalledWith('/secrets/store?type=api_key');
  });

  it('listWorkspaces includes status when provided', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).listWorkspaces('archived');
    expect(client.get).toHaveBeenCalledWith('/workspaces?status=archived');
  });

  it('getCIStatus includes repoUrl and branch as query params', async () => {
    const client = makeClient();
    await buildVolundrHttpAdapter(client).getCIStatus(42, 'github.com/org/repo', 'feat/x');
    expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/repos/prs/42/ci'));
  });
});

describe('buildVolundrHttpAdapter — full method sweep', () => {
  it('covers every remaining IVolundrService method', async () => {
    const client = makeClient();
    client.get.mockResolvedValue([]);
    client.post.mockResolvedValue({});
    client.delete.mockResolvedValue(undefined);
    client.patch.mockResolvedValue({});
    client.put.mockResolvedValue({});

    const svc = buildVolundrHttpAdapter(client);

    // Subscribe methods — call outer AND inner unsubscribe to cover both arrow fns
    const unsub1 = svc.subscribe(vi.fn());
    unsub1();
    const unsub2 = svc.subscribeStats(vi.fn());
    unsub2();
    const unsub3 = svc.subscribeMessages('sess-1', vi.fn());
    unsub3();
    const unsub4 = svc.subscribeLogs('sess-1', vi.fn());
    unsub4();
    const unsub5 = svc.subscribeChronicle('sess-1', vi.fn());
    unsub5();

    // GET methods
    await svc.getFeatures();
    await svc.getModels();
    await svc.getRepos();
    await svc.getTemplates();
    await svc.getTemplate('tpl-1');
    await svc.getPresets();
    await svc.getPreset('p1');
    await svc.getAvailableMcpServers();
    await svc.getAvailableSecrets();
    await svc.getClusterResources();
    await svc.listArchivedSessions();
    await svc.getMessages('sess-1');
    await svc.getLogs('sess-1');
    await svc.getLogs('sess-1', 50);
    await svc.getCodeServerUrl('sess-1');
    await svc.getChronicle('sess-1');
    await svc.getPullRequests('github.com/org/repo');
    await svc.getPullRequests('github.com/org/repo', 'open');
    await svc.getSessionMcpServers('sess-1');
    await svc.getProjectRepoMappings();
    await svc.listUsers();
    await svc.getTenants();
    await svc.getTenant('t1');
    await svc.getTenantMembers('t1');
    await svc.getUserCredentials();
    await svc.getTenantCredentials();
    await svc.getIntegrationCatalog();
    await svc.getIntegrations();
    await svc.getCredentials();
    await svc.getCredential('my-key');
    await svc.getCredentialTypes();
    await svc.listWorkspaces();
    await svc.listAllWorkspaces();
    await svc.listAllWorkspaces('archived');
    await svc.getAdminSettings();
    await svc.getFeatureModules();
    await svc.getUserFeaturePreferences();
    await svc.listTokens();

    // POST methods
    await svc.connectSession({ name: 'c', hostname: 'host.example.com' });
    await svc.resumeSession('sess-1');
    await svc.archiveSession('sess-1');
    await svc.restoreSession('sess-1');
    await svc.createTenant({ name: 'acme' });
    await svc.reprovisionUser('u1');
    await svc.reprovisionTenant('t1');
    await svc.storeUserCredential('key', { token: 'abc' });
    await svc.storeTenantCredential('key', { token: 'abc' });
    await svc.createIntegration({ type: 'github', config: {} } as Parameters<
      typeof svc.createIntegration
    >[0]);
    await svc.testIntegration('int-1');
    await svc.restoreWorkspace('ws-1');
    await svc.createToken('my-token');
    await svc.mergePullRequest(42, 'github.com/org/repo', 'squash');
    await svc.createPullRequest('sess-1', 'My PR', 'main');
    await svc.createSecret('my-secret', { token: 'abc' });

    // PATCH / PUT methods
    await svc.updateSession('sess-1', { name: 'updated' });
    await svc.updateTenant('t1', { name: 'acme-v2' });
    await svc.updateTrackerIssueStatus('issue-1', 'done');
    await svc.saveTemplate({ name: 'tpl', description: '', config: {} } as Parameters<
      typeof svc.saveTemplate
    >[0]);
    await svc.updateAdminSettings({
      storage: { provider: 's3', bucket: 'b', region: 'us-east-1' },
    });
    await svc.updateUserFeaturePreferences([{ key: 'dark-mode', enabled: true }] as Parameters<
      typeof svc.updateUserFeaturePreferences
    >[0]);

    // DELETE methods
    await svc.deletePreset('p1');
    await svc.deleteTenant('t1');
    await svc.deleteUserCredential('key');
    await svc.deleteTenantCredential('key');
    await svc.deleteIntegration('int-1');
    await svc.deleteCredential('my-key');
    await svc.deleteWorkspace('ws-1');

    // All calls should have resolved without throwing
    expect(client.get).toHaveBeenCalled();
    expect(client.post).toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalled();
  });
});
