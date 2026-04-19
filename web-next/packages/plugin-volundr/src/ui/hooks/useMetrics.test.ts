import { describe, it, expect } from 'vitest';
import { binMetricValues } from './useMetrics';
import type { MetricPoint } from '../../ports/IMetricsStream';

function makePoints(cpus: number[]): MetricPoint[] {
  return cpus.map((cpu, i) => ({ timestamp: i * 1000, cpu, memMi: cpu * 100, gpu: 0 }));
}

describe('binMetricValues', () => {
  it('returns all zeros for empty points', () => {
    const result = binMetricValues([], (p) => p.cpu, 5);
    expect(result).toHaveLength(5);
    expect(result.every((v) => v === 0)).toBe(true);
  });

  it('returns bucketCount buckets', () => {
    const points = makePoints([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const result = binMetricValues(points, (p) => p.cpu, 3);
    expect(result).toHaveLength(3);
  });

  it('averages values within each bucket', () => {
    // 4 points, 2 buckets → each bucket has 2 points
    const points = makePoints([0.0, 1.0, 0.5, 0.5]);
    const result = binMetricValues(points, (p) => p.cpu, 2);
    expect(result[0]).toBeCloseTo(0.5, 5); // (0.0 + 1.0) / 2
    expect(result[1]).toBeCloseTo(0.5, 5); // (0.5 + 0.5) / 2
  });

  it('handles a single point with bucketCount > 1', () => {
    const points = makePoints([0.42]);
    const result = binMetricValues(points, (p) => p.cpu, 4);
    expect(result).toHaveLength(4);
    expect(result[0]).toBeCloseTo(0.42, 5);
    // Remaining buckets have no data → 0
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(0);
  });

  it('works with memMi accessor', () => {
    const points = makePoints([0.5, 0.5]);
    const result = binMetricValues(points, (p) => p.memMi, 1);
    // memMi = cpu * 100 = 50
    expect(result[0]).toBeCloseTo(50, 1);
  });

  it('returns a single bucket equal to average of all points', () => {
    const points = makePoints([0.2, 0.4, 0.6]);
    const result = binMetricValues(points, (p) => p.cpu, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(0.4, 5);
  });
});
