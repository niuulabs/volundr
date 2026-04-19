import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ClustersPage } from './ClustersPage';
import { renderWithVolundr } from '../testing/renderWithVolundr';
import { createMockClusterAdapter } from '../adapters/mock';

describe('ClustersPage', () => {
  it('renders the heading', () => {
    renderWithVolundr(<ClustersPage />);
    expect(screen.getByRole('heading', { name: /clusters/i })).toBeInTheDocument();
  });

  it('shows loading state before clusters resolve', () => {
    const slowAdapter = {
      ...createMockClusterAdapter(),
      getClusters: () => new Promise<never>(() => {}),
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: slowAdapter });
    expect(screen.getByText(/loading clusters/)).toBeInTheDocument();
  });

  it('renders a card for each seed cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('cluster-card').length).toBe(2),
    );
  });

  it('shows cluster names', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText('Eitri')).toBeInTheDocument());
    expect(screen.getByText('Brokkr')).toBeInTheDocument();
  });

  it('shows realm chips', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText('asgard')).toBeInTheDocument());
    expect(screen.getByText('midgard')).toBeInTheDocument();
  });

  it('renders running session counts', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getAllByText(/running/).length).toBeGreaterThan(0));
  });

  it('shows queued provisions count when > 0', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText(/queued/)).toBeInTheDocument());
  });

  it('renders node list with StateDots', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('cluster-node').length).toBeGreaterThan(0),
    );
  });

  it('renders node IDs', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText('n-1')).toBeInTheDocument());
    expect(screen.getByText('n-2')).toBeInTheDocument();
  });

  it('renders capacity progress bars for CPU and Memory', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('cap-cpu').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByTestId('cap-memory').length).toBeGreaterThan(0);
  });

  it('shows error state when adapter throws', async () => {
    const failAdapter = {
      ...createMockClusterAdapter(),
      getClusters: async () => {
        throw new Error('cluster adapter down');
      },
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: failAdapter });
    await waitFor(() =>
      expect(screen.getByText('cluster adapter down')).toBeInTheDocument(),
    );
  });

  it('shows empty state when no clusters', async () => {
    const emptyAdapter = {
      ...createMockClusterAdapter(),
      getClusters: async () => [],
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: emptyAdapter });
    await waitFor(() =>
      expect(screen.getByText(/no clusters registered/i)).toBeInTheDocument(),
    );
  });

  it('shows node ready/not-ready/cordoned labels', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getAllByText('ready').length).toBeGreaterThan(0));
    expect(screen.getByText('not ready')).toBeInTheDocument();
    expect(screen.getByText('cordoned')).toBeInTheDocument();
  });

  it('renders a progress bar for GPU when cluster has GPU capacity', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() =>
      // Eitri has 4 GPU capacity, so GPU cap bar should appear
      expect(screen.getAllByTestId('cap-gpu').length).toBeGreaterThan(0),
    );
  });
});
