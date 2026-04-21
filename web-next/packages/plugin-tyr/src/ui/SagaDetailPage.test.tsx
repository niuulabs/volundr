import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SagaDetailPage, SagaDetailRoute } from './SagaDetailPage';
import { createMockTyrService } from '../adapters/mock';
import type { Saga, Phase, Raid } from '../domain/saga';

// ---------------------------------------------------------------------------
// Router mocks
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn();
const mockUseParams = vi.fn().mockReturnValue({ sagaId: '00000000-0000-0000-0000-000000000001' });

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
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

const SAGA_ID = '00000000-0000-0000-0000-000000000001';

function makeSaga(overrides: Partial<Saga> = {}): Saga {
  return {
    id: SAGA_ID,
    trackerId: 'NIU-500',
    trackerType: 'linear',
    slug: 'auth-rewrite',
    name: 'Auth Rewrite',
    repos: ['niuulabs/volundr'],
    featureBranch: 'feat/auth-rewrite',
    status: 'active',
    confidence: 82,
    createdAt: '2026-01-10T09:00:00Z',
    phaseSummary: { total: 3, completed: 1 },
    ...overrides,
  };
}

function makeRaid(overrides: Partial<Raid> = {}): Raid {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    phaseId: '00000000-0000-0000-0000-000000000100',
    trackerId: 'NIU-501',
    name: 'Implement OIDC flow',
    description: 'Add OIDC login.',
    acceptanceCriteria: ['Users can log in'],
    declaredFiles: ['src/auth/oidc.ts'],
    estimateHours: 8,
    status: 'merged',
    confidence: 90,
    sessionId: 'sess-001',
    reviewerSessionId: null,
    reviewRound: 1,
    branch: 'feat/auth-rewrite',
    chronicleSummary: 'OIDC flow implemented.',
    retryCount: 0,
    createdAt: '2026-01-10T09:00:00Z',
    updatedAt: '2026-01-12T14:00:00Z',
    ...overrides,
  };
}

function makePhase(raids: Raid[] = []): Phase {
  return {
    id: '00000000-0000-0000-0000-000000000100',
    sagaId: SAGA_ID,
    trackerId: 'NIU-M1',
    number: 1,
    name: 'Phase 1: Foundation',
    status: 'complete',
    confidence: 90,
    raids,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SagaDetailPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('shows loading state initially', () => {
    const slowSvc = {
      getSaga: () => new Promise(() => undefined),
      getPhases: () => new Promise(() => undefined),
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: slowSvc }) });
    expect(screen.getByText(/Loading saga/i)).toBeInTheDocument();
  });

  it('renders saga name and status', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    // Saga header + active phase both render "active" status badges
    expect(screen.getAllByRole('status', { name: 'active' }).length).toBeGreaterThan(0);
  });

  it('renders the phase pipeline', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() =>
      expect(screen.getByRole('list', { name: /phase progress/i })).toBeInTheDocument(),
    );
  });

  it('renders phase names and raids', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    // Phase name appears in the phase heading AND in the StageProgressRail labels
    await waitFor(() =>
      expect(screen.getAllByText('Phase 1: Foundation').length).toBeGreaterThan(0),
    );
    expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument();
  });

  it('shows PersonaAvatar for raid with sessionId', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid({ sessionId: 'sess-001' })])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    // Phase name appears in the phase heading AND in the StageProgressRail labels
    await waitFor(() =>
      expect(screen.getAllByText('Phase 1: Foundation').length).toBeGreaterThan(0),
    );
    // PersonaAvatar for the build role uses aria-label="build persona" (default when no title)
    expect(screen.getAllByLabelText(/build persona/i).length).toBeGreaterThan(0);
  });

  it('clicking a raid row expands the raid panel', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid()])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Expand raid Implement OIDC flow/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: /Raid detail: Implement OIDC flow/i }),
      ).toBeInTheDocument(),
    );
  });

  it('expanded raid panel shows raid description', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid()])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Expand raid Implement OIDC flow/i }));
    await waitFor(() => expect(screen.getByText('Add OIDC login.')).toBeInTheDocument());
  });

  it('expanded raid panel shows artefacts (declared files)', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid()])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Expand raid Implement OIDC flow/i }));
    await waitFor(() => expect(screen.getByText('src/auth/oidc.ts')).toBeInTheDocument());
  });

  it('expanded raid panel shows chronicle events', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid()])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Expand raid Implement OIDC flow/i }));
    await waitFor(() => expect(screen.getByText('OIDC flow implemented.')).toBeInTheDocument());
  });

  it('clicking "Open session" navigates to Völundr session page', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid({ sessionId: 'sess-001' })])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Expand raid Implement OIDC flow/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Open Völundr session/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Open Völundr session/i }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/volundr/session/$sessionId',
      params: { sessionId: 'sess-001' },
    });
  });

  it('cross-plugin link: "Open session" navigates to correct Völundr URL', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid({ sessionId: 'sess-special-123' })])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Expand raid Implement OIDC flow/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Open Völundr session/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Open Völundr session/i }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/volundr/session/$sessionId',
      params: { sessionId: 'sess-special-123' },
    });
  });

  it('raid panel can be closed', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid()])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Expand raid Implement OIDC flow/i }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /Raid detail/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close raid panel' }));
    expect(screen.queryByRole('region', { name: /Raid detail/i })).not.toBeInTheDocument();
  });

  it('shows empty state when saga has no phases', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async (): Promise<Phase[]> => [],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('No phases yet')).toBeInTheDocument());
  });

  it('shows error when saga not found', async () => {
    const svc = {
      getSaga: async (): Promise<Saga | null> => null,
      getPhases: async (): Promise<Phase[]> => [],
    };
    render(<SagaDetailPage sagaId="nonexistent-id" />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() =>
      expect(screen.getByText(/Saga "nonexistent-id" not found/)).toBeInTheDocument(),
    );
  });

  it('back button navigates to /tyr/sagas', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Back to sagas/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/tyr/sagas' });
  });
});

describe('SagaDetailRoute', () => {
  it('renders SagaDetailPage with sagaId from URL params', async () => {
    render(<SagaDetailRoute />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Auth Rewrite')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Right-column cards (added in NIU-709)
// ---------------------------------------------------------------------------

describe('SagaDetailPage — right-column cards', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders the WorkflowCard section', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /workflow/i })).toBeInTheDocument(),
    );
  });

  it('renders the workflow name from saga data', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() =>
      expect(screen.getByText(/ship — default release cycle/i)).toBeInTheDocument(),
    );
  });

  it('renders the workflow version from saga data', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() => expect(screen.getByText('v1.4.2')).toBeInTheDocument());
  });

  it('renders the StageProgressRail section', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /stage progress/i })).toBeInTheDocument(),
    );
  });

  it('renders the stage count in StageProgressRail', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    // mock service returns 3 phases for saga 001: Phase 1 (complete), Phase 2 (complete), Phase 3 (pending)
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeInTheDocument());
  });

  it('renders the ConfidenceDriftCard section', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /confidence drift/i })).toBeInTheDocument(),
    );
  });

  it('renders the current confidence in ConfidenceDriftCard', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    // saga 001 has confidence 82 → 0.82
    await waitFor(() => expect(screen.getByText('0.82')).toBeInTheDocument());
  });

  it('renders right-column cards with default workflow when saga has no workflow data', async () => {
    const svc = {
      getSaga: async () => makeSaga({ workflow: undefined, workflowVersion: undefined }),
      getPhases: async () => [],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() =>
      expect(screen.getByText(/ship — default release cycle/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });
});
