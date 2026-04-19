import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { VolundrPage } from './VolundrPage';
import { createMockVolundrService } from '../adapters/mock';

function wrap(ui: React.ReactNode, service = createMockVolundrService()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ volundr: service }}>{ui}</ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('VolundrPage', () => {
  it('renders the title', () => {
    wrap(<VolundrPage />);
    expect(screen.getByText('Völundr · session forge')).toBeInTheDocument();
  });

  it('shows loading state before data resolves', () => {
    const slowService = {
      ...createMockVolundrService(),
      getSessions: () => new Promise(() => {}),
      getStats: () => new Promise(() => {}),
    };
    wrap(<VolundrPage />, slowService);
    expect(screen.getByText(/loading sessions/)).toBeInTheDocument();
  });

  it('renders seeded sessions once data loads', async () => {
    wrap(<VolundrPage />);
    await waitFor(() => expect(screen.getByText('feat/refactor-auth')).toBeInTheDocument());
  });

  it('renders the stats KPI strip', async () => {
    wrap(<VolundrPage />);
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument());
    expect(screen.getByText('total')).toBeInTheDocument();
    expect(screen.getByText('tokens today')).toBeInTheDocument();
  });

  it('renders session status chips', async () => {
    wrap(<VolundrPage />);
    await waitFor(() => expect(screen.getByText('running')).toBeInTheDocument());
  });

  it('shows empty state message when no sessions exist', async () => {
    const emptyService = {
      ...createMockVolundrService(),
      getSessions: async () => [],
    };
    wrap(<VolundrPage />, emptyService);
    await waitFor(() => expect(screen.getByText(/No sessions yet/)).toBeInTheDocument());
  });

  it('shows error state when the service throws', async () => {
    const failingService = {
      ...createMockVolundrService(),
      getSessions: async () => {
        throw new Error('service unavailable');
      },
    };
    wrap(<VolundrPage />, failingService);
    await waitFor(() => expect(screen.getByText('service unavailable')).toBeInTheDocument());
  });

  it('renders the rune glyph', () => {
    wrap(<VolundrPage />);
    expect(screen.getByText('ᚲ')).toBeInTheDocument();
  });
});
