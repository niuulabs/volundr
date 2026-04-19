import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { MimirPage } from './MimirPage';
import { createMockMimirService } from '../adapters/mock';

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ mimir: createMockMimirService() }}>{ui}</ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('MimirPage', () => {
  it('renders the title and rune glyph', () => {
    wrap(<MimirPage />);
    expect(screen.getByText(/Mímir/)).toBeInTheDocument();
    expect(screen.getByText(/the well of knowledge/)).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<MimirPage />);
    expect(screen.getByText(/loading/)).toBeInTheDocument();
  });

  it('renders stats cards after data loads', async () => {
    wrap(<MimirPage />);
    await waitFor(() => expect(screen.getByText('pages')).toBeInTheDocument());
    expect(screen.getByText('categories')).toBeInTheDocument();
    expect(screen.getByText('health')).toBeInTheDocument();
  });

  it('shows error state when service throws', async () => {
    const failing = Object.assign(createMockMimirService(), {
      getStats: async () => {
        throw new Error('service unavailable');
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ServicesProvider services={{ mimir: failing }}>
          <MimirPage />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('service unavailable')).toBeInTheDocument());
  });
});
