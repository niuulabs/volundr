import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EinherjarPage } from './index';

vi.mock('@/modules/volundr/hooks/useEinherjar', () => ({
  useEinherjar: vi.fn(),
}));

vi.mock('@/modules/volundr/hooks/useCampaigns', () => ({
  useCampaigns: vi.fn(),
}));

import { useEinherjar } from '@/modules/volundr/hooks/useEinherjar';
import { useCampaigns } from '@/modules/volundr/hooks/useCampaigns';

const mockWorkers = [
  {
    id: 'ein-1',
    name: 'Skuld-Alpha',
    status: 'working',
    task: 'Implementing storage adapter for TrueNAS integration',
    realm: 'valhalla',
    campaign: 'campaign-1',
    progress: 75,
    model: 'qwen3-coder:70b',
  },
  {
    id: 'ein-2',
    name: 'Skuld-Beta',
    status: 'working',
    task: 'API gateway middleware refactoring',
    realm: 'midgard',
    campaign: 'campaign-1',
    progress: 50,
    model: 'qwen3-coder:32b',
  },
  {
    id: 'ein-3',
    name: 'Skuld-Gamma',
    status: 'idle',
    task: 'Awaiting next task assignment',
    realm: 'asgard',
    campaign: null,
    progress: null,
    model: 'claude-opus',
  },
  {
    id: 'ein-4',
    name: 'Skuld-Delta',
    status: 'working',
    task: 'Database migration scripts',
    realm: 'valhalla',
    campaign: 'campaign-2',
    progress: 30,
    model: 'deepseek-r1:70b',
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
    einherjar: ['ein-1', 'ein-2'],
    started: '2024-01-15',
    eta: '3 days',
    repoAccess: [],
  },
  {
    id: 'campaign-2',
    name: 'Database Upgrade',
    description: 'Upgrade PostgreSQL',
    status: 'active',
    progress: 30,
    confidence: 0.72,
    mergeThreshold: 0.85,
    phases: [],
    einherjar: ['ein-4'],
    started: '2024-01-18',
    eta: '1 week',
    repoAccess: [],
  },
];

describe('EinherjarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when workers loading', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: [], loading: true, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: [],
      activeCampaigns: [],
      loading: false,
      error: null,
    });

    render(<EinherjarPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows loading state when campaigns loading', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: [],
      activeCampaigns: [],
      loading: true,
      error: null,
    });

    render(<EinherjarPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });

    render(<EinherjarPage />);
    expect(screen.getByText('Einherjar')).toBeInTheDocument();
    expect(screen.getByText('Coding agents executing campaign tasks')).toBeInTheDocument();
  });

  it('renders worker status counts', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });

    render(<EinherjarPage />);
    expect(screen.getByText('3 working · 1 idle')).toBeInTheDocument();
  });

  it('renders all worker cards', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });

    render(<EinherjarPage />);
    expect(screen.getByText('Skuld-Alpha')).toBeInTheDocument();
    expect(screen.getByText('Skuld-Beta')).toBeInTheDocument();
    expect(screen.getByText('Skuld-Gamma')).toBeInTheDocument();
    expect(screen.getByText('Skuld-Delta')).toBeInTheDocument();
  });

  it('renders worker tasks', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });

    render(<EinherjarPage />);
    expect(
      screen.getByText('Implementing storage adapter for TrueNAS integration')
    ).toBeInTheDocument();
    expect(screen.getByText('API gateway middleware refactoring')).toBeInTheDocument();
    expect(screen.getByText('Awaiting next task assignment')).toBeInTheDocument();
  });

  it('renders campaign names for workers', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });

    render(<EinherjarPage />);
    // Campaign names should be displayed for workers with campaigns
    expect(screen.getAllByText('Storage Migration').length).toBeGreaterThan(0);
    expect(screen.getByText('Database Upgrade')).toBeInTheDocument();
  });

  it('handles empty workers list', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: [], loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: [],
      activeCampaigns: [],
      loading: false,
      error: null,
    });

    render(<EinherjarPage />);
    expect(screen.getByText('0 working · 0 idle')).toBeInTheDocument();
  });

  it('renders in grid layout', () => {
    vi.mocked(useEinherjar).mockReturnValue({ workers: mockWorkers, loading: false, error: null });
    vi.mocked(useCampaigns).mockReturnValue({
      campaigns: mockCampaigns,
      activeCampaigns: mockCampaigns,
      loading: false,
      error: null,
    });

    const { container } = render(<EinherjarPage />);
    const grid = container.querySelector('[class*="grid"]');
    expect(grid).toBeInTheDocument();
  });
});
