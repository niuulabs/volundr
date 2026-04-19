import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { MimirPage } from './MimirPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';

function wrap(ui: React.ReactNode, service?: IMimirService) {
  const svc = service ?? createMimirMockAdapter();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ mimir: svc }}>{ui}</ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('MimirPage', () => {
  it('renders the rune and title', () => {
    wrap(<MimirPage />);
    expect(screen.getByText('Mímir')).toBeInTheDocument();
    expect(screen.getByText('the well of knowledge')).toBeInTheDocument();
  });

  it('renders the tab navigation', () => {
    wrap(<MimirPage />);
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sources' })).toBeInTheDocument();
  });

  it('Overview tab is active by default', () => {
    wrap(<MimirPage />);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders KPI metrics on the Overview tab after data loads', async () => {
    wrap(<MimirPage />);
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'KPI metrics' })).toBeInTheDocument(),
    );
  });

  it('renders mount names on the Overview tab', async () => {
    wrap(<MimirPage />);
    await waitFor(() => expect(screen.getAllByText('local').length).toBeGreaterThan(0));
    expect(screen.getAllByText('shared').length).toBeGreaterThan(0);
  });

  it('shows error message on overview when mounts fail', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      mounts: {
        ...createMimirMockAdapter().mounts,
        listMounts: async () => {
          throw new Error('mount service unavailable');
        },
      },
    };
    wrap(<MimirPage />, failing);
    await waitFor(() =>
      expect(screen.getByText('mount service unavailable')).toBeInTheDocument(),
    );
  });
});
