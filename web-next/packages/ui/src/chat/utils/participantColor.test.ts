import {
  resolveParticipantColor,
  participantSlot,
  PARTICIPANT_SLOT_COUNT,
} from './participantColor';

describe('PARTICIPANT_SLOT_COUNT', () => {
  it('equals 7', () => {
    expect(PARTICIPANT_SLOT_COUNT).toBe(7);
  });
});

describe('resolveParticipantColor', () => {
  it('resolves p1 to the correct CSS variable', () => {
    expect(resolveParticipantColor('p1')).toBe('var(--color-participant-1)');
  });

  it('resolves p7 to the correct CSS variable', () => {
    expect(resolveParticipantColor('p7')).toBe('var(--color-participant-7)');
  });

  it('resolves all known slots p1–p7', () => {
    for (let i = 1; i <= 7; i++) {
      expect(resolveParticipantColor(`p${i}`)).toBe(`var(--color-participant-${i})`);
    }
  });

  it('falls back to --color-text-secondary for unknown slot', () => {
    expect(resolveParticipantColor('p8')).toBe('var(--color-text-secondary)');
  });

  it('falls back for empty string', () => {
    expect(resolveParticipantColor('')).toBe('var(--color-text-secondary)');
  });

  it('falls back for arbitrary unknown string', () => {
    expect(resolveParticipantColor('blue')).toBe('var(--color-text-secondary)');
  });
});

describe('participantSlot', () => {
  it('index 0 maps to p1', () => {
    expect(participantSlot(0)).toBe('p1');
  });

  it('index 6 maps to p7', () => {
    expect(participantSlot(6)).toBe('p7');
  });

  it('index 7 wraps back to p1', () => {
    expect(participantSlot(7)).toBe('p1');
  });

  it('index 13 wraps correctly (13 % 7 = 6 → p7)', () => {
    expect(participantSlot(13)).toBe('p7');
  });

  it('index 14 wraps correctly (14 % 7 = 0 → p1)', () => {
    expect(participantSlot(14)).toBe('p1');
  });
});
