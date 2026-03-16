import { describe, it, expect } from 'vitest';
import { validateSessionName } from './sessionName';

describe('validateSessionName', () => {
  it('returns null for valid names', () => {
    expect(validateSessionName('my-session')).toBeNull();
    expect(validateSessionName('fix-auth-bug')).toBeNull();
    expect(validateSessionName('a')).toBeNull();
    expect(validateSessionName('session123')).toBeNull();
    expect(validateSessionName('a'.repeat(63))).toBeNull();
  });

  it('returns null for empty string (handled by required)', () => {
    expect(validateSessionName('')).toBeNull();
  });

  it('rejects names over 63 characters', () => {
    const result = validateSessionName('a'.repeat(64));
    expect(result).toContain('63 characters');
  });

  it('rejects uppercase characters with suggestion', () => {
    const result = validateSessionName('MySession');
    expect(result).toContain('lowercase');
    expect(result).toContain('mysession');
  });

  it('rejects spaces', () => {
    const result = validateSessionName('my session');
    expect(result).toContain('Spaces');
    expect(result).toContain('hyphens');
  });

  it('rejects leading hyphen', () => {
    const result = validateSessionName('-my-session');
    expect(result).toContain('start with');
  });

  it('rejects trailing hyphen', () => {
    const result = validateSessionName('my-session-');
    expect(result).toContain('end with');
  });

  it('rejects special characters and names them', () => {
    const result = validateSessionName('my_session');
    expect(result).toContain('"_"');
  });

  it('rejects dots', () => {
    const result = validateSessionName('my.session');
    expect(result).toContain('"."');
  });
});
