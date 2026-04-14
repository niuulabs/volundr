import { describe, it, expect } from 'vitest';
import { resolveParticipantColor, PARTICIPANT_COLOR_MAP } from './participantColor';

describe('resolveParticipantColor', () => {
  it('resolves known colors to CSS vars', () => {
    expect(resolveParticipantColor('amber')).toBe('var(--color-accent-amber)');
    expect(resolveParticipantColor('cyan')).toBe('var(--color-accent-cyan)');
    expect(resolveParticipantColor('emerald')).toBe('var(--color-accent-emerald)');
    expect(resolveParticipantColor('purple')).toBe('var(--color-accent-purple)');
    expect(resolveParticipantColor('red')).toBe('var(--color-accent-red)');
    expect(resolveParticipantColor('indigo')).toBe('var(--color-accent-indigo)');
    expect(resolveParticipantColor('orange')).toBe('var(--color-accent-orange)');
  });

  it('falls back to secondary text color for unknown colors', () => {
    expect(resolveParticipantColor('unknown')).toBe('var(--color-text-secondary)');
    expect(resolveParticipantColor('')).toBe('var(--color-text-secondary)');
  });

  it('PARTICIPANT_COLOR_MAP contains all expected keys', () => {
    const keys = Object.keys(PARTICIPANT_COLOR_MAP);
    expect(keys).toContain('amber');
    expect(keys).toContain('cyan');
    expect(keys).toContain('emerald');
    expect(keys).toContain('purple');
    expect(keys).toContain('red');
    expect(keys).toContain('indigo');
    expect(keys).toContain('orange');
  });
});
