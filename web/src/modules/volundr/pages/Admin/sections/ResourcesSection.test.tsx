import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ResourcesSection } from './ResourcesSection';
import type { IVolundrService } from '@/modules/volundr/ports';
import type { ClusterResourceInfo } from '@/modules/volundr/models';

const mockServiceRef = { current: {} as IVolundrService };

vi.mock('@/modules/volundr/adapters', () => ({
  get volundrService() {
    return mockServiceRef.current;
  },
}));

const mockResources: ClusterResourceInfo = {
  resourceTypes: [
    {
      name: 'cpu',
      resourceKey: 'cpu',
      displayName: 'CPU',
      unit: 'cores',
      category: 'compute',
    },
    {
      name: 'memory',
      resourceKey: 'memory',
      displayName: 'Memory',
      unit: 'Gi',
      category: 'compute',
    },
    {
      name: 'gpu',
      resourceKey: 'nvidia.com/gpu',
      displayName: 'GPU',
      unit: 'devices',
      category: 'accelerator',
    },
  ],
  nodes: [
    {
      name: 'node-1',
      labels: {},
      allocatable: { cpu: '16', memory: '64', 'nvidia.com/gpu': '2' },
      allocated: { cpu: '8', memory: '32', 'nvidia.com/gpu': '1' },
      available: { cpu: '8', memory: '32', 'nvidia.com/gpu': '1' },
    },
    {
      name: 'node-2',
      labels: {},
      allocatable: { cpu: '16', memory: '64', 'nvidia.com/gpu': '0' },
      allocated: { cpu: '14', memory: '60', 'nvidia.com/gpu': '0' },
      available: { cpu: '2', memory: '4', 'nvidia.com/gpu': '0' },
    },
  ],
};

const emptyResources: ClusterResourceInfo = {
  resourceTypes: [
    {
      name: 'cpu',
      resourceKey: 'cpu',
      displayName: 'CPU',
      unit: 'cores',
      category: 'compute',
    },
  ],
  nodes: [],
};

function createMockService(data: ClusterResourceInfo = mockResources): IVolundrService {
  return {
    getClusterResources: vi.fn().mockResolvedValue(data),
  } as unknown as IVolundrService;
}

