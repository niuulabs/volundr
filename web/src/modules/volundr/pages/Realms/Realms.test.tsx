import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RealmsPage } from './index';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/modules/volundr/hooks/useRealms', () => ({
  useRealms: vi.fn(),
}));

import { useRealms } from '@/modules/volundr/hooks/useRealms';

const mockRealms = [
  {
    id: 'valhalla',
    name: 'Valhalla',
    description: 'AI/ML GPU cluster',
    location: 'ca-hamilton-1',
    status: 'healthy',
    health: {
      status: 'healthy',
      inputs: {
        nodesReady: 3,
        nodesTotal: 3,
        podRunningRatio: 1.0,
        volumesDegraded: 0,
        volumesFaulted: 0,
        recentErrorCount: 0,
      },
      reason: '',
    },
    resources: {
      cpu: { capacity: 48, allocatable: 44, unit: 'cores' },
      memory: { capacity: 384, allocatable: 360, unit: 'GiB' },
      gpuCount: 6,
      pods: { running: 14, pending: 1, failed: 0, succeeded: 3, unknown: 0 },
    },
    valkyrie: {
      name: 'Sigrdrifa',
      status: 'observing',
      uptime: '14d 07:23:41',
      observationsToday: 412,
      specialty: 'AI/ML workloads',
    },
  },
  {
    id: 'glitnir',
    name: 'Glitnir',
    description: 'Observability & monitoring',
    location: 'ca-hamilton-2',
    status: 'warning',
    health: {
      status: 'warning',
      inputs: {
        nodesReady: 2,
        nodesTotal: 2,
        podRunningRatio: 0.92,
        volumesDegraded: 1,
        volumesFaulted: 0,
        recentErrorCount: 3,
      },
      reason: '1 volume degraded',
    },
    resources: {
      cpu: { capacity: 16, allocatable: 14, unit: 'cores' },
      memory: { capacity: 64, allocatable: 58, unit: 'GiB' },
      gpuCount: 0,
      pods: { running: 18, pending: 0, failed: 1, succeeded: 5, unknown: 0 },
    },
    valkyrie: {
      name: 'Mist',
      status: 'observing',
      uptime: '10d 01:15:00',
      observationsToday: 289,
      specialty: 'Observability & metrics',
    },
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <RealmsPage />
    </MemoryRouter>
  );
}

describe('RealmsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when loading', () => {
    vi.mocked(useRealms).mockReturnValue({
      realms: [],
      loading: true,
      error: null,
      getRealm: vi.fn(),
      refresh: vi.fn(),
    });

    renderPage();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useRealms).mockReturnValue({
      realms: mockRealms,
      loading: false,
      error: null,
      getRealm: vi.fn(),
      refresh: vi.fn(),
    });

    renderPage();
    expect(screen.getByText('Realms')).toBeInTheDocument();
    expect(screen.getByText("Infrastructure domains under ODIN's watch")).toBeInTheDocument();
  });

  it('renders realm status counts', () => {
    vi.mocked(useRealms).mockReturnValue({
      realms: mockRealms,
      loading: false,
      error: null,
      getRealm: vi.fn(),
      refresh: vi.fn(),
    });

    renderPage();
    expect(screen.getByText('1 healthy · 1 warning')).toBeInTheDocument();
  });

  it('renders all realm cards', () => {
    vi.mocked(useRealms).mockReturnValue({
      realms: mockRealms,
      loading: false,
      error: null,
      getRealm: vi.fn(),
      refresh: vi.fn(),
    });

    renderPage();
    expect(screen.getByText('Valhalla')).toBeInTheDocument();
    expect(screen.getByText('Glitnir')).toBeInTheDocument();
  });

  it('renders realm cards in detailed variant', () => {
    vi.mocked(useRealms).mockReturnValue({
      realms: mockRealms,
      loading: false,
      error: null,
      getRealm: vi.fn(),
      refresh: vi.fn(),
    });

    const { container } = renderPage();
    const detailedCards = container.querySelectorAll('[class*="detailed"]');
    expect(detailedCards.length).toBeGreaterThan(0);
  });

  it('navigates to realm detail when card clicked', () => {
    vi.mocked(useRealms).mockReturnValue({
      realms: mockRealms,
      loading: false,
      error: null,
      getRealm: vi.fn(),
      refresh: vi.fn(),
    });

    renderPage();

    const valhallaCard = screen.getByText('Valhalla').closest('div[class*="card"]');
    fireEvent.click(valhallaCard!);

    expect(mockNavigate).toHaveBeenCalledWith('/realms/valhalla');
  });
});
