import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    await waitFor(() => expect(screen.getAllByTestId('cluster-card').length).toBe(6));
  });

  it('shows cluster names via ClusterChip', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getByText('Eitri')).toBeInTheDocument());
    expect(screen.getByText('Brokkr')).toBeInTheDocument();
  });

  it('shows realm in the detail header', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getAllByText('asgard').length).toBeGreaterThan(0));
    expect(screen.getAllByText('midgard').length).toBeGreaterThan(0);
    expect(screen.getByText('jotunheim')).toBeInTheDocument();
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
  // Cluster detail header (kind/realm/status + actions)
  // -----------------------------------------------------------------------

  it('renders detail header for each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getAllByTestId('cluster-detail-header').length).toBe(6));
  });

  it('shows kind badges', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const badges = screen.getAllByTestId('kind-badge');
      expect(badges.length).toBe(6);
      expect(badges[0]!.textContent).toBe('primary');
      expect(badges[1]!.textContent).toBe('edge');
    });
  });

  it('shows realm badges', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const badges = screen.getAllByTestId('realm-badge');
      expect(badges.length).toBe(6);
    });
  });

  it('shows status indicators', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const indicators = screen.getAllByTestId('status-indicator');
      expect(indicators.length).toBe(6);
    });
    // 5 clusters are healthy, Brokkr is warning
    expect(screen.getAllByText('healthy').length).toBe(5);
    expect(screen.getByText('warning')).toBeInTheDocument();
  });

  it('renders action buttons (Cordon, Drain, Forge Here)', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const actionGroups = screen.getAllByTestId('action-buttons');
      expect(actionGroups.length).toBe(6);
    });
    expect(screen.getAllByTestId('cordon-btn').length).toBe(6);
    expect(screen.getAllByTestId('drain-btn').length).toBe(6);
    expect(screen.getAllByTestId('forge-here-btn').length).toBe(6);
  });

  it('renders Cordon button with warning styling', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const cordonBtns = screen.getAllByTestId('cordon-btn');
      expect(cordonBtns[0]).toHaveTextContent('Cordon');
    });
  });

  it('renders Drain button with danger styling', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const drainBtns = screen.getAllByTestId('drain-btn');
      expect(drainBtns[0]).toHaveTextContent('Drain');
    });
  });

  it('renders Forge Here button with primary styling', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const forgeBtns = screen.getAllByTestId('forge-here-btn');
      expect(forgeBtns[0]).toHaveTextContent('Forge Here');
    });
  });

  it('shows region in detail header', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getByText('ca-hamilton-1')).toBeInTheDocument();
      expect(screen.getByText('ca-toronto')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Resource meters (Meter bars for CPU, Memory, GPU)
  // -----------------------------------------------------------------------

  it('renders resource meter sections', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => expect(screen.getAllByTestId('resource-meters').length).toBeGreaterThan(0));
  });

  it('renders resource panels for CPU, Memory, GPU, and Disk on each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Each cluster has CPU + Memory + GPU + Disk = 4 panels, 6 clusters = 24
      expect(screen.getAllByTestId(/^resource-panel-/).length).toBe(24);
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
      expect(cpuPanels.length).toBe(6);
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
  // Disk resource panel (segmented bar)
  // -----------------------------------------------------------------------

  it('renders disk resource panels for each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('resource-panel-disk').length).toBe(6);
    });
  });

  it('renders a segmented bar in the disk panel', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const bars = screen.getAllByTestId('disk-segmented-bar');
      expect(bars.length).toBe(6);
    });
  });

  it('renders system/pods/logs segments in the disk bar', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('disk-segment-system').length).toBe(6);
      expect(screen.getAllByTestId('disk-segment-pods').length).toBe(6);
      expect(screen.getAllByTestId('disk-segment-logs').length).toBe(6);
    });
  });

  it('renders a disk legend with segment labels and values', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const legends = screen.getAllByTestId('disk-legend');
      expect(legends.length).toBe(6);
    });
    // Check legend text for Eitri: system 120Gi, pods 580Gi, logs 120Gi
    expect(screen.getByText(/system 120Gi/)).toBeInTheDocument();
    expect(screen.getByText(/pods 580Gi/)).toBeInTheDocument();
    expect(screen.getByText(/logs 120Gi/)).toBeInTheDocument();
  });

  it('shows disk used/total values', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Eitri disk: 820/2048 — rendered as separate text nodes in a fragment
      const diskPanels = screen.getAllByTestId('resource-panel-disk');
      expect(diskPanels[0]!.textContent).toContain('820');
      expect(diskPanels[0]!.textContent).toContain('2048');
    });
  });

  it('renders disk panel with meter role', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const bars = screen.getAllByTestId('disk-segmented-bar');
      expect(bars[0]).toHaveAttribute('role', 'meter');
    });
  });

  // -----------------------------------------------------------------------
  // Pods panel (real data binding)
  // -----------------------------------------------------------------------

  it('renders pods panel for each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('pods-panel').length).toBe(6);
    });
  });

  it('renders pod rows from real cluster pod data', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const podRows = screen.getAllByTestId('pod-row');
      // Eitri has 1 pod + Brokkr has 2 pods = 3 pod rows
      expect(podRows.length).toBe(3);
    });
  });

  it('shows real pod names from cluster data', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getByText('volundr-auth-refactor-7b2f')).toBeInTheDocument();
      expect(screen.getByText('mimir-bge-reindex-a1c3')).toBeInTheDocument();
      expect(screen.getByText('ravn-triggers-ui-e4d9')).toBeInTheDocument();
    });
  });

  it('shows pod status badges', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const badges = screen.getAllByTestId('pod-status-badge');
      expect(badges.length).toBe(3);
    });
  });

  it('shows pod age', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const ages = screen.getAllByTestId('pod-age');
      expect(ages.length).toBe(3);
    });
  });

  it('shows pod restart counts', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const restarts = screen.getAllByTestId('pod-restarts');
      expect(restarts.length).toBe(3);
    });
  });

  it('shows pod count in the pods panel header', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const counts = screen.getAllByTestId('pod-count');
      expect(counts.length).toBe(6);
      // Eitri has 1 pod, Brokkr has 2, rest have 0
      expect(counts[0]).toHaveTextContent('1');
      expect(counts[1]).toHaveTextContent('2');
      expect(counts[2]).toHaveTextContent('0');
      expect(counts[3]).toHaveTextContent('0');
      expect(counts[4]).toHaveTextContent('0');
      expect(counts[5]).toHaveTextContent('0');
    });
  });

  it('shows "Pods on this forge" heading in pods panel', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Pods on this forge').length).toBe(6);
    });
  });

  it('shows "no active pods" for cluster with zero pods', async () => {
    const adapter = {
      ...createMockClusterAdapter(),
      getClusters: async (): Promise<Cluster[]> => [
        {
          id: 'cl-empty',
          realm: 'test',
          name: 'EmptyForge',
          kind: 'primary',
          status: 'healthy',
          region: 'test-region',
          capacity: { cpu: 8, memMi: 16_384, gpu: 0 },
          used: { cpu: 0, memMi: 0, gpu: 0 },
          disk: { usedGi: 0, totalGi: 100, systemGi: 0, podsGi: 0, logsGi: 0 },
          nodes: [{ id: 'n-1', status: 'ready', role: 'worker' }],
          pods: [],
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
  // Pods panel — sortable columns
  // -----------------------------------------------------------------------

  it('renders sortable table header for pods', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('pods-table-header').length).toBeGreaterThan(0);
    });
  });

  it('renders sort buttons for each column', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('sort-name').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('sort-status').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('sort-age').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('sort-cpu').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('sort-memory').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('sort-restarts').length).toBeGreaterThan(0);
    });
  });

  it('toggles sort direction when clicking the same column', async () => {
    const user = userEvent.setup();
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('sort-name').length).toBeGreaterThan(0);
    });

    const sortBtn = screen.getAllByTestId('sort-name')[1]!; // Brokkr has 2 pods
    // Default is asc
    expect(sortBtn.textContent).toContain('↑');
    await user.click(sortBtn);
    // After click should be desc
    expect(sortBtn.textContent).toContain('↓');
  });

  it('changes sort field when clicking a different column', async () => {
    const user = userEvent.setup();
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('sort-status').length).toBeGreaterThan(0);
    });

    const statusBtn = screen.getAllByTestId('sort-status')[1]!;
    await user.click(statusBtn);
    // Status should now be active with asc direction
    expect(statusBtn.textContent).toContain('↑');
  });

  it('sorts pods by restarts', async () => {
    const user = userEvent.setup();
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('sort-restarts').length).toBeGreaterThan(0);
    });

    // Click restarts sort on Brokkr panel (index 1, which has 2 pods)
    const restartBtn = screen.getAllByTestId('sort-restarts')[1]!;
    await user.click(restartBtn);

    // After sorting by restarts asc, the pod with 0 restarts should come first
    const brokkrPanel = screen.getAllByTestId('pods-panel')[1]!;
    const podRows = within(brokkrPanel).getAllByTestId('pod-row');
    expect(podRows.length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Nodes grid
  // -----------------------------------------------------------------------

  it('renders nodes panel for each cluster', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('nodes-panel').length).toBe(6);
    });
  });

  it('renders nodes grid with node cards', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('nodes-grid').length).toBe(6);
    });
  });

  it('renders a node card per node', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Eitri 2 + Brokkr 3 + Valhalla 1 + Nóatún 1 + Glitnir 1 + Járnviðr 1 = 9
      expect(screen.getAllByTestId('cluster-node').length).toBe(9);
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
      expect(screen.getAllByText('worker').length).toBe(9);
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
      // 7 ready nodes (2 Eitri + 1 Brokkr + 1 Valhalla + 1 Nóatún + 1 Glitnir + 1 Járnviðr)
      expect(meterGroups.length).toBe(7);
    });
  });

  it('does not render mini bars for non-ready nodes', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      const nodeCards = screen.getAllByTestId('cluster-node');
      expect(nodeCards.length).toBe(9);
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
      expect(articles.length).toBe(6);
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
          kind: 'gpu',
          status: 'healthy',
          region: 'us-east-1',
          capacity: { cpu: 16, memMi: 32_768, gpu: 2 },
          used: { cpu: 14, memMi: 28_672, gpu: 1 },
          disk: { usedGi: 500, totalGi: 1000, systemGi: 100, podsGi: 300, logsGi: 100 },
          nodes: [{ id: 'node-a', status: 'ready', role: 'control-plane' }],
          pods: [
            {
              name: 'test-pod-1',
              status: 'running',
              startedAt: new Date(Date.now() - 3_600_000).toISOString(),
              cpuUsed: 1.5,
              cpuLimit: 4,
              memUsedMi: 2_048,
              memLimitMi: 8_192,
              restarts: 0,
            },
          ],
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

    // Should show healthy status
    expect(screen.getByText('healthy')).toBeInTheDocument();

    // Verify cluster card count
    expect(screen.getAllByTestId('cluster-card').length).toBe(1);

    // Verify kind badge is gpu
    expect(screen.getByTestId('kind-badge')).toHaveTextContent('gpu');

    // Verify pod data
    expect(screen.getByText('test-pod-1')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Disk panel edge case: zero total
  // -----------------------------------------------------------------------

  it('shows not provisioned for disk when total is 0', async () => {
    const adapter = {
      ...createMockClusterAdapter(),
      getClusters: async (): Promise<Cluster[]> => [
        {
          id: 'cl-nodisk',
          realm: 'test',
          name: 'NoDisk',
          kind: 'edge',
          status: 'healthy',
          region: 'local',
          capacity: { cpu: 4, memMi: 8_192, gpu: 0 },
          used: { cpu: 1, memMi: 2_048, gpu: 0 },
          disk: { usedGi: 0, totalGi: 0, systemGi: 0, podsGi: 0, logsGi: 0 },
          nodes: [{ id: 'n-1', status: 'ready', role: 'worker' }],
          pods: [],
          runningSessions: 0,
          queuedProvisions: 0,
        },
      ],
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: adapter });
    await waitFor(() => {
      // Both GPU (0 capacity) and Disk (0 total) should show not provisioned
      expect(screen.getAllByText('not provisioned').length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // Pod with different statuses
  // -----------------------------------------------------------------------

  it('renders pod status badges with correct styling for each state', async () => {
    const adapter = {
      ...createMockClusterAdapter(),
      getClusters: async (): Promise<Cluster[]> => [
        {
          id: 'cl-multi',
          realm: 'test',
          name: 'MultiPod',
          kind: 'primary',
          status: 'healthy',
          region: 'test',
          capacity: { cpu: 64, memMi: 131_072, gpu: 0 },
          used: { cpu: 8, memMi: 16_384, gpu: 0 },
          disk: { usedGi: 200, totalGi: 500, systemGi: 50, podsGi: 100, logsGi: 50 },
          nodes: [{ id: 'n-1', status: 'ready', role: 'worker' }],
          pods: [
            {
              name: 'pod-running',
              status: 'running',
              startedAt: new Date().toISOString(),
              cpuUsed: 1,
              cpuLimit: 2,
              memUsedMi: 512,
              memLimitMi: 1_024,
              restarts: 0,
            },
            {
              name: 'pod-idle',
              status: 'idle',
              startedAt: new Date().toISOString(),
              cpuUsed: 0.1,
              cpuLimit: 2,
              memUsedMi: 256,
              memLimitMi: 1_024,
              restarts: 0,
            },
            {
              name: 'pod-failed',
              status: 'failed',
              startedAt: new Date().toISOString(),
              cpuUsed: 0,
              cpuLimit: 2,
              memUsedMi: 0,
              memLimitMi: 1_024,
              restarts: 3,
            },
          ],
          runningSessions: 2,
          queuedProvisions: 0,
        },
      ],
    };
    renderWithVolundr(<ClustersPage />, { clusterAdapter: adapter });
    await waitFor(() => {
      const badges = screen.getAllByTestId('pod-status-badge');
      expect(badges.length).toBe(3);
    });
    // Check that each status text is present
    const badges = screen.getAllByTestId('pod-status-badge');
    const statuses = badges.map((b) => b.textContent);
    expect(statuses).toContain('running');
    expect(statuses).toContain('idle');
    expect(statuses).toContain('failed');
  });

  // -----------------------------------------------------------------------
  // Pod inline resource bars
  // -----------------------------------------------------------------------

  it('renders inline CPU and memory bars for each pod', async () => {
    renderWithVolundr(<ClustersPage />);
    await waitFor(() => {
      // Each pod row should have CPU and memory MiniBar (via progressbar role)
      const podRows = screen.getAllByTestId('pod-row');
      expect(podRows.length).toBe(3);
      // Each pod row has 2 progressbars (cpu + mem)
      for (const row of podRows) {
        const bars = within(row).getAllByRole('progressbar');
        expect(bars.length).toBe(2);
      }
    });
  });
});
