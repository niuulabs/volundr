import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { RavnPage } from './RavnPage';
import { createMockRavnService } from '../adapters/mock';
import type { IRavnService } from '../ports';

function wrap(ui: React.ReactNode, service?: IRavnService) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const svc = service ?? createMockRavnService();
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ ravn: svc }}>{ui}</ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('RavnPage', () => {
  it('renders the title and rune', () => {
    wrap(<RavnPage />);
    expect(screen.getByText('Ravn · the flock')).toBeInTheDocument();
    expect(screen.getByText('agent fleet console — coming soon')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<RavnPage />);
    expect(screen.getByText(/loading personas/)).toBeInTheDocument();
  });

  it('renders persona list after loading', async () => {
    wrap(<RavnPage />);
    await waitFor(() => expect(screen.getByText('coding-agent')).toBeInTheDocument());
    expect(screen.getByText('coder')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
  });

  it('shows permission mode for each persona', async () => {
    wrap(<RavnPage />);
    await waitFor(() => expect(screen.getByText('coding-agent')).toBeInTheDocument());
    expect(screen.getAllByText('workspace-write').length).toBeGreaterThan(0);
  });

  it('renders error state when service throws', async () => {
    const failing: IRavnService = {
      ...createMockRavnService(),
      personas: {
        ...createMockRavnService().personas,
        listPersonas: async () => {
          throw new Error('service unavailable');
        },
      },
    };
    wrap(<RavnPage />, failing);
    await waitFor(() => expect(screen.getByText('service unavailable')).toBeInTheDocument());
  });

  it('renders unknown error message when error is not an Error', async () => {
    const failing: IRavnService = {
      ...createMockRavnService(),
      personas: {
        ...createMockRavnService().personas,
        listPersonas: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'string error';
        },
      },
    };
    wrap(<RavnPage />, failing);
    await waitFor(() => expect(screen.getByText('unknown error')).toBeInTheDocument());
  });
});
