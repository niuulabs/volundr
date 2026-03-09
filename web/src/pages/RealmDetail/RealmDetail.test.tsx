import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RealmDetailPage } from './index';
import type { RealmDetail } from '@/models';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/hooks', () => ({
  useRealmDetail: vi.fn(),
}));

import { useRealmDetail } from '@/hooks';

const mockDetail: RealmDetail = {
  id: 'vanaheim',
  name: 'Vanaheim',
  description: 'Production cluster',
  location: 'ca-hamilton-1',
  status: 'healthy',
  health: {
    status: 'healthy',
    inputs: {
      nodesReady: 3,
      nodesTotal: 3,
      podRunningRatio: 0.98,
      volumesDegraded: 0,
      volumesFaulted: 0,
      recentErrorCount: 0,
    },
    reason: '',
  },
  resources: {
    cpu: { capacity: 40, allocatable: 36, unit: 'cores' },
    memory: { capacity: 256, allocatable: 230, unit: 'GiB' },
    gpuCount: 4,
    pods: { running: 42, pending: 2, failed: 1, succeeded: 12, unknown: 0 },
  },
  valkyrie: {
    name: 'Brynhildr',
    status: 'observing',
    uptime: '14d 07:23:41',
    observationsToday: 412,
    specialty: 'Production workloads',
  },
  nodes: [
    {
      name: 'vanaheim-cp-1',
      status: 'Ready',
      roles: ['control-plane'],
      cpu: { capacity: 8, allocatable: 7, unit: 'cores' },
      memory: { capacity: 32, allocatable: 28, unit: 'GiB' },
      gpuCount: 0,
      conditions: [{ conditionType: 'Ready', status: 'True', message: '' }],
    },
    {
      name: 'vanaheim-worker-1',
      status: 'Ready',
      roles: ['worker'],
      cpu: { capacity: 16, allocatable: 14.5, unit: 'cores' },
      memory: { capacity: 64, allocatable: 58, unit: 'GiB' },
      gpuCount: 2,
      conditions: [{ conditionType: 'Ready', status: 'True', message: '' }],
    },
  ],
  workloads: {
    namespaceCount: 12,
    deploymentTotal: 18,
    deploymentHealthy: 16,
    statefulsetCount: 3,
    daemonsetCount: 4,
    pods: { running: 42, pending: 2, failed: 1, succeeded: 12, unknown: 0 },
  },
  storage: {
    totalCapacityBytes: 2_000_000_000_000,
    usedBytes: 820_000_000_000,
    volumes: { healthy: 14, degraded: 1, faulted: 0 },
  },
  events: [
    {
      timestamp: '2026-02-10T10:45:00Z',
      severity: 'info',
      source: 'kubelet',
      message: 'All nodes reporting healthy',
      involvedObject: 'cluster/vanaheim',
    },
    {
      timestamp: '2026-02-10T10:30:00Z',
      severity: 'warning',
      source: 'deployment-controller',
      message: 'Pod restart detected',
      involvedObject: 'deployment/api-gateway',
    },
    {
      timestamp: '2026-02-10T10:15:00Z',
      severity: 'error',
      source: 'kubelet',
      message: 'OOMKilled container in pod web-api-xyz',
      involvedObject: 'pod/web-api-xyz',
    },
  ],
};

