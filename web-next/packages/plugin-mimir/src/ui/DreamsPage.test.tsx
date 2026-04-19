import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { DreamsPage } from './DreamsPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';
import { renderWithMimir } from '../testing/renderWithMimir';

const wrap = renderWithMimir;

describe('DreamsPage', () => {
  it('renders the page title', () => {
    wrap(<DreamsPage />);
    expect(screen.getByRole('heading', { name: /dreams/i })).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<DreamsPage />);
    expect(screen.getByText(/loading dream cycles/)).toBeInTheDocument();
  });

  it('renders dream cycle entries after load', async () => {
    wrap(<DreamsPage />);
    await waitFor(() => expect(screen.getAllByTestId('dream-cycle').length).toBeGreaterThan(0));
  });

  it('shows ravn chip for each cycle', async () => {
    wrap(<DreamsPage />);
    await waitFor(() => expect(screen.getAllByTestId('dream-cycle').length).toBeGreaterThan(0));
    expect(screen.getAllByText('ravn-fjolnir').length).toBeGreaterThan(0);
  });

  it('shows pages updated count', async () => {
    wrap(<DreamsPage />);
    await waitFor(() => expect(screen.getAllByTestId('dream-pages').length).toBeGreaterThan(0));
    const pagesStats = screen.getAllByTestId('dream-pages');
    expect(pagesStats[0]).toHaveTextContent(/pages updated/);
  });

  it('shows entities created count', async () => {
    wrap(<DreamsPage />);
    await waitFor(() => expect(screen.getAllByTestId('dream-entities').length).toBeGreaterThan(0));
    const entStats = screen.getAllByTestId('dream-entities');
    expect(entStats[0]).toHaveTextContent(/entities created/);
  });

  it('shows lint fixes count', async () => {
    wrap(<DreamsPage />);
    await waitFor(() => expect(screen.getAllByTestId('dream-fixes').length).toBeGreaterThan(0));
    const fixStats = screen.getAllByTestId('dream-fixes');
    expect(fixStats[0]).toHaveTextContent(/lint fixes/);
  });

  it('shows error state when service throws', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      lint: {
        ...createMimirMockAdapter().lint,
        getDreamCycles: async () => {
          throw new Error('dreams service down');
        },
      },
    };
    wrap(<DreamsPage />, failing);
    await waitFor(() => expect(screen.getByText('dreams service down')).toBeInTheDocument());
  });

  it('shows empty message when no cycles exist', async () => {
    const empty: IMimirService = {
      ...createMimirMockAdapter(),
      lint: {
        ...createMimirMockAdapter().lint,
        getDreamCycles: async () => [],
      },
    };
    wrap(<DreamsPage />, empty);
    await waitFor(() => expect(screen.getByText(/no dream cycles recorded/i)).toBeInTheDocument());
  });

  it('renders mount chips for each cycle', async () => {
    wrap(<DreamsPage />);
    await waitFor(() => expect(screen.getAllByTestId('dream-cycle').length).toBeGreaterThan(0));
    // local and shared mounts should appear
    expect(screen.getAllByText('local').length).toBeGreaterThan(0);
    expect(screen.getAllByText('shared').length).toBeGreaterThan(0);
  });
});
