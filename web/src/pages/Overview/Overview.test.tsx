import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OverviewPage } from './index';

vi.mock('@/hooks', () => ({
  useOdinState: vi.fn(),
  useRealms: vi.fn(),
  useCampaigns: vi.fn(),
  useChronicle: vi.fn(),
}));

import { useOdinState, useRealms, useCampaigns, useChronicle } from '@/hooks';

const mockOdinState = {
  status: 'thinking',
  loopCycle: 847291,
  loopPhase: 'THINK',
  loopProgress: 65,
  currentThought: 'Analyzing patterns',
  attention: { primary: 'Storage', secondary: [] },
  disposition: { alertness: 0.7, concern: 0.3, creativity: 0.5 },
  circadianMode: 'active',
  resources: { idleGPUs: 4, totalGPUs: 8, availableCapacity: 35 },
  stats: {
    realmsHealthy: 4,
    realmsTotal: 5,
    activeCampaigns: 2,
    einherjarWorking: 5,
    einherjarTotal: 7,
    observationsToday: 1247,
    decisionsToday: 89,
    actionsToday: 34,
  },
  pendingDecisions: [],
};

const mockRealms = [
  {
    id: 'valhalla',
    name: 'Valhalla',
    description: 'Production cluster',
    location: 'rack-a1',
    status: 'healthy',
    valkyrie: {
      name: 'Brunhilde',
      status: 'observing',
      uptime: '23d',
      observationsToday: 423,
      specialty: 'K8s',
    },
    resources: {
      gpus: { total: 4, active: 3, idle: 1, types: [], temps: [] },
      storage: { used: 2, total: 4, unit: 'TB', pools: [] },
      memory: { used: 128, total: 256, unit: 'GB' },
      pods: { healthy: 45, warning: 3, critical: 0 },
    },
    recentObservations: [],
    autonomy: { restartDevPods: true, restartProdPods: false, networkChanges: false },
  },
  {
    id: 'midgard',
    name: 'Midgard',
    description: 'Dev cluster',
    location: 'rack-b1',
    status: 'healthy',
    valkyrie: null,
    resources: {
      gpus: { total: 0, active: 0, idle: 0, types: [], temps: [] },
      storage: { used: 1, total: 2, unit: 'TB', pools: [] },
      memory: { used: 64, total: 128, unit: 'GB' },
      pods: { healthy: 20, warning: 0, critical: 0 },
    },
    recentObservations: [],
    autonomy: { restartDevPods: true, restartProdPods: false, networkChanges: false },
  },
];

const mockCampaigns = [
  {
    id: 'campaign-1',
    name: 'Storage Migration',
    description: 'Migrate storage backend',
    status: 'active',
    progress: 65,
    confidence: 0.87,
    mergeThreshold: 0.85,
    phases: [],
    einherjar: ['ein-1'],
    started: '2024-01-15',
    eta: '3 days',
    repoAccess: [],
  },
];

const mockChronicleEntries = [
  { type: 'think', time: '14:23:45', message: 'Processing storage migration', agent: 'odin' },
  { type: 'observe', time: '14:23:40', message: 'Detected anomaly in cluster', agent: 'brunhilde' },
];

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when any data is loading', () => {
    vi.mocked(useOdinState).mockReturnValue({
      state: null,
      pendingDecisions: [],
      loading: true,
      error: null,
      approveDecision: vi.fn(),
      rejectDecision: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useRealms).mockReturnValue({ realms: [], loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: [],
      activeCampaigns: [],
      loading: false,
      error: null,
    });
    vi.mocked(useChronicle).mockReturnValue({
      entries: [],
      filter: 'all',
      setFilter: vi.fn(),
      loading: false,
      error: null,
    });

    render(<OverviewPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders OdinStatusBar when data is loaded', async () => {
    vi.mocked(useOdinState).mockReturnValue({
      state: mockOdinState,
      pendingDecisions: [],
      loading: false,
      error: null,
      approveDecision: vi.fn(),
      rejectDecision: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useRealms).mockReturnValue({ realms: mockRealms, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockChronicleEntries,
      filter: 'all',
      setFilter: vi.fn(),
      loading: false,
      error: null,
    });

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText('Odin')).toBeInTheDocument();
    });
  });

  it('renders metrics cards with stats', async () => {
    vi.mocked(useOdinState).mockReturnValue({
      state: mockOdinState,
      pendingDecisions: [],
      loading: false,
      error: null,
      approveDecision: vi.fn(),
      rejectDecision: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useRealms).mockReturnValue({ realms: mockRealms, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockChronicleEntries,
      filter: 'all',
      setFilter: vi.fn(),
      loading: false,
      error: null,
    });

    render(<OverviewPage />);

    // Check for metric labels - may appear multiple times (label + section title)
    expect(screen.getAllByText('Realms').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Campaigns').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Einherjar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Today')).toBeInTheDocument();
    // Check for metric values
    expect(screen.getAllByText('4/5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('5/7').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1247').length).toBeGreaterThanOrEqual(1);
  });

  it('renders realm cards (limited to 4)', async () => {
    vi.mocked(useOdinState).mockReturnValue({
      state: mockOdinState,
      pendingDecisions: [],
      loading: false,
      error: null,
      approveDecision: vi.fn(),
      rejectDecision: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useRealms).mockReturnValue({ realms: mockRealms, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockChronicleEntries,
      filter: 'all',
      setFilter: vi.fn(),
      loading: false,
      error: null,
    });

    render(<OverviewPage />);

    expect(screen.getByText('Valhalla')).toBeInTheDocument();
    expect(screen.getByText('Midgard')).toBeInTheDocument();
  });

  it('renders campaign cards', async () => {
    vi.mocked(useOdinState).mockReturnValue({
      state: mockOdinState,
      pendingDecisions: [],
      loading: false,
      error: null,
      approveDecision: vi.fn(),
      rejectDecision: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useRealms).mockReturnValue({ realms: mockRealms, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockChronicleEntries,
      filter: 'all',
      setFilter: vi.fn(),
      loading: false,
      error: null,
    });

    render(<OverviewPage />);

    expect(screen.getByText('Active Campaigns')).toBeInTheDocument();
    expect(screen.getByText('Storage Migration')).toBeInTheDocument();
  });

  it('renders chronicle entries', async () => {
    vi.mocked(useOdinState).mockReturnValue({
      state: mockOdinState,
      pendingDecisions: [],
      loading: false,
      error: null,
      approveDecision: vi.fn(),
      rejectDecision: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useRealms).mockReturnValue({ realms: mockRealms, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockChronicleEntries,
      filter: 'all',
      setFilter: vi.fn(),
      loading: false,
      error: null,
    });

    render(<OverviewPage />);

    expect(screen.getByText('Recent Chronicle')).toBeInTheDocument();
    expect(screen.getByText('Processing storage migration')).toBeInTheDocument();
    expect(screen.getByText('Detected anomaly in cluster')).toBeInTheDocument();
  });

  it('shows loading when odin state is null', () => {
    vi.mocked(useOdinState).mockReturnValue({
      state: null,
      pendingDecisions: [],
      loading: false,
      error: null,
      approveDecision: vi.fn(),
      rejectDecision: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useRealms).mockReturnValue({ realms: mockRealms, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useChronicle).mockReturnValue({
      entries: mockChronicleEntries,
      filter: 'all',
      setFilter: vi.fn(),
      loading: false,
      error: null,
    });

    render(<OverviewPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
