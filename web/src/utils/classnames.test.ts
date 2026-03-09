import { describe, it, expect } from 'vitest';
import { cn } from './classnames';

describe('cn', () => {
  it('joins multiple class names with spaces', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
  });

  it('filters out false values', () => {
    expect(cn('foo', false, 'bar')).toBe('foo bar');
  });

  it('filters out null values', () => {
    expect(cn('foo', null, 'bar')).toBe('foo bar');
  });

  it('filters out undefined values', () => {
    expect(cn('foo', undefined, 'bar')).toBe('foo bar');
  });

  it('filters out empty strings', () => {
    expect(cn('foo', '', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn('button', isActive && 'active', isDisabled && 'disabled')).toBe('button active');
  });

  it('returns empty string when all values are falsy', () => {
    expect(cn(false, null, undefined, '')).toBe('');
  });

  it('returns empty string when no arguments', () => {
    expect(cn()).toBe('');
  });

  it('handles single class name', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('handles mixed truthy and falsy values', () => {
    expect(cn('a', false, 'b', null, 'c', undefined, 'd')).toBe('a b c d');
  });
});
