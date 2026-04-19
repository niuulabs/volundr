/**
 * Port for live metrics streaming (CPU / memory / GPU).
 *
 * Implementations may pull from Prometheus, the k8s metrics API, etc.
 */

export interface SessionMetrics {
  readonly sessionId: string;
  readonly timestamp: number;
  /** CPU usage in millicores. */
  readonly cpuMillicores: number;
  /** Memory usage in MiB. */
  readonly memMi: number;
  /** GPU utilisation as a fraction 0–1. */
  readonly gpuUtilisation: number;
}

export interface IMetricsStream {
  /**
   * Subscribe to metrics for the given session.
   * Implementations should emit on every scrape interval.
   * @returns Unsubscribe function — must be called on unmount.
   */
  subscribe(sessionId: string, callback: (metrics: SessionMetrics) => void): () => void;

  /** Stop ALL active subscriptions (e.g. on page unmount). */
  unsubscribeAll(): void;
}
