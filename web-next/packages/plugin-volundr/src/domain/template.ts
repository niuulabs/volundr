import type { PodMount, ResourceSpec } from './pod';

/** A reusable pod configuration that sessions are stamped from. */
export interface Template {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly image: string;
  readonly mounts: readonly PodMount[];
  readonly env: Readonly<Record<string, string>>;
  /** Tool IDs from Ravn's registry that sessions may expose. */
  readonly tools: readonly string[];
  readonly resources: ResourceSpec;
  /** Maximum session lifetime in seconds (hard cutoff). */
  readonly ttlSec: number;
  /** Seconds of inactivity before auto-termination. */
  readonly idleTimeoutSec: number;
  /** Cluster IDs this template prefers; empty = any cluster. */
  readonly clusterAffinity: readonly string[];
}
