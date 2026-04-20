import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { CredentialsPage } from './CredentialsPage';
import { createMockVolundrService } from '../adapters/mock';

function wrap(service = createMockVolundrService()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ volundr: service }}>
        <CredentialsPage />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('CredentialsPage', () => {
  it('renders the page header', () => {
    wrap();
    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByText(/secrets injected into pods/i)).toBeInTheDocument();
  });

  it('renders new credential button', () => {
    wrap();
    expect(screen.getByTestId('new-credential-btn')).toBeInTheDocument();
    expect(screen.getByText('+ new credential')).toBeInTheDocument();
  });

  it('shows empty state when no credentials', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('no-credentials')).toBeInTheDocument());
  });

  it('shows loading state', () => {
    const slowService = {
      ...createMockVolundrService(),
      getCredentials: () => new Promise(() => {}),
    };
    wrap(slowService);
    expect(screen.getByTestId('credentials-loading')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    const errorService = {
      ...createMockVolundrService(),
      getCredentials: () => Promise.reject(new Error('fail')),
    };
    wrap(errorService);
    await waitFor(() => expect(screen.getByTestId('credentials-error')).toBeInTheDocument());
  });

  it('renders credentials table with data', async () => {
    const serviceWithCreds = {
      ...createMockVolundrService(),
      getCredentials: vi.fn().mockResolvedValue([
        {
          id: 'cr-1',
          name: 'anthropic-key',
          secretType: 'api_key',
          keys: ['ANTHROPIC_API_KEY'],
          metadata: {},
          createdAt: '2026-01-01',
          updatedAt: '2d ago',
        },
      ]),
    };
    wrap(serviceWithCreds);
    await waitFor(() => expect(screen.getByText('anthropic-key')).toBeInTheDocument());
    expect(screen.getByText('api key')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument();
  });
});
