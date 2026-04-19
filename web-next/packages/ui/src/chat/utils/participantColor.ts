export const PARTICIPANT_SLOT_COUNT = 7;

export const PARTICIPANT_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Array.from({ length: PARTICIPANT_SLOT_COUNT }, (_, i) => [
    `p${i + 1}`,
    `var(--color-participant-${i + 1})`,
  ])
);

export function resolveParticipantColor(color: string): string {
  return PARTICIPANT_COLOR_MAP[color] ?? 'var(--color-text-secondary)';
}

export function participantSlot(index: number): string {
  return `p${(index % PARTICIPANT_SLOT_COUNT) + 1}`;
}
