import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { RavnPage } from './RavnPage';
import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockSessionStream,
  createMockTriggerStore,
  createMockBudgetStream,
} from '../adapters/mock';

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

const allServices = {
  'ravn.personas': createMockPersonaStore(),
  'ravn.ravens': createMockRavenStream(),
  'ravn.sessions': createMockSessionStream(),
  'ravn.triggers': createMockTriggerStore(),
  'ravn.budget': createMockBudgetStream(),
};

describe('RavnPage', () => {
  it('renders the page heading', () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    expect(screen.getByText('Ravn')).toBeInTheDocument();
  });

  it('renders the Ravn rune glyph', () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    expect(screen.getByText('ᚱ')).toBeInTheDocument();
  });

  it('renders all five tabs', () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    expect(screen.getByRole('tab', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Triggers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Log' })).toBeInTheDocument();
  });

  it('Sessions tab is selected by default', () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switching to Triggers tab shows triggers content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    fireEvent.click(screen.getByRole('tab', { name: 'Triggers' }));
    expect(screen.getByRole('tab', { name: 'Triggers' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /cron triggers/i })).toBeInTheDocument(),
    );
  });

  it('switching to Events tab shows events content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    await waitFor(() => expect(screen.getByLabelText(/event graph/i)).toBeInTheDocument());
  });

  it('switching to Budget tab shows budget content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    fireEvent.click(screen.getByRole('tab', { name: 'Budget' }));
    await waitFor(() => expect(screen.getByLabelText(/fleet budget/i)).toBeInTheDocument());
  });

  it('switching to Log tab shows log content', async () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    fireEvent.click(screen.getByRole('tab', { name: 'Log' }));
    expect(screen.getByRole('log', { name: /event log/i })).toBeInTheDocument();
  });

  it('tab panel has correct aria-labelledby', () => {
    render(<RavnPage />, { wrapper: wrap(allServices) });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'ravn-tab-sessions');
  });
});
