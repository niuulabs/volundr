import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SagasPage } from './SagasPage';
import { createMockTyrService } from '../adapters/mock';
import type { Saga } from '../domain/saga';

// ---------------------------------------------------------------------------
// Router mock
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

function makeSaga(overrides: Partial<Saga> = {}): Saga {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    trackerId: 'NIU-1',
    trackerType: 'linear',
    slug: 'test-saga',
    name: 'Test Saga',
    repos: [],
    featureBranch: 'feat/test',
    status: 'active',
    confidence: 80,
    createdAt: '2026-01-01T00:00:00Z',
    phaseSummary: { total: 2, completed: 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SagasPage', () => {
  it('renders the sagas heading', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText(/Tyr · Sagas/)).toBeInTheDocument());
  });

  it('renders the Tyr rune', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('ᛏ', { hidden: true })).toBeInTheDocument());
  });

  it('shows loading state initially', () => {
    const slowSvc = { getSagas: () => new Promise(() => undefined) };
    render(<SagasPage />, { wrapper: wrap({ tyr: slowSvc }) });
    expect(screen.getByText(/Loading sagas/i)).toBeInTheDocument();
  });

  it('shows error state when service throws', async () => {
    const failingSvc = {
      getSagas: async () => {
        throw new Error('fetch error');
      },
    };
    render(<SagasPage />, { wrapper: wrap({ tyr: failingSvc }) });
    await waitFor(() => expect(screen.getByText('fetch error')).toBeInTheDocument());
  });

  it('renders all sagas from mock service', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    expect(screen.getByText('Plugin Ravn Scaffold')).toBeInTheDocument();
    expect(screen.getByText('Observatory Topology Canvas')).toBeInTheDocument();
  });

  it('renders status tabs: All, Active, Complete, Failed', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /complete/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /failed/i })).toBeInTheDocument();
  });

  it('filters to only active sagas when "Active" tab is clicked', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /active/i }));
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    expect(screen.queryByText('Plugin Ravn Scaffold')).not.toBeInTheDocument();
    expect(screen.queryByText('Observatory Topology Canvas')).not.toBeInTheDocument();
  });

  it('filters to only complete sagas when "Complete" tab is clicked', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Plugin Ravn Scaffold')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /complete/i }));
    await waitFor(() => expect(screen.getByText('Plugin Ravn Scaffold')).toBeInTheDocument());
    expect(screen.queryByText('Auth Rewrite')).not.toBeInTheDocument();
  });

  it('filters to only failed sagas when "Failed" tab is clicked', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() =>
      expect(screen.getByText('Observatory Topology Canvas')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('tab', { name: /failed/i }));
    await waitFor(() =>
      expect(screen.getByText('Observatory Topology Canvas')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Auth Rewrite')).not.toBeInTheDocument();
  });

  it('filters sagas by search term', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    const searchInput = screen.getByRole('searchbox', { name: /Search sagas/i });
    fireEvent.change(searchInput, { target: { value: 'auth' } });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    expect(screen.queryByText('Plugin Ravn Scaffold')).not.toBeInTheDocument();
  });

  it('shows empty state when search matches nothing', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    const searchInput = screen.getByRole('searchbox', { name: /Search sagas/i });
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } });
    await waitFor(() => expect(screen.getByText('No sagas found')).toBeInTheDocument());
  });

  it('shows empty state when no sagas exist', async () => {
    const emptySvc = { getSagas: async (): Promise<Saga[]> => [] };
    render(<SagasPage />, { wrapper: wrap({ tyr: emptySvc }) });
    await waitFor(() => expect(screen.getByText('No sagas found')).toBeInTheDocument());
  });

  it('clicking a saga navigates to saga detail', async () => {
    mockNavigate.mockClear();
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /View saga Auth Rewrite/i }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/tyr/sagas/$sagaId',
      params: { sagaId: '00000000-0000-0000-0000-000000000001' },
    });
  });

  it('saga status grouping: groups by status correctly', async () => {
    const mixedSvc = {
      getSagas: async (): Promise<Saga[]> => [
        makeSaga({ id: '1', name: 'Active 1', status: 'active' }),
        makeSaga({ id: '2', name: 'Active 2', status: 'active' }),
        makeSaga({ id: '3', name: 'Done', status: 'complete', slug: 'done' }),
      ],
    };
    render(<SagasPage />, { wrapper: wrap({ tyr: mixedSvc }) });
    await waitFor(() => expect(screen.getByText('Active 1')).toBeInTheDocument());

    // Switch to active tab → 2 sagas
    fireEvent.click(screen.getByRole('tab', { name: /active/i }));
    await waitFor(() => expect(screen.getByText('Active 1')).toBeInTheDocument());
    expect(screen.getByText('Active 2')).toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();

    // Switch to complete tab → 1 saga
    fireEvent.click(screen.getByRole('tab', { name: /complete/i }));
    await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument());
    expect(screen.queryByText('Active 1')).not.toBeInTheDocument();
  });

  it('renders Pipe component showing phase progress for each saga', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    // Pipe renders with role="list" aria-label="phase progress"
    const pipes = screen.getAllByRole('list', { name: /phase progress/i });
    expect(pipes.length).toBeGreaterThan(0);
  });
});
