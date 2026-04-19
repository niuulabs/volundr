import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SearchPage } from './SearchPage';
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

describe('SearchPage', () => {
  it('renders the search input and title', () => {
    wrap(<SearchPage />);
    expect(screen.getByRole('heading', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('renders all three mode toggle buttons', () => {
    wrap(<SearchPage />);
    expect(screen.getByRole('button', { name: /full-text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /semantic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hybrid/i })).toBeInTheDocument();
  });

  it('hybrid mode is active by default', () => {
    wrap(<SearchPage />);
    const hybridBtn = screen.getByRole('button', { name: /hybrid/i });
    expect(hybridBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a mode button marks it active', () => {
    wrap(<SearchPage />);
    const ftsBtn = screen.getByRole('button', { name: /full-text/i });
    fireEvent.click(ftsBtn);
    expect(ftsBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /hybrid/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows no results before typing', () => {
    wrap(<SearchPage />);
    expect(screen.queryByTestId('search-result')).not.toBeInTheDocument();
  });

  it('shows results after typing a matching query', async () => {
    wrap(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'architecture' } });
    await waitFor(() => expect(screen.getAllByTestId('search-result').length).toBeGreaterThan(0));
  });

  it('shows empty message when no results match', async () => {
    wrap(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'xyzxyzxyz_no_match_at_all' },
    });
    await waitFor(() =>
      expect(screen.getByText(/no results found/i)).toBeInTheDocument(),
    );
  });

  it('shows error state when the service throws', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      pages: {
        ...createMimirMockAdapter().pages,
        search: async () => {
          throw new Error('search service down');
        },
      },
    };
    wrap(<SearchPage />, failing);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'test' } });
    await waitFor(() =>
      expect(screen.getByText('search service down')).toBeInTheDocument(),
    );
  });

  it('each result shows title, category and path', async () => {
    wrap(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'architecture' } });
    await waitFor(() => expect(screen.getAllByTestId('search-result').length).toBeGreaterThan(0));
    const results = screen.getAllByTestId('search-result');
    const first = results[0]!;
    expect(first.querySelector('.search-page__result-title')).toBeTruthy();
    expect(first.querySelector('.search-page__result-path')).toBeTruthy();
  });
});