describe('ResourcesSection', () => {
  let service: IVolundrService;

  beforeEach(() => {
    service = createMockService();
    mockServiceRef.current = service;
  });

  it('renders loading state initially', () => {
    service = {
      getClusterResources: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as IVolundrService;

    mockServiceRef.current = service;
    render(<ResourcesSection />);
    expect(screen.getByText('Loading cluster resources...')).toBeInTheDocument();
  });

  it('renders summary cards for each resource type', async () => {
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources')).toBeInTheDocument();
    });

    // Each resource type appears in both summary card and table header
    expect(screen.getAllByText('CPU')).toHaveLength(2);
    expect(screen.getAllByText('Memory')).toHaveLength(2);
    expect(screen.getAllByText('GPU')).toHaveLength(2);
  });

  it('renders summary card values aggregated across nodes', async () => {
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources')).toBeInTheDocument();
    });

    // CPU available: 8 + 2 = 10
    expect(screen.getByText('10 cores')).toBeInTheDocument();
    // Memory available: 32 + 4 = 36
    expect(screen.getByText('36 Gi')).toBeInTheDocument();
  });

  it('renders node table with correct data', async () => {
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('node-1')).toBeInTheDocument();
    });

    expect(screen.getByText('node-2')).toBeInTheDocument();
    // Check table headers
    expect(screen.getByText('Node')).toBeInTheDocument();
  });

  it('renders utilization badges with correct status', async () => {
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('node-1')).toBeInTheDocument();
    });

    // node-1 CPU: 8/16 = 50% -> healthy
    const badges = screen.getAllByText('50%');
    expect(badges[0]).toHaveAttribute('data-status', 'healthy');

    // node-2 CPU: 14/16 = 88% -> warning
    const warningBadges = screen.getAllByText('88%');
    expect(warningBadges[0]).toHaveAttribute('data-status', 'warning');

    // node-2 memory: 60/64 = 94% -> critical
    const criticalBadges = screen.getAllByText('94%');
    expect(criticalBadges[0]).toHaveAttribute('data-status', 'critical');
  });

  it('renders empty state when no nodes', async () => {
    service = createMockService(emptyResources);
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'No node-level data available. Resource discovery is using a static provider.'
        )
      ).toBeInTheDocument();
    });
  });

  it('refresh button triggers re-fetch', async () => {
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources')).toBeInTheDocument();
    });

    expect(service.getClusterResources).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(service.getClusterResources).toHaveBeenCalledTimes(2);
    });
  });

  it('applies correct data-category attributes to summary cards', async () => {
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources')).toBeInTheDocument();
    });

    const cpuElements = screen.getAllByText('CPU');
    const cpuCard = cpuElements[0].closest('[data-category]');
    expect(cpuCard).toHaveAttribute('data-category', 'compute');

    const gpuElements = screen.getAllByText('GPU');
    const gpuCard = gpuElements[0].closest('[data-category]');
    expect(gpuCard).toHaveAttribute('data-category', 'accelerator');
  });

  it('handles nodes with unparseable resource values gracefully', async () => {
    const badResources: ClusterResourceInfo = {
      resourceTypes: [
        {
          name: 'cpu',
          resourceKey: 'cpu',
          displayName: 'CPU',
          unit: 'cores',
          category: 'compute',
        },
      ],
      nodes: [
        {
          name: 'bad-node',
          labels: {},
          allocatable: { cpu: 'not-a-number' },
          allocated: { cpu: 'also-bad' },
          available: { cpu: 'nope' },
        },
      ],
    };

    service = createMockService(badResources);
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('bad-node')).toBeInTheDocument();
    });
  });

  it('handles nodes with missing resource keys using defaults', async () => {
    const sparseResources: ClusterResourceInfo = {
      resourceTypes: [
        {
          name: 'cpu',
          resourceKey: 'cpu',
          displayName: 'CPU',
          unit: 'cores',
          category: 'compute',
        },
        {
          name: 'gpu',
          resourceKey: 'nvidia.com/gpu',
          displayName: 'GPU',
          unit: 'devices',
          category: 'accelerator',
        },
      ],
      nodes: [
        {
          name: 'sparse-node',
          labels: {},
          allocatable: { cpu: '8' },
          allocated: { cpu: '4' },
          available: { cpu: '4' },
        },
      ],
    };

    service = createMockService(sparseResources);
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('sparse-node')).toBeInTheDocument();
    });

    // GPU should show 0/0 with 0% utilization (calculateUtilization with total=0)
    const zeroBadges = screen.getAllByText('0%');
    expect(zeroBadges.length).toBeGreaterThan(0);
  });

  it('renders resources with bytes unit formatted correctly in summary', async () => {
    const bytesResources: ClusterResourceInfo = {
      resourceTypes: [
        {
          name: 'memory',
          resourceKey: 'memory',
          displayName: 'Memory',
          unit: 'bytes',
          category: 'compute',
        },
      ],
      nodes: [
        {
          name: 'mem-node',
          labels: {},
          allocatable: { memory: '8Gi' },
          allocated: { memory: '4Gi' },
          available: { memory: '4Gi' },
        },
      ],
    };

    service = createMockService(bytesResources);
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('mem-node')).toBeInTheDocument();
    });

    // bytes unit: summary card shows formatted bytes without unit suffix
    // Available 4Gi = 4.0 GiB
    expect(screen.getByText('4.0 GiB')).toBeInTheDocument();
  });

  it('renders 0% utilization when allocatable is zero', async () => {
    const zeroResources: ClusterResourceInfo = {
      resourceTypes: [
        {
          name: 'gpu',
          resourceKey: 'nvidia.com/gpu',
          displayName: 'GPU',
          unit: 'devices',
          category: 'accelerator',
        },
      ],
      nodes: [
        {
          name: 'no-gpu-node',
          labels: {},
          allocatable: { 'nvidia.com/gpu': '0' },
          allocated: { 'nvidia.com/gpu': '0' },
          available: { 'nvidia.com/gpu': '0' },
        },
      ],
    };

    service = createMockService(zeroResources);
    mockServiceRef.current = service;
    render(<ResourcesSection />);

    await waitFor(() => {
      expect(screen.getByText('no-gpu-node')).toBeInTheDocument();
    });

    // 0/0 = 0% utilization
    expect(screen.getByText('0%')).toHaveAttribute('data-status', 'healthy');
  });
});
