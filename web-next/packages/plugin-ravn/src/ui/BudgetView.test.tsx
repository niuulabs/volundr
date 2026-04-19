import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { BudgetView } from './BudgetView';
import { createMockBudgetStream, createMockRavenStream } from '../adapters/mock';

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

const services = {
  'ravn.budget': createMockBudgetStream(),
  'ravn.ravens': createMockRavenStream(),
};

describe('BudgetView', () => {
  it('shows loading state initially', () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    expect(screen.getByText(/loading budget/i)).toBeInTheDocument();
  });

  it('shows hero card after loading', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByLabelText(/fleet budget/i)).toBeInTheDocument());
  });

  it('shows fleet budget KPIs', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => {
      expect(screen.getByText('spent')).toBeInTheDocument();
      expect(screen.getByText('cap')).toBeInTheDocument();
      expect(screen.getByText('runway')).toBeInTheDocument();
    });
  });

  it('renders three attention columns', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => {
      expect(screen.getByLabelText(/budget attention/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Burning fast')).toBeInTheDocument();
      expect(screen.getByLabelText('Near cap')).toBeInTheDocument();
      expect(screen.getByLabelText('Idle')).toBeInTheDocument();
    });
  });

  it('collapsible fleet table is hidden initially', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText(/full fleet table/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/fleet budget table/i)).not.toBeInTheDocument();
  });

  it('expands fleet table when toggle is clicked', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText(/full fleet table/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/full fleet table/i));
    expect(screen.getByLabelText(/fleet budget table/i)).toBeInTheDocument();
  });

  it('collapses fleet table on second click', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText(/full fleet table/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/full fleet table/i));
    expect(screen.getByLabelText(/fleet budget table/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/full fleet table/i));
    expect(screen.queryByLabelText(/fleet budget table/i)).not.toBeInTheDocument();
  });

  it('fleet table has correct column headers', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByText(/full fleet table/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/full fleet table/i));
    const table = screen.getByLabelText(/fleet budget table/i);
    expect(table).toBeInTheDocument();
    expect(table.querySelector('th:first-child')).toHaveTextContent('ravn');
    // Multiple 'spent'/'cap' exist in hero card + table; check the table specifically
    const headers = table.querySelectorAll('th');
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain('spent');
    expect(headerTexts).toContain('cap');
  });
});
