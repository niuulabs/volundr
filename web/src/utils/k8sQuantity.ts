/**
 * Kubernetes quantity parsing and formatting utilities.
 *
 * Handles SI (K, M, G ...) and binary (Ki, Mi, Gi ...) suffixes as well as
 * CPU millicore notation (e.g. "500m" = 0.5 cores).
 */

export const BYTE_MULTIPLIERS: Record<string, number> = {
  '': 1,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};

/**
 * Parse a Kubernetes quantity string into a canonical numeric value.
 * - bytes unit: "8Gi" -> bytes, "500Mi" -> bytes, "8024304Ki" -> bytes
 * - cores unit: "4" -> 4, "500m" -> 0.5, "1.5" -> 1.5
 * - other: plain parseFloat
 * Returns NaN if the string is not a valid quantity.
 */
export function parseK8sQuantity(raw: string, unit: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return NaN;

  if (unit === 'bytes') {
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]i?)?$/);
    if (!match) return NaN;
    const num = parseFloat(match[1]);
    const suffix = match[2] ?? '';
    if (!(suffix in BYTE_MULTIPLIERS)) return NaN;
    return num * BYTE_MULTIPLIERS[suffix];
  }

  if (unit === 'cores') {
    // CPU supports millicores (e.g. "500m" = 0.5 cores) or plain numbers
    const milliMatch = trimmed.match(/^(\d+)m$/);
    if (milliMatch) return parseInt(milliMatch[1], 10) / 1000;
    const num = parseFloat(trimmed);
    if (isNaN(num) || num < 0) return NaN;
    return num;
  }

  // Generic: plain number
  const num = parseFloat(trimmed);
  if (isNaN(num) || num < 0) return NaN;
  return num;
}

/**
 * Format a byte count into a human-readable binary-unit string.
 * @example formatHumanBytes(1073741824) => "1.0 GiB"
 */
export function formatHumanBytes(bytes: number): string {
  if (bytes >= 1024 ** 5) return `${(bytes / 1024 ** 5).toFixed(1)} PiB`;
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TiB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/**
 * Format a resource value for display, handling byte conversion automatically.
 * For bytes: parses K8s quantity string and formats as human-readable binary units.
 * For other units: returns the number, with one decimal place if non-integer.
 */
export function formatResourceValue(value: number | string, unit: string): string {
  const raw = String(value);
  if (unit === 'bytes') {
    const bytes = parseK8sQuantity(raw, 'bytes');
    if (isNaN(bytes)) return raw;
    return formatHumanBytes(bytes);
  }
  const num = parseFloat(raw) || 0;
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(1);
}
