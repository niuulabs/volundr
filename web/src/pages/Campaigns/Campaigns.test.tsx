import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampaignsPage } from './index';

vi.mock('@/hooks', () => ({
  useCampaigns: vi.fn(),
  useEinherjar: vi.fn(),
}));

import { useCampaigns, useEinherjar } from '@/hooks';

const mockCampaigns = [
  {
    id: 'campaign-1',
    name: 'Storage Migration',
    description: 'Migrate all services to new storage backend',
    status: 'active',
    progress: 65,
    confidence: 0.87,
    mergeThreshold: 0.85,
    phases: [
      {
        id: 'phase-1',
        name: 'Analysis',
        repo: 'storage-service',
        status: 'complete',
        pr: '#47',
        merged: true,
      },
      {
        id: 'phase-2',
        name: 'Implementation',
        repo: 'api-gateway',
        status: 'active',
        tasks: { total: 5, complete: 3, active: 1, pending: 1 },
      },
      { id: 'phase-3', name: 'Testing', repo: 'e2e-tests', status: 'pending' },
    ],
    einherjar: ['ein-1', 'ein-2'],
    started: '2024-01-15',
    eta: '3 days',
    repoAccess: ['storage-service', 'api-gateway', 'e2e-tests'],
  },
  {
    id: 'campaign-2',
    name: 'API Refactor',
    description: 'Refactor API endpoints for v2',
    status: 'queued',
    progress: 0,
    confidence: null,
    mergeThreshold: 0.85,
    phases: [],
    einherjar: ['ein-3'],
    started: null,
    eta: '1 week',
    repoAccess: ['api-service'],
  },
];

const mockWorkers = [
  {
    id: 'ein-1',
    name: 'Skuld-Alpha',
    status: 'working',
    task: 'Storage adapter',
    realm: 'valhalla',
    campaign: 'campaign-1',
    progress: 75,
    model: 'qwen3-70b',
  },
  {
    id: 'ein-2',
    name: 'Skuld-Beta',
    status: 'working',
    task: 'API integration',
    realm: 'valhalla',
    campaign: 'campaign-1',
    progress: 50,
    model: 'qwen3-32b',
  },
  {
    id: 'ein-3',
    name: 'Skuld-Gamma',
    status: 'idle',
    task: 'Waiting',
    realm: 'midgard',
    campaign: 'campaign-2',
    progress: null,
    model: 'claude-opus',
  },
];

describe('CampaignsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when loading', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: [],
      activeCampaigns: [],
      loading: true,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: [], loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('Campaigns')).toBeInTheDocument();
    expect(screen.getByText('Multi-repo coordinated work managed by Tyr')).toBeInTheDocument();
  });

  it('renders New Campaign button', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('New Campaign')).toBeInTheDocument();
  });

  it('renders all campaign cards', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    // Campaign names appear in both list and detail panel
    expect(screen.getAllByText('Storage Migration').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('API Refactor').length).toBeGreaterThanOrEqual(1);
  });

  it('selects first campaign by default', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    // Detail panel should show first campaign description
    expect(
      screen.getAllByText('Migrate all services to new storage backend').length
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders campaign phases in detail panel', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('Phases')).toBeInTheDocument();
    expect(screen.getByText('Analysis')).toBeInTheDocument();
    expect(screen.getByText('Implementation')).toBeInTheDocument();
    expect(screen.getByText('Testing')).toBeInTheDocument();
  });

  it('renders phase status', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('renders phase PR when available', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('PR #47')).toBeInTheDocument();
  });

  it('renders phase task counts when available', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('3 done')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
  });

  it('renders assigned einherjar section', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('Assigned Einherjar')).toBeInTheDocument();
    expect(screen.getByText('Skuld-Alpha')).toBeInTheDocument();
    expect(screen.getByText('Skuld-Beta')).toBeInTheDocument();
  });

  it('renders repository access section', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('Repository Access')).toBeInTheDocument();
    // Repo names may appear in both phases and repo access
    expect(screen.getAllByText('storage-service').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('api-gateway').length).toBeGreaterThanOrEqual(1);
  });

  it('changes selection when campaign clicked', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    render(<CampaignsPage />);

    // Click on the second campaign by finding its title
    const apiRefactorTexts = screen.getAllByText('API Refactor');
    const apiRefactorCard =
      apiRefactorTexts[0].closest('div[class*="campaignCardWrapper"]') ||
      apiRefactorTexts[0].parentElement;
    fireEvent.click(apiRefactorCard!);

    // Detail panel should now show the second campaign description
    expect(screen.getAllByText('Refactor API endpoints for v2').length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty detail when no campaigns', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: [],
      activeCampaigns: [],
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: [], loading: false, error: null });

    render(<CampaignsPage />);
    expect(screen.getByText('Select a campaign to view details')).toBeInTheDocument();
  });

  it('applies selected style to selected campaign', () => {
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });

    const { container } = render(<CampaignsPage />);
    const selectedWrapper = container.querySelector('[class*="selected"]');
    expect(selectedWrapper).toBeInTheDocument();
  });
});
