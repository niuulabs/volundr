import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ResourcesSection } from './ResourcesSection';
import type { IVolundrService } from '@/ports';
import type { ClusterResourceInfo } from '@/models';

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
  });

  it('renders loading state initially', () => {
    service = {
      getClusterResources: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as IVolundrService;

    render(<ResourcesSection service={service} />);
    expect(screen.getByText('Loading cluster resources...')).toBeInTheDocument();
  });

  it('renders summary cards for each resource type', async () => {
    render(<ResourcesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources')).toBeInTheDocument();
    });

    // Each resource type appears in both summary card and table header
    expect(screen.getAllByText('CPU')).toHaveLength(2);
    expect(screen.getAllByText('Memory')).toHaveLength(2);
    expect(screen.getAllByText('GPU')).toHaveLength(2);
  });

  it('renders summary card values aggregated across nodes', async () => {
    render(<ResourcesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('Cluster Resources')).toBeInTheDocument();
    });

    // CPU available: 8 + 2 = 10
    expect(screen.getByText('10 cores')).toBeInTheDocument();
    // Memory available: 32 + 4 = 36
    expect(screen.getByText('36 Gi')).toBeInTheDocument();
  });

  it('renders node table with correct data', async () => {
    render(<ResourcesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('node-1')).toBeInTheDocument();
    });

    expect(screen.getByText('node-2')).toBeInTheDocument();
    // Check table headers
    expect(screen.getByText('Node')).toBeInTheDocument();
  });

  it('renders utilization badges with correct status', async () => {
    render(<ResourcesSection service={service} />);

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
    render(<ResourcesSection service={service} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'No node-level data available. Resource discovery is using a static provider.'
        )
      ).toBeInTheDocument();
    });
  });

  it('refresh button triggers re-fetch', async () => {
    render(<ResourcesSection service={service} />);

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
    render(<ResourcesSection service={service} />);

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
});
