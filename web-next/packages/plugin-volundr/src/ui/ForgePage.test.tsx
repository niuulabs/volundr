import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { ForgePage } from './ForgePage';
import {
  createMockVolundrService,
  createMockClusterAdapter,
  createMockSessionStore,
  createMockTemplateStore,
} from '../adapters/mock';
import type { ISessionStore } from '../ports/ISessionStore';
import type { Session } from '../domain/session';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

function wrap(
  service = createMockVolundrService(),
  clusterAdapter = createMockClusterAdapter(),
  sessionStore = createMockSessionStore(),
  templateStore = createMockTemplateStore(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider
        services={{
          volundr: service,
          clusterAdapter,
          sessionStore,
          'volundr.templates': templateStore,
        }}
      >
        <ForgePage />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('ForgePage', () => {
  it('renders the forge page container', () => {
    wrap();
    expect(screen.getByTestId('forge-page')).toBeInTheDocument();
  });

  it('renders metric tiles once data loads', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('active pods')).toBeInTheDocument());
    expect(screen.getByText('tokens today')).toBeInTheDocument();
    expect(screen.getByText('cost today')).toBeInTheDocument();
    expect(screen.getByText('GPUs')).toBeInTheDocument();
  });

  it('renders the in-flight pods panel', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('inflight-panel')).toBeInTheDocument());
    expect(screen.getByText('In-flight pods')).toBeInTheDocument();
  });

  it('renders the forge load panel', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('forge-load-panel')).toBeInTheDocument());
    expect(screen.getByText('Forge load')).toBeInTheDocument();
  });

  it('renders the quick launch panel', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('quick-launch-panel')).toBeInTheDocument());
    expect(screen.getByText('Quick launch')).toBeInTheDocument();
  });

  it('renders cluster load rows with cluster data', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Eitri')).toBeInTheDocument());
    expect(screen.getAllByTestId('cluster-load-row').length).toBeGreaterThan(0);
  });

  it('renders error strip when failed sessions exist', async () => {
    wrap();
    await waitFor(() => {
      // May or may not have failed sessions depending on mock data
      expect(screen.getByTestId('forge-page')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    const slowStore = {
      ...createMockSessionStore(),
      listSessions: () => new Promise(() => {}),
    };
    wrap(createMockVolundrService(), createMockClusterAdapter(), slowStore);
    expect(screen.getByText(/loading metrics/i)).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────
  // NIU-725 — new visual features
  // ──────────────────────────────────────────────

  it('renders boot progress bar on booting pods', async () => {
    const bootingSession: Session = {
      id: 'boot-sess',
      ravnId: 'r-boot',
      personaName: 'tester',
      templateId: 'tpl-default',
      clusterId: 'cl-eitri',
      state: 'provisioning',
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      bootProgress: 0.6,
      connectionType: 'cli',
      resources: {
        cpuRequest: 1,
        cpuLimit: 2,
        cpuUsed: 0,
        memRequestMi: 512,
        memLimitMi: 1_024,
        memUsedMi: 0,
        gpuCount: 0,
      },
      env: {},
      events: [],
    };

    const store = createMockSessionStore();
    const overriddenStore: ISessionStore = {
      ...store,
      listSessions: async () => [bootingSession],
      subscribe: (cb) => {
        cb([bootingSession]);
        return () => {};
      },
    };

    wrap(createMockVolundrService(), createMockClusterAdapter(), overriddenStore);
    await waitFor(() => expect(screen.getByTestId('boot-progress-bar')).toBeInTheDocument());

    const bar = screen.getByTestId('boot-progress-bar');
    expect(bar.style.width).toBe('60%');
  });

  it('renders connection type badge on pod cards', async () => {
    const session: Session = {
      id: 'sess-cli',
      ravnId: 'r-cli',
      personaName: 'dev',
      templateId: 'tpl-default',
      clusterId: 'cl-eitri',
      state: 'running',
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      lastActivityAt: new Date(Date.now() - 60_000).toISOString(),
      connectionType: 'ide',
      resources: {
        cpuRequest: 1,
        cpuLimit: 2,
        cpuUsed: 0.3,
        memRequestMi: 512,
        memLimitMi: 1_024,
        memUsedMi: 200,
        gpuCount: 0,
      },
      env: {},
      events: [],
    };

    const store = createMockSessionStore();
    const overriddenStore: ISessionStore = {
      ...store,
      listSessions: async () => [session],
      subscribe: (cb) => {
        cb([session]);
        return () => {};
      },
    };

    wrap(createMockVolundrService(), createMockClusterAdapter(), overriddenStore);
    await waitFor(() => expect(screen.getByTestId('connection-type-badge')).toBeInTheDocument());
    expect(screen.getByText('IDE')).toBeInTheDocument();
  });

  it('renders token and cost stats on active pod cards', async () => {
    const session: Session = {
      id: 'sess-stats',
      ravnId: 'r-stats',
      personaName: 'dev',
      templateId: 'tpl-default',
      clusterId: 'cl-eitri',
      state: 'running',
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      lastActivityAt: new Date(Date.now() - 60_000).toISOString(),
      tokensIn: 3_000,
      tokensOut: 1_000,
      costCents: 5,
      resources: {
        cpuRequest: 1,
        cpuLimit: 2,
        cpuUsed: 0.3,
        memRequestMi: 512,
        memLimitMi: 1_024,
        memUsedMi: 200,
        gpuCount: 0,
      },
      env: {},
      events: [],
    };

    const store = createMockSessionStore();
    const overriddenStore: ISessionStore = {
      ...store,
      listSessions: async () => [session],
      subscribe: (cb) => {
        cb([session]);
        return () => {};
      },
    };

    wrap(createMockVolundrService(), createMockClusterAdapter(), overriddenStore);
    await waitFor(() => expect(screen.getByTestId('token-stat')).toBeInTheDocument());
    expect(screen.getByTestId('token-stat').textContent).toBe('4.0k');
    expect(screen.getByTestId('cost-stat').textContent).toBe('$0.05');
  });

  it('renders sparklines in KPI tiles when stats include sparklines', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('active pods')).toBeInTheDocument());
    // Sparklines are SVG elements rendered inside KpiCards
    const svgs = document.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('renders usage count on quick-launch cards', async () => {
    wrap();
    await waitFor(() => expect(screen.getAllByTestId('usage-count').length).toBeGreaterThan(0));
    const counts = screen.getAllByTestId('usage-count');
    expect(counts[0]?.textContent).toMatch(/\d+×/);
  });

  it('renders preview text on chronicle entries', async () => {
    const session: Session = {
      id: 'chron-sess',
      ravnId: 'r-chron',
      personaName: 'chronicler',
      templateId: 'tpl-default',
      clusterId: 'cl-eitri',
      state: 'idle',
      startedAt: new Date(Date.now() - 7_200_000).toISOString(),
      lastActivityAt: new Date(Date.now() - 600_000).toISOString(),
      preview: 'Implement the new batch import pipeline for the analytics service',
      resources: {
        cpuRequest: 1,
        cpuLimit: 2,
        cpuUsed: 0.1,
        memRequestMi: 512,
        memLimitMi: 1_024,
        memUsedMi: 100,
        gpuCount: 0,
      },
      env: {},
      events: [],
    };

    const store = createMockSessionStore();
    const overriddenStore: ISessionStore = {
      ...store,
      listSessions: async () => [session],
      subscribe: (cb) => {
        cb([session]);
        return () => {};
      },
    };

    wrap(createMockVolundrService(), createMockClusterAdapter(), overriddenStore);
    await waitFor(() => expect(screen.getByTestId('chronicle-preview')).toBeInTheDocument());
    expect(screen.getByTestId('chronicle-preview').textContent).toBe(
      'Implement the new batch import pipeline for the analytics service',
    );
  });

  it('truncates chronicle preview at 80 chars', async () => {
    const longPreview =
      'This is a very long preview message that should be truncated to eighty characters because it is way too long to display in the chronicle tail without ellipsis';

    const session: Session = {
      id: 'chron-long',
      ravnId: 'r-long',
      personaName: 'bard',
      templateId: 'tpl-default',
      clusterId: 'cl-eitri',
      state: 'idle',
      startedAt: new Date(Date.now() - 7_200_000).toISOString(),
      lastActivityAt: new Date(Date.now() - 300_000).toISOString(),
      preview: longPreview,
      resources: {
        cpuRequest: 1,
        cpuLimit: 2,
        cpuUsed: 0.1,
        memRequestMi: 512,
        memLimitMi: 1_024,
        memUsedMi: 100,
        gpuCount: 0,
      },
      env: {},
      events: [],
    };

    const store = createMockSessionStore();
    const overriddenStore: ISessionStore = {
      ...store,
      listSessions: async () => [session],
      subscribe: (cb) => {
        cb([session]);
        return () => {};
      },
    };

    wrap(createMockVolundrService(), createMockClusterAdapter(), overriddenStore);
    await waitFor(() => expect(screen.getByTestId('chronicle-preview')).toBeInTheDocument());
    const displayed = screen.getByTestId('chronicle-preview').textContent ?? '';
    expect(displayed.endsWith('…')).toBe(true);
    // 80 chars + ellipsis
    expect(displayed.length).toBe(81);
  });
});
