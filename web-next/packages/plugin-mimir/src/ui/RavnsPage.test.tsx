import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { RavnsPage } from './RavnsPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';
import { renderWithMimir } from '../testing/renderWithMimir';

const wrap = renderWithMimir;

describe('RavnsPage', () => {
  it('renders the page title', () => {
    wrap(<RavnsPage />);
    expect(screen.getByRole('heading', { name: /ravns/i })).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<RavnsPage />);
    expect(screen.getByText(/loading ravns/)).toBeInTheDocument();
  });

  it('renders ravn items after load', async () => {
    wrap(<RavnsPage />);
    await waitFor(() => expect(screen.getAllByTestId('ravn-item').length).toBeGreaterThan(0));
  });

  it('shows each ravn id', async () => {
    wrap(<RavnsPage />);
    await waitFor(() => expect(screen.getByText('ravn-fjolnir')).toBeInTheDocument());
    expect(screen.getByText('ravn-skald')).toBeInTheDocument();
  });

  it('shows ravn state labels', async () => {
    wrap(<RavnsPage />);
    await waitFor(() => expect(screen.getAllByTestId('ravn-state').length).toBeGreaterThan(0));
    const states = screen.getAllByTestId('ravn-state');
    const texts = states.map((el) => el.textContent);
    expect(texts).toContain('active');
    expect(texts).toContain('idle');
  });

  it('shows dream stats for ravns that have dream cycles', async () => {
    wrap(<RavnsPage />);
    await waitFor(() => expect(screen.getAllByTestId('ravn-dream').length).toBeGreaterThan(0));
    // First ravn has dream cycle — verify stats
    const dream = screen.getAllByTestId('ravn-dream')[0]!;
    expect(dream).toBeInTheDocument();
  });

  it('shows "no dream cycles yet" for ravns without dreams', async () => {
    wrap(<RavnsPage />);
    await waitFor(() => expect(screen.getByTestId('ravn-no-dream')).toBeInTheDocument());
  });

  it('shows mount chips for each ravn', async () => {
    wrap(<RavnsPage />);
    await waitFor(() => expect(screen.getAllByTestId('ravn-item').length).toBeGreaterThan(0));
    // 'local' mount should be visible
    expect(screen.getAllByText(/local/).length).toBeGreaterThan(0);
  });

  it('shows error state when service throws', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      mounts: {
        ...createMimirMockAdapter().mounts,
        listRavnBindings: async () => {
          throw new Error('ravns service down');
        },
      },
    };
    wrap(<RavnsPage />, failing);
    await waitFor(() => expect(screen.getByText('ravns service down')).toBeInTheDocument());
  });

  it('shows empty message when bindings list is empty', async () => {
    const empty: IMimirService = {
      ...createMimirMockAdapter(),
      mounts: {
        ...createMimirMockAdapter().mounts,
        listRavnBindings: async () => [],
      },
    };
    wrap(<RavnsPage />, empty);
    await waitFor(() => expect(screen.getByText(/no ravn bindings/i)).toBeInTheDocument());
  });
});
