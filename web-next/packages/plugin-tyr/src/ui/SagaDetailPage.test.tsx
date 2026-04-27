import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SagaDetailPage, SagaDetailRoute } from './SagaDetailPage';
import { createMockTyrService } from '../adapters/mock';
import type { Saga, Phase, Raid } from '../domain/saga';

const mockNavigate = vi.fn();
const mockUseParams = vi.fn().mockReturnValue({ sagaId: '00000000-0000-0000-0000-000000000001' });

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
}));

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
    baseBranch: 'main',
    status: 'active',
    confidence: 82,
    createdAt: '2026-01-10T09:00:00Z',
    phaseSummary: { total: 3, completed: 1 },
    workflow: 'ship',
    workflowVersion: '1.4.2',
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
    name: 'Plan',
    status: 'complete',
    confidence: 90,
    raids,
  };
}

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

  it('renders the compact saga header', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() => expect(screen.getByText('NIU-500 · Auth Rewrite')).toBeInTheDocument());
    expect(screen.getByText('feat/auth-rewrite → main')).toBeInTheDocument();
  });

  it('renders phase cards and raid rows', async () => {
    const svc = {
      getSaga: async () => makeSaga(),
      getPhases: async () => [makePhase([makeRaid()])],
    };
    render(<SagaDetailPage sagaId={SAGA_ID} />, { wrapper: wrap({ tyr: svc }) });
    await waitFor(() => expect(screen.getByText('Phase 1 · Plan')).toBeInTheDocument());
    expect(screen.getByText('NIU-501')).toBeInTheDocument();
    expect(screen.getByText('Implement OIDC flow')).toBeInTheDocument();
  });

  it('renders workflow, stage progress, and confidence cards', async () => {
    render(<SagaDetailPage sagaId={SAGA_ID} />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() => expect(screen.getByRole('region', { name: /workflow/i })).toBeInTheDocument());
    expect(screen.getByRole('region', { name: /stage progress/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /confidence drift/i })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('NIU-500 · Auth Rewrite')).toBeInTheDocument());
    screen.getByRole('button', { name: /Sagas/i }).click();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/tyr/sagas' });
  });
});

describe('SagaDetailRoute', () => {
  it('renders SagaDetailPage with sagaId from URL params', async () => {
    render(<SagaDetailRoute />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('NIU-500 · Auth Rewrite')).toBeInTheDocument());
  });
});
