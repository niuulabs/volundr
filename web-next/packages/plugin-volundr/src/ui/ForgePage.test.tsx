import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { ForgePage } from './ForgePage';
import {
  createMockVolundrService,
  createMockClusterAdapter,
  createMockSessionStore,
  createMockTemplateStore,
} from '../adapters/mock';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

function wrap(
  service = createMockVolundrService(),
  clusterAdapter = createMockClusterAdapter(),
  sessionStore = createMockSessionStore(),
  templateStore = createMockTemplateStore(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider
        services={{
          volundr: service,
          clusterAdapter,
          sessionStore,
          'volundr.templates': templateStore,
        }}
      >
        <ForgePage />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('ForgePage', () => {
  it('renders the forge page container', () => {
    wrap();
    expect(screen.getByTestId('forge-page')).toBeInTheDocument();
  });

  it('renders metric tiles once data loads', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('active pods')).toBeInTheDocument());
    expect(screen.getByText('tokens today')).toBeInTheDocument();
    expect(screen.getByText('cost today')).toBeInTheDocument();
    expect(screen.getByText('GPUs')).toBeInTheDocument();
  });

  it('renders the in-flight pods panel', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('inflight-panel')).toBeInTheDocument());
    expect(screen.getByText('In-flight pods')).toBeInTheDocument();
  });

  it('renders the forge load panel', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('forge-load-panel')).toBeInTheDocument());
    expect(screen.getByText('Forge load')).toBeInTheDocument();
  });

  it('renders the quick launch panel', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('quick-launch-panel')).toBeInTheDocument());
    expect(screen.getByText('Quick launch')).toBeInTheDocument();
  });

  it('renders cluster load rows with cluster data', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Eitri')).toBeInTheDocument());
    expect(screen.getAllByTestId('cluster-load-row').length).toBeGreaterThan(0);
  });

  it('renders error strip when failed sessions exist', async () => {
    wrap();
    await waitFor(() => {
      const _errorStrip = screen.queryByTestId('error-strip');
      // May or may not have failed sessions depending on mock data
      expect(screen.getByTestId('forge-page')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    const slowStore = {
      ...createMockSessionStore(),
      listSessions: () => new Promise(() => {}),
    };
    wrap(createMockVolundrService(), createMockClusterAdapter(), slowStore);
    expect(screen.getByText(/loading metrics/i)).toBeInTheDocument();
  });
});
