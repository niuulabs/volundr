import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { ToastProvider } from '@niuulabs/ui';
import { SagasPage } from './SagasPage';
import { createMockTyrService } from '../adapters/mock';
import type { Saga } from '../domain/saga';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
}));

function wrap(services: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ToastProvider>
        <QueryClientProvider client={client}>
          <ServicesProvider services={services}>{children}</ServicesProvider>
        </QueryClientProvider>
      </ToastProvider>
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
    repos: ['niuulabs/volundr'],
    featureBranch: 'feat/test',
    baseBranch: 'main',
    status: 'active',
    confidence: 80,
    createdAt: '2026-01-01T00:00:00Z',
    phaseSummary: { total: 2, completed: 0 },
    workflow: 'ship',
    workflowVersion: '1.4.2',
    ...overrides,
  };
}

describe('SagasPage', () => {
  it('renders the sagas heading', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('Sagas')).toBeInTheDocument());
  });

  it('shows grouped left-rail sections', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getByText('ACTIVE')).toBeInTheDocument());
    expect(screen.getByText('IN REVIEW')).toBeInTheDocument();
    expect(screen.getAllByText('COMPLETE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FAILED').length).toBeGreaterThan(0);
  });

  it('filters sagas from the page-head search', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getAllByText('Auth Rewrite').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole('searchbox', { name: /Filter sagas/i }), {
      target: { value: 'auth' },
    });
    await waitFor(() => expect(screen.getAllByText('Auth Rewrite').length).toBeGreaterThan(0));
    expect(screen.queryByText('Plugin Ravn Scaffold')).not.toBeInTheDocument();
  });

  it('shows empty state when search matches nothing', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getAllByText('Auth Rewrite').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole('searchbox', { name: /Filter sagas/i }), {
      target: { value: 'zzznomatch' },
    });
    await waitFor(() => expect(screen.getByText('No sagas found')).toBeInTheDocument());
  });

  it('clicking a saga row navigates to saga detail', async () => {
    mockNavigate.mockClear();
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getAllByText('Auth Rewrite').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { pressed: true }));
    expect(mockNavigate).toHaveBeenCalled();
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

  it('shows empty state when no sagas exist', async () => {
    const emptySvc = { getSagas: async (): Promise<Saga[]> => [] };
    render(<SagasPage />, { wrapper: wrap({ tyr: emptySvc }) });
    await waitFor(() => expect(screen.getByText('No sagas found')).toBeInTheDocument());
  });

  it('shows export toast', async () => {
    const mockCreateObjectURL = vi.fn(() => 'blob:mock');
    const mockRevokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });

    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getAllByText('Auth Rewrite').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Export sagas as JSON/i }));
    await waitFor(() => expect(screen.getByText(/Exported \d+ sagas/i)).toBeInTheDocument());
  });

  it('opens new saga modal', async () => {
    render(<SagasPage />, { wrapper: wrap({ tyr: createMockTyrService() }) });
    await waitFor(() => expect(screen.getAllByText('Auth Rewrite').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Create new saga/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('renders grouped bucket items from mixed data', async () => {
    const mixedSvc = {
      getSagas: async (): Promise<Saga[]> => [
        makeSaga({ id: '1', name: 'Active', phaseSummary: { total: 2, completed: 0 } }),
        makeSaga({ id: '2', name: 'Review', phaseSummary: { total: 4, completed: 2 } }),
        makeSaga({ id: '3', name: 'Done', status: 'complete', slug: 'done', phaseSummary: { total: 4, completed: 4 } }),
        makeSaga({ id: '4', name: 'Broken', status: 'failed', slug: 'broken' }),
      ],
    };
    render(<SagasPage />, { wrapper: wrap({ tyr: mixedSvc }) });
    await waitFor(() => expect(screen.getAllByText('Active').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Broken').length).toBeGreaterThan(0);
  });
});
