import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { DispatchView } from './DispatchView';
import { createMockTyrService } from '../adapters/mock';
import { createMockDispatcherService } from '../adapters/mock';
import { createMockDispatchBus } from '../adapters/mock';
import type { ITyrService, IDispatcherService, IDispatchBus } from '../ports';
import type { Saga, Phase, Raid } from '../domain/saga';
import type { DispatcherState } from '../domain/dispatcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDispatcherState(overrides: Partial<DispatcherState> = {}): DispatcherState {
  return {
    id: '00000000-0000-0000-0000-000000000999',
    running: true,
    threshold: 70,
    maxConcurrentRaids: 3,
    autoContinue: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSaga(overrides: Partial<Saga> = {}): Saga {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    trackerId: 'NIU-001',
    trackerType: 'linear',
    slug: 'test-saga',
    name: 'Test Saga',
    repos: ['niuulabs/volundr'],
    featureBranch: 'feat/test',
    status: 'active',
    confidence: 80,
    createdAt: '2026-01-01T00:00:00Z',
    phaseSummary: { total: 1, completed: 0 },
    ...overrides,
  };
}

function makeRaid(overrides: Partial<Raid> = {}): Raid {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    phaseId: '00000000-0000-0000-0000-000000000100',
    trackerId: 'NIU-010',
    name: 'Test Raid',
    description: 'A test raid',
    acceptanceCriteria: [],
    declaredFiles: [],
    estimateHours: 4,
    status: 'pending',
    confidence: 80,
    sessionId: null,
    reviewerSessionId: null,
    reviewRound: 0,
    branch: null,
    chronicleSummary: null,
    retryCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePhase(raids: Raid[], number = 1, status: Phase['status'] = 'active'): Phase {
  return {
    id: '00000000-0000-0000-0000-000000000100',
    sagaId: '00000000-0000-0000-0000-000000000001',
    trackerId: 'NIU-M1',
    number,
    name: `Phase ${number}`,
    status,
    confidence: 80,
    raids,
  };
}

function makeServices(
  overrides: {
    tyr?: Partial<ITyrService>;
    dispatcher?: Partial<IDispatcherService>;
    dispatch?: Partial<IDispatchBus>;
  } = {},
) {
  const saga = makeSaga();
  const raid = makeRaid();
  const phase = makePhase([raid]);

  const tyrBase = createMockTyrService();
  const dispatcherBase = createMockDispatcherService();
  const dispatchBase = createMockDispatchBus();

  const tyr: ITyrService = {
    ...tyrBase,
    getSagas: async () => [saga],
    getPhases: async () => [phase],
    ...overrides.tyr,
  };

  const dispatcher: IDispatcherService = {
    ...dispatcherBase,
    getState: async () => makeDispatcherState(),
    ...overrides.dispatcher,
  };

  const dispatch: IDispatchBus = {
    ...dispatchBase,
    ...overrides.dispatch,
  };

  return { tyr, 'tyr.dispatcher': dispatcher, 'tyr.dispatch': dispatch };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DispatchView', () => {
  it('shows loading state initially', () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    expect(screen.getByText(/loading dispatch queue/i)).toBeInTheDocument();
  });

  it('renders rule summary card after loading', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => expect(screen.getByText('Dispatch rules')).toBeInTheDocument());
    // "70%" may appear in both queue header and rules panel
    expect(screen.getAllByText('70%').length).toBeGreaterThanOrEqual(1);
    // Multiple "3"s can appear (concurrent cap + retries), use getAllByText
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('off')).toBeInTheDocument();
  });

  it('renders the dispatch queue list', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => expect(screen.getByText('Test Raid')).toBeInTheDocument());
    expect(screen.getByText(/Test Saga/)).toBeInTheDocument();
  });

  it('shows segmented filter controls', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => expect(screen.getByText('All')).toBeInTheDocument());
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Queue')).toBeInTheDocument();
  });

  it('shows error state when dispatcher service fails', async () => {
    const services = makeServices({
      dispatcher: {
        getState: async () => {
          throw new Error('dispatcher offline');
        },
      },
    });
    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByText(/failed to load dispatch queue/i)).toBeInTheDocument(),
    );
  });

  it('shows error state when tyr service fails', async () => {
    const services = makeServices({
      tyr: {
        getSagas: async () => {
          throw new Error('tyr offline');
        },
      },
    });
    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByText(/failed to load dispatch queue/i)).toBeInTheDocument(),
    );
  });

  it('filters to ready raids only', async () => {
    const user = userEvent.setup();
    const readyRaid = makeRaid({
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Ready Raid',
      confidence: 80,
    });
    const blockedRaid = makeRaid({
      id: '00000000-0000-0000-0000-000000000012',
      name: 'Low Conf Raid',
      confidence: 20,
    });
    const phase = makePhase([readyRaid, blockedRaid]);
    const services = makeServices({
      tyr: { getSagas: async () => [makeSaga()], getPhases: async () => [phase] },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('Ready Raid'));

    await user.click(screen.getByRole('button', { name: /ready/i }));
    expect(screen.getByText('Ready Raid')).toBeInTheDocument();
    expect(screen.queryByText('Low Conf Raid')).not.toBeInTheDocument();
  });

  it('filters to blocked raids only', async () => {
    const user = userEvent.setup();
    const readyRaid = makeRaid({
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Ready Raid',
      confidence: 80,
    });
    const blockedRaid = makeRaid({
      id: '00000000-0000-0000-0000-000000000012',
      name: 'Low Conf Raid',
      confidence: 20,
    });
    const phase = makePhase([readyRaid, blockedRaid]);
    const services = makeServices({
      tyr: { getSagas: async () => [makeSaga()], getPhases: async () => [phase] },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('Ready Raid'));

    await user.click(screen.getByRole('button', { name: /blocked/i }));
    expect(screen.queryByText('Ready Raid')).not.toBeInTheDocument();
    expect(screen.getByText('Low Conf Raid')).toBeInTheDocument();
  });

  it('filters to queue raids only', async () => {
    const user = userEvent.setup();
    const pendingRaid = makeRaid({
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Pending Raid',
      status: 'pending',
    });
    const runningRaid = makeRaid({
      id: '00000000-0000-0000-0000-000000000012',
      name: 'Running Raid',
      status: 'running',
      confidence: 80,
    });
    const phase = makePhase([pendingRaid, runningRaid]);
    const services = makeServices({
      tyr: { getSagas: async () => [makeSaga()], getPhases: async () => [phase] },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('Pending Raid'));

    await user.click(screen.getByRole('button', { name: /queue/i }));
    expect(screen.queryByText('Pending Raid')).not.toBeInTheDocument();
    expect(screen.getByText('Running Raid')).toBeInTheDocument();
  });

  it('filters by search query', async () => {
    const user = userEvent.setup();
    const raid1 = makeRaid({
      id: '00000000-0000-0000-0000-000000000011',
      name: 'OIDC integration',
    });
    const raid2 = makeRaid({ id: '00000000-0000-0000-0000-000000000012', name: 'PAT generation' });
    const phase = makePhase([raid1, raid2]);
    const services = makeServices({
      tyr: { getSagas: async () => [makeSaga()], getPhases: async () => [phase] },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('OIDC integration'));

    await user.type(screen.getByRole('searchbox'), 'oidc');
    expect(screen.getByText('OIDC integration')).toBeInTheDocument();
    expect(screen.queryByText('PAT generation')).not.toBeInTheDocument();
  });

  it('shows empty state when no raids match filter', async () => {
    const user = userEvent.setup();
    // Only pending raid; filter to "queue" should show empty
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('button', { name: /queue/i }));
    expect(screen.getByText(/no raids match/i)).toBeInTheDocument();
  });

  it('batch dispatch bar appears when raids are selected', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    const checkbox = screen.getByRole('checkbox', { name: /select row/i });
    await user.click(checkbox);
    expect(screen.getByText(/1 raid selected/i)).toBeInTheDocument();
  });

  it('dispatch button is disabled for non-feasible selections', async () => {
    const user = userEvent.setup();
    const lowConfRaid = makeRaid({ confidence: 20 });
    const phase = makePhase([lowConfRaid]);
    const services = makeServices({
      tyr: { getSagas: async () => [makeSaga()], getPhases: async () => [phase] },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('Test Raid'));

    const checkbox = screen.getByRole('checkbox', { name: /select row/i });
    await user.click(checkbox);
    const dispatchBtn = screen.getByRole('button', { name: /dispatch/i });
    expect(dispatchBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('calls dispatchBatch and clears selection on batch dispatch', async () => {
    const user = userEvent.setup();
    const dispatchSpy = vi
      .fn()
      .mockResolvedValue({ dispatched: ['00000000-0000-0000-0000-000000000010'], failed: [] });
    const services = makeServices({ dispatch: { dispatchBatch: dispatchSpy } });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    await user.click(screen.getByRole('button', { name: /dispatch/i }));
    await waitFor(() =>
      expect(dispatchSpy).toHaveBeenCalledWith(['00000000-0000-0000-0000-000000000010']),
    );
    // Selection cleared
    await waitFor(() => expect(screen.queryByText(/1 raid selected/i)).not.toBeInTheDocument());
  });

  it('optimistically clears selection after dispatch (optimistic update)', async () => {
    const user = userEvent.setup();
    const dispatchSpy = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                dispatched: ['00000000-0000-0000-0000-000000000010'],
                failed: [],
              }),
            50,
          ),
        ),
    );
    const services = makeServices({ dispatch: { dispatchBatch: dispatchSpy } });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    expect(screen.getByText(/1 raid selected/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dispatch/i }));

    // Optimistic update: selection cleared immediately, raid still visible as "queued"
    await waitFor(() => expect(screen.queryByText(/1 raid selected/i)).not.toBeInTheDocument());
    // Raid still visible in "all" tab with queued status (optimistic)
    expect(screen.getByText('Test Raid')).toBeInTheDocument();
  });

  it('shows confidence level for raids', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => expect(screen.getByText('80%')).toBeInTheDocument());
  });
});