function renderPage(realmId = 'vanaheim') {
  return render(
    <MemoryRouter initialEntries={[`/realms/${realmId}`]}>
      <Routes>
        <Route path="/realms/:realmId" element={<RealmDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RealmDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: null,
      loading: true,
      error: null,
    });

    renderPage();
    expect(screen.getByText('Loading realm...')).toBeInTheDocument();
  });

  it('shows error state', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: null,
      loading: false,
      error: new Error('Network failure'),
    });

    renderPage();
    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });

  it('shows realm not found when detail is null', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: null,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('Realm not found')).toBeInTheDocument();
  });

  it('renders realm name and description', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('Vanaheim')).toBeInTheDocument();
    expect(screen.getByText(/Production cluster/)).toBeInTheDocument();
    expect(screen.getByText(/ca-hamilton-1/)).toBeInTheDocument();
  });

  it('renders back button that navigates to /realms', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    const backBtn = screen.getByRole('button', { name: /Realms/ });
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/realms');
  });

  it('renders valkyrie info when assigned', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('Brynhildr')).toBeInTheDocument();
    expect(screen.getByText('Production workloads')).toBeInTheDocument();
    expect(screen.getByText('Not yet deployed')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText('14d 07:23:41')).toBeInTheDocument();
  });

  it('renders no valkyrie message when unassigned', () => {
    const noValkyrie = { ...mockDetail, valkyrie: undefined };
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: noValkyrie,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('No Valkyrie assigned')).toBeInTheDocument();
    expect(screen.getByText('This realm has no observer')).toBeInTheDocument();
  });

  it('renders metric tiles (CPU, Memory, Pods, GPUs, Nodes)', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    // CPU - label appears in metric tile and node cards, use getAllByText
    expect(screen.getAllByText('CPU').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('36/40')).toBeInTheDocument();
    expect(screen.getByText('cores allocatable')).toBeInTheDocument();

    // Memory
    expect(screen.getAllByText('Memory').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('230/256 GiB')).toBeInTheDocument();
    expect(screen.getByText('allocatable')).toBeInTheDocument();

    // Pods
    expect(screen.getByText('Pods')).toBeInTheDocument();
    expect(screen.getByText('42/45')).toBeInTheDocument();

    // GPUs (metric tile + node card)
    expect(screen.getAllByText('GPUs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('allocated')).toBeInTheDocument();

    // Nodes (metric tile + section header)
    expect(screen.getAllByText('Nodes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('hides GPU tile when gpuCount is 0', () => {
    const noGpu = { ...mockDetail, resources: { ...mockDetail.resources, gpuCount: 0 } };
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: noGpu,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.queryByText('allocated')).not.toBeInTheDocument();
  });

  it('renders node cards', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('vanaheim-cp-1')).toBeInTheDocument();
    expect(screen.getByText('vanaheim-worker-1')).toBeInTheDocument();
    expect(screen.getByText('control-plane')).toBeInTheDocument();
    expect(screen.getByText('worker')).toBeInTheDocument();
  });

  it('shows "No node data available" when no nodes', () => {
    const noNodes = { ...mockDetail, nodes: [] };
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: noNodes,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('No node data available')).toBeInTheDocument();
  });

  it('renders workload counts', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('16/18')).toBeInTheDocument();
    expect(screen.getByText('Deployments healthy')).toBeInTheDocument();
    expect(screen.getByText('StatefulSets')).toBeInTheDocument();
    expect(screen.getByText('DaemonSets')).toBeInTheDocument();
  });

  it('renders storage section with volume counts', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('14 healthy')).toBeInTheDocument();
    expect(screen.getByText('1 degraded')).toBeInTheDocument();
  });

  it('renders events', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('Recent Events')).toBeInTheDocument();
    expect(screen.getByText('All nodes reporting healthy')).toBeInTheDocument();
    expect(screen.getByText('Pod restart detected')).toBeInTheDocument();
    expect(screen.getByText('OOMKilled container in pod web-api-xyz')).toBeInTheDocument();
  });

  it('filters events by severity', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();

    const warningTab = screen.getByRole('button', { name: 'warning' });
    fireEvent.click(warningTab);

    expect(screen.getByText('Pod restart detected')).toBeInTheDocument();
    expect(screen.queryByText('All nodes reporting healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('OOMKilled container in pod web-api-xyz')).not.toBeInTheDocument();
  });

  it('shows "No events" when filtered list is empty', () => {
    const noEvents = { ...mockDetail, events: [] };
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: noEvents,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('No events')).toBeInTheDocument();
  });

  it('shows health reason when present', () => {
    const withReason = {
      ...mockDetail,
      health: {
        ...mockDetail.health,
        reason: '1 volume degraded',
      },
    };
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: withReason,
      loading: false,
      error: null,
    });

    renderPage();
    expect(screen.getByText('1 volume degraded')).toBeInTheDocument();
  });

  it('renders node GPU count when > 0', () => {
    vi.mocked(useRealmDetail).mockReturnValue({
      detail: mockDetail,
      loading: false,
      error: null,
    });

    renderPage();
    // vanaheim-worker-1 has gpuCount: 2
    const gpuLabels = screen.getAllByText('GPUs');
    expect(gpuLabels.length).toBeGreaterThanOrEqual(1);
  });
});
