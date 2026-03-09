/**
 * Format byte counts into human-readable units (B, KB, MB, GB, TB, PB)
 * @example formatBytes(2_000_000_000_000) => "1.8 TB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format a resource pair (used/total) with its unit, handling byte conversion.
 * When unit is "bytes", converts to human-readable sizes; otherwise passes through.
 * @example formatResourcePair(128, 256, 'GiB') => "128/256 GiB"
 * @example formatResourcePair(138423566336, 138423566336, 'bytes') => "129 GB/129 GB"
 */
export function formatResourcePair(used: number, total: number, unit: string): string {
  if (unit === 'bytes') {
    return `${formatBytes(used)} / ${formatBytes(total)}`;
  }
  return `${used}/${total} ${unit}`;
}

/**
 * Format large numbers with K/M suffixes
 * @example formatNumber(1234567) => "1.2M"
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Format token counts (lowercase k for tokens convention)
 * @example formatTokens(156420) => "156.4k"
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toString();
}

/**
 * Format a decimal (0-1) as percentage
 * @example formatPercent(0.823) => "82%"
 */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Format storage values with units
 * @example formatStorage(2.1, 3.8, 'TB') => "2.1/3.8 TB"
 */
export function formatStorage(used: number, total: number, unit: string): string {
  return `${used}/${total} ${unit}`;
}

/**
 * Format relative time from timestamp
 * @example formatRelativeTime(Date.now() - 3600000) => "1h ago"
 */
export function formatRelativeTime(timestamp: number | Date): string {
  const now = Date.now();
  const time = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  const diff = now - time;

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return 'just now';
}

/**
 * Format uptime duration
 * @example formatUptime(1234567890) => "14d 07:23:41"
 */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const h = hours % 24;
  const m = minutes % 60;
  const s = seconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (days > 0) {
    return `${days}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Format time since timestamp (compact format without "ago")
 * @example formatTime(Date.now() - 300000) => "5m"
 */
export function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;

  if (diff < 60_000) {
    return 'now';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h`;
  }
  return `${Math.floor(diff / 86_400_000)}d`;
}
