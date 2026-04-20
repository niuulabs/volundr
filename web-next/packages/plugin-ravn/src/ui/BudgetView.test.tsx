import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BudgetView } from './BudgetView';
import { createMockBudgetStream, createMockRavenStream } from '../adapters/mock';
import { wrapWithServices } from '../testing/wrapWithRavn';

const wrap = wrapWithServices;

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

  it('renders four attention columns', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(() => {
      expect(screen.getByLabelText(/budget attention/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Over cap')).toBeInTheDocument();
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
    const headers = table.querySelectorAll('th');
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain('spent');
    expect(headerTexts).toContain('cap');
  });

  it('shows top drivers section after budgets load', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(
      () => expect(screen.getByTestId('top-drivers')).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('top drivers list has driver rows', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(
      () => expect(screen.getAllByTestId('driver-row').length).toBeGreaterThan(0),
      { timeout: 3000 },
    );
  });

  it('shows recommended changes when ravens need attention', async () => {
    render(<BudgetView />, { wrapper: wrap(services) });
    await waitFor(
      () => expect(screen.getByTestId('recommended-changes')).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });
});
