import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { OverviewPage } from './OverviewPage';
import {
  createMockRavenStream,
  createMockTriggerStore,
  createMockSessionStream,
  createMockBudgetStream,
} from '../adapters/mock';

function makeServices(overrides?: Record<string, unknown>) {
  return {
    'ravn.ravens': createMockRavenStream(),
    'ravn.triggers': createMockTriggerStore(),
    'ravn.sessions': createMockSessionStream(),
    'ravn.budget': createMockBudgetStream(),
    ...overrides,
  };
}

function wrap(services = makeServices()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

describe('OverviewPage', () => {
  it('shows loading state initially', () => {
    const slow = { listRavens: () => new Promise(() => undefined) };
    render(<OverviewPage />, { wrapper: wrap(makeServices({ 'ravn.ravens': slow })) });
    expect(screen.getByTestId('overview-loading')).toBeInTheDocument();
  });

  it('renders the KPI strip after loading', async () => {
    render(<OverviewPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('overview-page')).toBeInTheDocument());
    // KPI cards
    expect(screen.getByTestId('kpi-total')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-active')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-suspended')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-triggers')).toBeInTheDocument();
  });

  it('renders the active ravens list', async () => {
    render(<OverviewPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('active-ravens-list')).toBeInTheDocument());
    const rows = screen.getAllByTestId('active-ravn-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('renders the fleet sparkline widget', async () => {
    render(<OverviewPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('fleet-sparkline')).toBeInTheDocument());
  });

  it('renders the top spenders list', async () => {
    render(<OverviewPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('top-spenders-list')).toBeInTheDocument());
  });

  it('renders the log tail section', async () => {
    render(<OverviewPage />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByTestId('log-tail')).toBeInTheDocument());
  });

  it('shows error state when ravens service fails', async () => {
    const failing = { listRavens: () => Promise.reject(new Error('fleet offline')) };
    render(<OverviewPage />, {
      wrapper: wrap(makeServices({ 'ravn.ravens': failing })),
    });
    await waitFor(() => expect(screen.getByTestId('overview-error')).toBeInTheDocument());
    expect(screen.getByText(/fleet offline/i)).toBeInTheDocument();
  });

  it('shows "No active ravens" when all ravens are idle', async () => {
    const noActive = {
      listRavens: () =>
        Promise.resolve([
          {
            id: 'id-1',
            personaName: 'idle-ravn',
            status: 'idle' as const,
            model: 'claude-sonnet-4-6',
            createdAt: '2026-04-15T09:00:00Z',
          },
        ]),
      getRaven: () => Promise.resolve(null),
    };
    render(<OverviewPage />, {
      wrapper: wrap(makeServices({ 'ravn.ravens': noActive })),
    });
    await waitFor(() => expect(screen.getByText(/no active ravens/i)).toBeInTheDocument());
  });
});
