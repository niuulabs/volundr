/** Format cents to "$X.XX" or "$X.Xk" */
export function money(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${d.toFixed(2)}`;
}

/** Format token count: raw, Xk, or X.XXM */
export function tokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${n}`;
}

/** Format timestamp to "3m ago" style relative time */
export function relTime(ts: number): string {
  if (!ts) return '—';
  const d = Math.max(0, Date.now() - ts);
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
