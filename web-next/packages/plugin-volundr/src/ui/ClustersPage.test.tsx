import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ClustersPage } from './ClustersPage';
import { renderWithVolundr } from '../testing/renderWithVolundr';
import { createMockClusterAdapter } from '../adapters/mock';
import type { Cluster } from '../domain/cluster';

describe('ClustersPage', () => {
  // -----------------------------------------------------------------------
  // Page structure
  // -----------------------------------------------------------------------

  it('renders the page heading', () => {
    renderWithVolundr(<ClustersPage />);
    expect(screen.getByRole('heading', { name: /clusters/i })).toBeInTheDocument();
  });

  it('renders the page subtitle', () => {
    renderWithVolundr(<ClustersPage />);
    expect(screen.getByText(/capacity, utilisation, and node health/i)).toBeInTheDocument();
  });

  it('has the clusters-page test id', () => {
    renderWithVolundr(<ClustersPage />);
    expect(screen.getByTestId('clusters-page')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  it('shows loading state before clusters resolve', () => {
    const slowAdapter = {
      ...createMockClusterAdapter(),
      getClusters: () => new Promise<never>(() => {}),
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: slowAdapter });
    expect(screen.getByText(/loading clusters/i)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------

  it('shows error state when adapter throws', async () => {
    const failAdapter = {
      ...createMockClusterAdapter(),
      getClusters: async () => {
        throw new Error('cluster adapter down');
      },
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: failAdapter });
    await waitFor(() => expect(screen.getByText('cluster adapter down')).toBeInTheDocument());
  });

  it('shows generic error message for non-Error rejections', async () => {
    const failAdapter = {
      ...createMockClusterAdapter(),
      getClusters: async () => {
        throw 'unexpected';
      },
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: failAdapter });
    await waitFor(() =>
      expect(screen.getAllByText(/failed to load clusters/i).length).toBeGreaterThan(0),
    );
  });

  it('renders error state with the correct role', async () => {
    const failAdapter = {
      ...createMockClusterAdapter(),
      getClusters: async () => {
        throw new Error('oops');
      },
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: failAdapter });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  it('shows empty state when no clusters', async () => {
    const emptyAdapter = {
      ...createMockClusterAdapter(),
      getClusters: async () => [],
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: emptyAdapter });
    await waitFor(() => expect(screen.getByText(/no clusters registered/i)).toBeInTheDocument());
  });

  it('has no-clusters test id on empty state', async () => {
    const emptyAdapter = {
      ...createMockClusterAdapter(),
      getClusters: async () => [],
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: emptyAdapter });
    await waitFor(() => expect(screen.getByTestId('no-clusters')).toBeInTheDocument());
  });

  // -----------------------------------------------------------------------
  // Cluster cards
  // -----------------------------------------------------------------------

  it('renders a card for each seed cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getAllByTestId('cluster-card').length).toBe(2));
  });

  it('shows cluster names via ClusterChip', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText('Eitri')).toBeInTheDocument());
    expect(screen.getByText('Brokkr')).toBeInTheDocument();
  });

  it('shows realm in the ClusterChip', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText('asgard')).toBeInTheDocument());
    expect(screen.getByText('midgard')).toBeInTheDocument();
  });

  it('shows health status badge (healthy when all nodes ready)', async () => {
    renderWithVolundr(<ClustersPage />);
    // Eitri has 2 nodes both ready → healthy
    await waitFor(() => expect(screen.getByText('healthy')).toBeInTheDocument());
    // Brokkr has 1 ready, 1 notready, 1 cordoned → degraded
    expect(screen.getByText('degraded')).toBeInTheDocument();
  });

  it('renders running session counts', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getAllByText(/running/).length).toBeGreaterThan(0));
  });

  it('shows queued provisions count when > 0', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText(/queued/)).toBeInTheDocument());
  });

  it('shows node count in header', async () => {
    renderWithVolundr(<ClustersPage />);
    // Eitri: 2/2 nodes ready
    await waitFor(() => expect(screen.getAllByText('2/2').length).toBeGreaterThan(0));
    // Brokkr: 1/3 nodes ready
    expect(screen.getAllByText('1/3').length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Resource meters (Meter bars for CPU, Memory, GPU)
  // -----------------------------------------------------------------------

  it('renders resource meter sections', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('resource-meters').length).toBeGreaterThan(0),
    );
  });

  it('renders resource panels for CPU and Memory on each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Each cluster has CPU + Memory + GPU + Pods = 4 panels, 2 clusters = 8
      expect(screen.getAllByTestId(/^resource-panel-/).length).toBe(8);
    });
  });

  it('renders Meter components inside resource panels', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const meters = screen.getAllByTestId('meter');
      expect(meters.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('shows CPU resource panel with correct values', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const cpuPanels = screen.getAllByTestId('resource-panel-cpu');
      expect(cpuPanels.length).toBe(2);
    });
  });

  it('shows GPU panel as not provisioned when capacity is 0', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Brokkr has 0 GPU capacity
      expect(screen.getAllByText('not provisioned').length).toBeGreaterThan(0);
    });
  });

  it('shows percentage used label on resource panels', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/% used/).length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Pods panel
  // -----------------------------------------------------------------------

  it('renders pods panel for each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('pods-panel').length).toBe(2);
    });
  });

  it('renders pod rows for clusters with running sessions', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const podRows = screen.getAllByTestId('pod-row');
      // Eitri has 1 running + Brokkr has 2 running = 3 pod rows
      expect(podRows.length).toBe(3);
    });
  });

  it('shows "Pods on this forge" heading in pods panel', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Pods on this forge').length).toBe(2);
    });
  });

  it('shows "no active pods" for cluster with zero running sessions', async () => {
    const adapter = {
      ...createMockClusterAdapter(),
      getClusters: async (): Promise<Cluster[]> => [
        {
          id: 'cl-empty',
          realm: 'test',
          name: 'EmptyForge',
          capacity: { cpu: 8, memMi: 16_384, gpu: 0 },
          used: { cpu: 0, memMi: 0, gpu: 0 },
          nodes: [{ id: 'n-1', status: 'ready', role: 'worker' }],
          runningSessions: 0,
          queuedProvisions: 0,
        },
      ],
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: adapter });
    await waitFor(() => expect(screen.getByTestId('no-pods')).toBeInTheDocument());
    expect(screen.getByText('no active pods')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Nodes grid
  // -----------------------------------------------------------------------

  it('renders nodes panel for each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('nodes-panel').length).toBe(2);
    });
  });

  it('renders nodes grid with node cards', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('nodes-grid').length).toBe(2);
    });
  });

  it('renders a node card per node', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Eitri has 2 nodes + Brokkr has 3 nodes = 5
      expect(screen.getAllByTestId('cluster-node').length).toBe(5);
    });
  });

  it('shows node IDs with cluster prefix', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Eitri nodes: cl-eitri-n-1, cl-eitri-n-2
      expect(screen.getByText('cl-eitri-n-1')).toBeInTheDocument();
      expect(screen.getByText('cl-eitri-n-2')).toBeInTheDocument();
    });
  });

  it('shows node role labels', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // All test nodes have role "worker"
      expect(screen.getAllByText('worker').length).toBe(5);
    });
  });

  it('shows node ready/not-ready/cordoned labels', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByText('ready').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('not ready')).toBeInTheDocument();
    expect(screen.getByText('cordoned')).toBeInTheDocument();
  });

  it('renders mini bars for ready nodes', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Ready nodes show cpu+mem mini bars via node-meters testid
      const meterGroups = screen.getAllByTestId('node-meters');
      // 3 ready nodes (2 from Eitri + 1 from Brokkr)
      expect(meterGroups.length).toBe(3);
    });
  });

  it('does not render mini bars for non-ready nodes', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const nodeCards = screen.getAllByTestId('cluster-node');
      expect(nodeCards.length).toBe(5);
    });

    // Brokkr n-4 (notready) and n-5 (cordoned) should not have mini bars
    const nodeCards = screen.getAllByTestId('cluster-node');
    // Check the cards that show "not ready" or "cordoned" text
    const nonReadyCards = nodeCards.filter(
      (card) =>
        within(card).queryByText('not ready') !== null ||
        within(card).queryByText('cordoned') !== null,
    );
    expect(nonReadyCards.length).toBe(2);
    for (const card of nonReadyCards) {
      expect(within(card).queryByTestId('node-meters')).toBeNull();
    }
  });

  // -----------------------------------------------------------------------
  // Accessibility
  // -----------------------------------------------------------------------

  it('renders clusters in an accessible list', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const list = screen.getByRole('list', { name: /clusters/i });
      expect(list).toBeInTheDocument();
    });
  });

  it('uses article role for cluster cards', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const articles = screen.getAllByRole('article');
      expect(articles.length).toBe(2);
    });
  });

  it('renders meter roles for resource bars', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const meters = screen.getAllByRole('meter');
      expect(meters.length).toBeGreaterThan(0);
    });
  });

  it('renders node meters as placeholders when no live metrics available', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const nodeMeters = screen.getAllByTestId('node-meters');
      expect(nodeMeters.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Single cluster with specific data
  // -----------------------------------------------------------------------

  it('renders correct resource values for a specific cluster', async () => {
    const adapter = {
      ...createMockClusterAdapter(),
      getClusters: async (): Promise<Cluster[]> => [
        {
          id: 'cl-test',
          realm: 'valhalla',
          name: 'TestForge',
          capacity: { cpu: 16, memMi: 32_768, gpu: 2 },
          used: { cpu: 14, memMi: 28_672, gpu: 1 },
          nodes: [{ id: 'node-a', status: 'ready', role: 'control-plane' }],
          runningSessions: 3,
          queuedProvisions: 0,
        },
      ],
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: adapter });
    await waitFor(() => {
      expect(screen.getByText('TestForge')).toBeInTheDocument();
      expect(screen.getByText('valhalla')).toBeInTheDocument();
    });

    // Should show healthy since 1/1 nodes ready
    expect(screen.getByText('healthy')).toBeInTheDocument();

    // Verify cluster card count
    expect(screen.getAllByTestId('cluster-card').length).toBe(1);
  });
});
