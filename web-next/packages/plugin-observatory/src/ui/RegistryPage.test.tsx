import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { RegistryPage } from './RegistryPage';
import { createMockRegistryRepository } from '../adapters/mock';

function wrap(ui: React.ReactNode, repo = createMockRegistryRepository()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ 'observatory.registry': repo }}>{ui}</ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('RegistryPage', () => {
  it('renders the Registry title and subtitle', () => {
    wrap(<RegistryPage />);
    expect(screen.getByText('Registry')).toBeInTheDocument();
    expect(screen.getByText(/entity type definitions/)).toBeInTheDocument();
  });

  it('shows loading state before data resolves', () => {
    wrap(<RegistryPage />);
    expect(screen.getByText('loading…')).toBeInTheDocument();
  });

  it('renders entity types once data loads', async () => {
    wrap(<RegistryPage />);
    await waitFor(() => expect(screen.getByText('Realm')).toBeInTheDocument());
    expect(screen.getByText('Cluster')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
    expect(screen.getByText('Raid')).toBeInTheDocument();
  });

  it('shows version and type count in the metadata line', async () => {
    wrap(<RegistryPage />);
    await waitFor(() => expect(screen.getByText(/v7/)).toBeInTheDocument());
    expect(screen.getByText(/18 types/)).toBeInTheDocument();
  });

  it('renders error state when the repository throws', async () => {
    const failingRepo = {
      getRegistry: async () => {
        throw new Error('registry unavailable');
      },
    };
    wrap(<RegistryPage />, failingRepo);
    await waitFor(() => expect(screen.getByText('registry unavailable')).toBeInTheDocument());
  });
});
