/** Maximum resource allocation for a raven / persona / realm. */
export interface Quota {
  readonly maxCpu: number;
  readonly maxMemMi: number;
  readonly maxGpu: number;
  readonly maxSessions: number;
}

/** Current resource usage to compare against a quota. */
export interface QuotaUsage {
  readonly cpu: number;
  readonly memMi: number;
  readonly gpu: number;
  readonly sessions: number;
}

/** Returns true when every usage dimension is within the quota. */
export function isWithinQuota(quota: Quota, usage: QuotaUsage): boolean {
  return (
    usage.cpu <= quota.maxCpu &&
    usage.memMi <= quota.maxMemMi &&
    usage.gpu <= quota.maxGpu &&
    usage.sessions <= quota.maxSessions
  );
}

/** Returns how much of the quota is still available. Negative values mean over-quota. */
export function remainingQuota(quota: Quota, usage: QuotaUsage): QuotaUsage {
  return {
    cpu: quota.maxCpu - usage.cpu,
    memMi: quota.maxMemMi - usage.memMi,
    gpu: quota.maxGpu - usage.gpu,
    sessions: quota.maxSessions - usage.sessions,
  };
}

/** Returns true when the usage exceeds ANY quota dimension. */
export function isOverQuota(quota: Quota, usage: QuotaUsage): boolean {
  return !isWithinQuota(quota, usage);
}
