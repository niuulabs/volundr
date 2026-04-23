import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { DispatchView } from './DispatchView';
import { createMockTyrService } from '../adapters/mock';
import { createMockDispatcherService } from '../adapters/mock';
import { createMockDispatchBus } from '../adapters/mock';
import { createMockWorkflowService } from '../adapters/mock';
import type { ITyrService, IDispatcherService, IDispatchBus, IWorkflowService } from '../ports';
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
    workflows?: Partial<IWorkflowService>;
  } = {},
) {
  const saga = makeSaga();
  const raid = makeRaid();
  const phase = makePhase([raid]);

  const tyrBase = createMockTyrService();
  const dispatcherBase = createMockDispatcherService();
  const dispatchBase = createMockDispatchBus();
  const workflowsBase = createMockWorkflowService();

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

  const workflows: IWorkflowService = {
    ...workflowsBase,
    ...overrides.workflows,
  };

  return {
    tyr,
    'tyr.dispatcher': dispatcher,
    'tyr.dispatch': dispatch,
    'tyr.workflows': workflows,
  };
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
    expect(screen.getByText('selected')).toBeInTheDocument();
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
    const dispatchBtn = screen.getByRole('button', { name: /dispatch now/i });
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
    await user.click(screen.getByRole('button', { name: /dispatch now/i }));
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
    expect(screen.getByText('selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dispatch now/i }));

    // Optimistic update: selection cleared immediately, raid still visible as "queued"
    await waitFor(() => expect(screen.queryByText(/1 raid selected/i)).not.toBeInTheDocument());
    // Raid still visible in "all" tab with queued status (optimistic)
    expect(screen.getByText('Test Raid')).toBeInTheDocument();
  });

  it('shows confidence level for raids', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => expect(screen.getByText('80')).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Pause / Resume dispatcher
  // ---------------------------------------------------------------------------

  it('shows Pause dispatcher button in header', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pause dispatcher/i })).toBeInTheDocument(),
    );
  });

  it('shows Resume dispatcher button when dispatcher is stopped', async () => {
    const services = makeServices({
      dispatcher: { getState: async () => makeDispatcherState({ running: false }) },
    });
    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /resume dispatcher/i })).toBeInTheDocument(),
    );
  });

  it('calls setRunning(false) when Pause is clicked', async () => {
    const user = userEvent.setup();
    const setRunningSpy = vi.fn().mockResolvedValue(undefined);
    const getStateSpy = vi
      .fn()
      .mockResolvedValueOnce(makeDispatcherState({ running: true }))
      .mockResolvedValue(makeDispatcherState({ running: false }));
    const services = makeServices({
      dispatcher: { getState: getStateSpy, setRunning: setRunningSpy },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByRole('button', { name: /pause dispatcher/i }));

    await user.click(screen.getByRole('button', { name: /pause dispatcher/i }));
    await waitFor(() => expect(setRunningSpy).toHaveBeenCalledWith(false));
  });

  it('calls setRunning(true) when Resume is clicked', async () => {
    const user = userEvent.setup();
    const setRunningSpy = vi.fn().mockResolvedValue(undefined);
    const getStateSpy = vi
      .fn()
      .mockResolvedValueOnce(makeDispatcherState({ running: false }))
      .mockResolvedValue(makeDispatcherState({ running: true }));
    const services = makeServices({
      dispatcher: { getState: getStateSpy, setRunning: setRunningSpy },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByRole('button', { name: /resume dispatcher/i }));

    await user.click(screen.getByRole('button', { name: /resume dispatcher/i }));
    await waitFor(() => expect(setRunningSpy).toHaveBeenCalledWith(true));
  });

  // ---------------------------------------------------------------------------
  // Dispatch rules panel
  // ---------------------------------------------------------------------------

  it('shows Edit button in dispatch rules panel', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Dispatch rules'));
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('shows recent dispatches in the panel', async () => {
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Recent dispatches'));
    expect(screen.getByText('NIU-214.2')).toBeInTheDocument();
    expect(screen.getByText('NIU-199.1')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Override threshold modal
  // ---------------------------------------------------------------------------

  it('shows Override threshold button when raids are selected', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    expect(screen.getByRole('button', { name: /override threshold/i })).toBeInTheDocument();
  });

  it('opens threshold modal when Override threshold is clicked', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    await user.click(screen.getByRole('button', { name: /override threshold/i }));
    await waitFor(() =>
      expect(screen.getByText('Override dispatch threshold')).toBeInTheDocument(),
    );
  });

  // ---------------------------------------------------------------------------
  // Edit rules modal
  // ---------------------------------------------------------------------------

  it('opens edit rules modal when Edit button is clicked', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByRole('button', { name: /edit/i }));

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => expect(screen.getByText('Edit dispatch rules')).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Apply workflow modal
  // ---------------------------------------------------------------------------

  it('shows Apply workflow button when raids are selected', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    expect(screen.getByRole('button', { name: /apply workflow/i })).toBeInTheDocument();
  });

  it('opens workflow modal when Apply workflow is clicked', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    await user.click(screen.getByRole('button', { name: /apply workflow/i }));
    await waitFor(() => expect(screen.getByText('Apply workflow override')).toBeInTheDocument());
  });

  it('shows toast and closes modal when a workflow is applied', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    await user.click(screen.getByRole('button', { name: /apply workflow/i }));
    await waitFor(() => screen.getByText('Apply workflow override'));

    // Click the first workflow in the list
    await user.click(screen.getByRole('button', { name: /Auth Rewrite Workflow/i }));
    await waitFor(() =>
      expect(screen.queryByText('Apply workflow override')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText(/Applied "Auth Rewrite Workflow" to 1 raid/i)).toBeInTheDocument(),
    );
  });

  it('shows workflow override chip on raid row after applying', async () => {
    const user = userEvent.setup();
    render(<DispatchView />, { wrapper: wrap(makeServices()) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    await user.click(screen.getByRole('button', { name: /apply workflow/i }));
    await waitFor(() => screen.getByText('Apply workflow override'));
    await user.click(screen.getByRole('button', { name: /Auth Rewrite Workflow/i }));

    await waitFor(() =>
      expect(
        screen.getByRole('generic', { name: /workflow override: Auth Rewrite Workflow/i }),
      ).toBeInTheDocument(),
    );
  });

  // ---------------------------------------------------------------------------
  // Error toasts
  // ---------------------------------------------------------------------------

  it('shows error toast when dispatch fails', async () => {
    const user = userEvent.setup();
    const services = makeServices({
      dispatch: {
        dispatchBatch: vi.fn().mockRejectedValue(new Error('network error')),
      },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByText('Test Raid'));

    await user.click(screen.getByRole('checkbox', { name: /select row/i }));
    await user.click(screen.getByRole('button', { name: /dispatch now/i }));
    await waitFor(() => expect(screen.getByText(/dispatch failed/i)).toBeInTheDocument());
  });

  it('shows error toast when pause fails', async () => {
    const user = userEvent.setup();
    const services = makeServices({
      dispatcher: {
        getState: vi.fn().mockResolvedValue(makeDispatcherState({ running: true })),
        setRunning: vi.fn().mockRejectedValue(new Error('service error')),
      },
    });

    render(<DispatchView />, { wrapper: wrap(services) });
    await waitFor(() => screen.getByRole('button', { name: /pause dispatcher/i }));

    await user.click(screen.getByRole('button', { name: /pause dispatcher/i }));
    await waitFor(() =>
      expect(screen.getByText(/failed to update dispatcher/i)).toBeInTheDocument(),
    );
  });
});
