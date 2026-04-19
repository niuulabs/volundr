import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { DashboardPage } from './DashboardPage';
import { createMockTyrService, createMockDispatcherService } from '../adapters/mock';
import type { Saga } from '../domain/saga';
import type { DispatcherState } from '../domain/dispatcher';

// ---------------------------------------------------------------------------
// Router mock — DashboardPage calls useNavigate() for saga click navigation
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(services: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

const defaultServices = () => ({
  tyr: createMockTyrService(),
  'tyr.dispatcher': createMockDispatcherService(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardPage', () => {
  it('renders the dashboard heading', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() => expect(screen.getByText(/Tyr · Dashboard/)).toBeInTheDocument());
  });

  it('renders the Tyr rune', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() => expect(screen.getByText('ᛏ', { hidden: true })).toBeInTheDocument());
  });

  it('shows loading state initially', () => {
    const slowSvc = {
      tyr: { getSagas: () => new Promise(() => undefined), getPhases: () => Promise.resolve([]) },
      'tyr.dispatcher': { getState: () => new Promise(() => undefined) },
    };
    render(<DashboardPage />, { wrapper: wrap(slowSvc) });
    expect(screen.getByText(/Loading dashboard/i)).toBeInTheDocument();
  });

  it('shows error state when service throws', async () => {
    const failingSvc = {
      tyr: {
        getSagas: async () => {
          throw new Error('network error');
        },
        getPhases: () => Promise.resolve([]),
      },
      'tyr.dispatcher': createMockDispatcherService(),
    };
    render(<DashboardPage />, { wrapper: wrap(failingSvc) });
    await waitFor(() => expect(screen.getByText('network error')).toBeInTheDocument());
  });

  it('renders KPI strip with correct labels', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    const kpiGroup = await screen.findByRole('group', { name: /KPI/i });
    expect(within(kpiGroup).getByText('Active Sagas')).toBeInTheDocument();
    expect(within(kpiGroup).getByText('Running Raids')).toBeInTheDocument();
    expect(within(kpiGroup).getByText('Blocked Raids')).toBeInTheDocument();
    expect(within(kpiGroup).getByText('Confidence Avg')).toBeInTheDocument();
    expect(within(kpiGroup).getByText('Dispatcher')).toBeInTheDocument();
  });

  it('shows 1 active saga from seed data', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
  });

  it('shows 1 completed saga from seed data', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() => expect(screen.getByText('Plugin Ravn Scaffold')).toBeInTheDocument());
  });

  it('renders active sagas section', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /Active sagas/i })).toBeInTheDocument(),
    );
  });

  it('renders recent completions section', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /Recent completions/i })).toBeInTheDocument(),
    );
  });

  it('renders dispatcher summary when dispatcher data is available', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /Dispatcher summary/i })).toBeInTheDocument(),
    );
    expect(screen.getByText('Threshold')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('shows empty state when no active sagas', async () => {
    const completeSvc = {
      tyr: {
        getSagas: async (): Promise<Saga[]> => [
          {
            id: '1',
            trackerId: 'NIU-1',
            trackerType: 'linear',
            slug: 'done-saga',
            name: 'Done Saga',
            repos: [],
            featureBranch: 'feat/done',
            status: 'complete',
            confidence: 95,
            createdAt: '2026-01-01T00:00:00Z',
            phaseSummary: { total: 1, completed: 1 },
          },
        ],
        getPhases: async () => [],
      },
      'tyr.dispatcher': createMockDispatcherService(),
    };
    render(<DashboardPage />, { wrapper: wrap(completeSvc) });
    await waitFor(() => expect(screen.getByText('No active sagas')).toBeInTheDocument());
  });

  it('clicking an active saga calls navigate with the saga ID', async () => {
    mockNavigate.mockClear();
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /View saga Auth Rewrite/i }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/tyr/sagas/$sagaId',
      params: { sagaId: '00000000-0000-0000-0000-000000000001' },
    });
  });

  it('shows dispatcher stopped state when dispatcher is not running', async () => {
    const stoppedDispatcher = {
      getState: async (): Promise<DispatcherState> => ({
        id: '00000000-0000-0000-0000-000000000999',
        running: false,
        threshold: 70,
        maxConcurrentRaids: 3,
        autoContinue: false,
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    };
    render(<DashboardPage />, {
      wrapper: wrap({ tyr: createMockTyrService(), 'tyr.dispatcher': stoppedDispatcher }),
    });
    await waitFor(() => expect(screen.getByText('Stopped')).toBeInTheDocument());
  });

  it('KPI strip shows active count value = 1 for seed data', async () => {
    render(<DashboardPage />, { wrapper: wrap(defaultServices()) });
    const kpiGroup = await screen.findByRole('group', { name: /KPI/i });
    expect(kpiGroup).toBeInTheDocument();
    expect(within(kpiGroup).getByText('Active Sagas')).toBeInTheDocument();
  });
});
