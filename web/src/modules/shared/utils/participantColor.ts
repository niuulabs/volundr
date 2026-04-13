export const PARTICIPANT_COLOR_MAP: Record<string, string> = {
  amber: 'var(--color-accent-amber)',
  cyan: 'var(--color-accent-cyan)',
  emerald: 'var(--color-accent-emerald)',
  purple: 'var(--color-accent-purple)',
  red: 'var(--color-accent-red)',
  indigo: 'var(--color-accent-indigo)',
  orange: 'var(--color-accent-orange)',
};

export function resolveParticipantColor(color: string): string {
  return PARTICIPANT_COLOR_MAP[color] ?? 'var(--color-text-secondary)';
}
