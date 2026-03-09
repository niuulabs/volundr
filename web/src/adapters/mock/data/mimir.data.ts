import type { MimirStats, MimirConsultation } from '@/models';

export const mockMimirStats: MimirStats = {
  totalConsultations: 847,
  consultationsToday: 12,
  tokensUsedToday: 45230,
  tokensUsedMonth: 1247890,
  costToday: 0.68,
  costMonth: 18.72,
  avgResponseTime: 2.3,
  model: 'claude-sonnet-4-20250514',
};

export const mockMimirConsultations: MimirConsultation[] = [
  {
    id: 'mimir-001',
    time: '10:20',
    requester: 'Odin',
    topic: 'Kubernetes HPA tuning',
    query:
      'What are the best practices for tuning Horizontal Pod Autoscaler for a memory-intensive analytics workload that has bursty traffic patterns?',
    response:
      'For memory-intensive workloads with bursty traffic, consider: 1) Use memory-based scaling with stabilizationWindowSeconds of 300s to prevent thrashing. 2) Set behavior.scaleDown.policies with a percent-based policy limiting scale-down to 10% per minute. 3) Consider using KEDA with Prometheus metrics for more granular control...',
    tokensIn: 89,
    tokensOut: 423,
    latency: 2.1,
    useful: true,
  },
  {
    id: 'mimir-002',
    time: '09:45',
    requester: 'Tyr',
    topic: 'Git merge strategy',
    query:
      'When coordinating changes across 4 repositories with circular dependencies, what merge order minimizes CI failures?',
    response:
      'For circular dependencies across repos: 1) Identify the "interface" repo that defines shared contracts—merge this first. 2) Use feature flags or version negotiation to allow temporary incompatibility. 3) Consider a monorepo approach for tightly coupled repos. 4) If separate repos are required, use a dependency graph to find the minimum spanning tree...',
    tokensIn: 67,
    tokensOut: 512,
    latency: 2.8,
    useful: true,
  },
  {
    id: 'mimir-003',
    time: '08:30',
    requester: 'Odin',
    topic: 'ZFS tuning',
    query:
      'What recordsize should I use for a ZFS dataset storing large video files (1-10GB each) that are written once and read sequentially?',
    response:
      'For large sequential files written once: Set recordsize=1M (the maximum). This reduces metadata overhead and improves sequential read throughput. Also consider: compression=lz4 (fast, low CPU), atime=off, primarycache=metadata if files are larger than ARC...',
    tokensIn: 56,
    tokensOut: 287,
    latency: 1.9,
    useful: true,
  },
];
