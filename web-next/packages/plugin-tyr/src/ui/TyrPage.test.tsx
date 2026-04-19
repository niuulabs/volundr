import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { TyrPage } from './TyrPage';
import { createMockTyrService } from '../adapters/mock';

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

describe('TyrPage', () => {
  it('renders the page title', async () => {
    render(<TyrPage />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    expect(screen.getByText(/tyr/)).toBeInTheDocument();
  });

  it('shows loading state then saga count', async () => {
    render(<TyrPage />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    await waitFor(() => expect(screen.getByText(/3 sagas loaded/)).toBeInTheDocument());
  });

  it('renders the Tyr rune glyph', async () => {
    render(<TyrPage />, {
      wrapper: wrap({ tyr: createMockTyrService() }),
    });
    expect(screen.getByText('ᛏ')).toBeInTheDocument();
  });

  it('shows error state when service throws', async () => {
    const failing = {
      getSagas: async () => {
        throw new Error('tyr unavailable');
      },
    };
    render(<TyrPage />, {
      wrapper: wrap({ tyr: failing }),
    });
    await waitFor(() => expect(screen.getByText('tyr unavailable')).toBeInTheDocument());
  });

  it('shows singular "saga" for a single result', async () => {
    const single = {
      getSagas: async () => [
        {
          id: '00000000-0000-0000-0000-000000000001',
          trackerId: 'NIU-1',
          trackerType: 'linear',
          slug: 'test',
          name: 'Test Saga',
          repos: [],
          featureBranch: 'feat/test',
          status: 'active' as const,
          confidence: 80,
          createdAt: '2026-01-01T00:00:00Z',
          phaseSummary: { total: 1, completed: 0 },
        },
      ],
    };
    render(<TyrPage />, { wrapper: wrap({ tyr: single }) });
    await waitFor(() => expect(screen.getByText(/1 saga loaded/)).toBeInTheDocument());
  });
});
