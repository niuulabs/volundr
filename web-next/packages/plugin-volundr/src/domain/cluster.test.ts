import { describe, it, expect } from 'vitest';
import {
  availableCapacity,
  isClusterHealthy,
  nodeStatusCounts,
  type Cluster,
} from './cluster';

const BASE_CLUSTER: Cluster = {
  id: 'c1',
  realm: 'test',
  name: 'Test Cluster',
  capacity: { cpu: 100, memMi: 204800, gpu: 8 },
  used: { cpu: 40, memMi: 81920, gpu: 2 },
  nodes: [
    { id: 'n1', status: 'ready', role: 'worker' },
    { id: 'n2', status: 'ready', role: 'worker' },
    { id: 'n3', status: 'cordoned', role: 'worker' },
  ],
  runningSessions: 3,
  queuedProvisions: 1,
};

describe('availableCapacity', () => {
  it('subtracts used from capacity', () => {
    const avail = availableCapacity(BASE_CLUSTER);
    expect(avail.cpu).toBe(60);
    expect(avail.memMi).toBe(122880);
    expect(avail.gpu).toBe(6);
  });

  it('returns zero capacity when fully used', () => {
    const full: Cluster = {
      ...BASE_CLUSTER,
      capacity: { cpu: 50, memMi: 1024, gpu: 2 },
      used: { cpu: 50, memMi: 1024, gpu: 2 },
    };
    const avail = availableCapacity(full);
    expect(avail.cpu).toBe(0);
    expect(avail.memMi).toBe(0);
    expect(avail.gpu).toBe(0);
  });

  it('can return negative when over-provisioned', () => {
    const over: Cluster = {
      ...BASE_CLUSTER,
      capacity: { cpu: 10, memMi: 100, gpu: 0 },
      used: { cpu: 15, memMi: 200, gpu: 0 },
    };
    const avail = availableCapacity(over);
    expect(avail.cpu).toBe(-5);
    expect(avail.memMi).toBe(-100);
    expect(avail.gpu).toBe(0);
  });
});

describe('isClusterHealthy', () => {
  it('returns true when at least one node is ready', () => {
    expect(isClusterHealthy(BASE_CLUSTER)).toBe(true);
  });

  it('returns false when no nodes are ready', () => {
    const unhealthy: Cluster = {
      ...BASE_CLUSTER,
      nodes: [
        { id: 'n1', status: 'notready', role: 'worker' },
        { id: 'n2', status: 'cordoned', role: 'worker' },
      ],
    };
    expect(isClusterHealthy(unhealthy)).toBe(false);
  });

  it('returns false for an empty cluster', () => {
    const empty: Cluster = { ...BASE_CLUSTER, nodes: [] };
    expect(isClusterHealthy(empty)).toBe(false);
  });
});

describe('nodeStatusCounts', () => {
  it('counts nodes by status correctly', () => {
    const counts = nodeStatusCounts(BASE_CLUSTER);
    expect(counts.ready).toBe(2);
    expect(counts.notready).toBe(0);
    expect(counts.cordoned).toBe(1);
  });

  it('returns all-zero counts for an empty cluster', () => {
    const empty: Cluster = { ...BASE_CLUSTER, nodes: [] };
    const counts = nodeStatusCounts(empty);
    expect(counts.ready).toBe(0);
    expect(counts.notready).toBe(0);
    expect(counts.cordoned).toBe(0);
  });

  it('handles all-notready clusters', () => {
    const cluster: Cluster = {
      ...BASE_CLUSTER,
      nodes: [
        { id: 'n1', status: 'notready', role: 'worker' },
        { id: 'n2', status: 'notready', role: 'master' },
      ],
    };
    const counts = nodeStatusCounts(cluster);
    expect(counts.notready).toBe(2);
    expect(counts.ready).toBe(0);
  });
});
