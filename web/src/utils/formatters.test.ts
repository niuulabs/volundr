import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatBytes,
  formatNumber,
  formatTokens,
  formatPercent,
  formatStorage,
  formatRelativeTime,
  formatUptime,
  formatTime,
  formatResourcePair,
} from './formatters';

describe('formatters', () => {
  describe('formatBytes', () => {
    it('returns "0 B" for zero', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1_048_576)).toBe('1.0 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1_073_741_824)).toBe('1.0 GB');
    });

    it('formats terabytes', () => {
      expect(formatBytes(2_000_000_000_000)).toBe('1.8 TB');
    });

    it('uses one decimal place for values under 10', () => {
      expect(formatBytes(5_000_000_000)).toBe('4.7 GB');
    });

    it('uses zero decimal places for values 10 and over', () => {
      expect(formatBytes(15_000_000_000)).toBe('14 GB');
    });
  });

  describe('formatNumber', () => {
    it('formats millions with M suffix', () => {
      expect(formatNumber(1_000_000)).toBe('1.0M');
      expect(formatNumber(1_234_567)).toBe('1.2M');
      expect(formatNumber(12_345_678)).toBe('12.3M');
    });

    it('formats thousands with K suffix', () => {
      expect(formatNumber(1_000)).toBe('1.0K');
      expect(formatNumber(1_234)).toBe('1.2K');
      expect(formatNumber(12_345)).toBe('12.3K');
      expect(formatNumber(999_999)).toBe('1000.0K');
    });

    it('returns plain number for values under 1000', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(999)).toBe('999');
    });
  });

  describe('formatTokens', () => {
    it('formats millions with M suffix', () => {
      expect(formatTokens(1_000_000)).toBe('1.0M');
      expect(formatTokens(1_247_890)).toBe('1.2M');
    });

    it('formats thousands with lowercase k suffix (token convention)', () => {
      expect(formatTokens(1_000)).toBe('1.0k');
      expect(formatTokens(156_420)).toBe('156.4k');
      expect(formatTokens(45_230)).toBe('45.2k');
    });

    it('returns plain number for values under 1000', () => {
      expect(formatTokens(0)).toBe('0');
      expect(formatTokens(89)).toBe('89');
      expect(formatTokens(999)).toBe('999');
    });
  });

  describe('formatPercent', () => {
    it('converts decimal to percentage', () => {
      expect(formatPercent(0)).toBe('0%');
      expect(formatPercent(0.5)).toBe('50%');
      expect(formatPercent(1)).toBe('100%');
    });

    it('rounds to nearest integer', () => {
      expect(formatPercent(0.823)).toBe('82%');
      expect(formatPercent(0.826)).toBe('83%');
      expect(formatPercent(0.334)).toBe('33%');
    });
  });

  describe('formatStorage', () => {
    it('formats storage with units', () => {
      expect(formatStorage(2.1, 3.8, 'TB')).toBe('2.1/3.8 TB');
      expect(formatStorage(0.8, 1.0, 'TB')).toBe('0.8/1 TB');
      expect(formatStorage(48, 128, 'GB')).toBe('48/128 GB');
    });
  });

  describe('formatResourcePair', () => {
    it('formats with bytes unit using human-readable sizes', () => {
      expect(formatResourcePair(1073741824, 2147483648, 'bytes')).toContain('GB');
    });

    it('formats with non-bytes unit as plain values', () => {
      expect(formatResourcePair(128, 256, 'GiB')).toBe('128/256 GiB');
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-23T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "just now" for recent times', () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe('just now');
      expect(formatRelativeTime(now - 30_000)).toBe('just now'); // 30 seconds
    });

    it('formats minutes', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 60_000)).toBe('1m ago');
      expect(formatRelativeTime(now - 300_000)).toBe('5m ago');
      expect(formatRelativeTime(now - 3_540_000)).toBe('59m ago');
    });

    it('formats hours', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 3_600_000)).toBe('1h ago');
      expect(formatRelativeTime(now - 7_200_000)).toBe('2h ago');
      expect(formatRelativeTime(now - 82_800_000)).toBe('23h ago');
    });

    it('formats days', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 86_400_000)).toBe('1d ago');
      expect(formatRelativeTime(now - 172_800_000)).toBe('2d ago');
      expect(formatRelativeTime(now - 604_800_000)).toBe('7d ago');
    });

    it('accepts Date objects', () => {
      const now = Date.now();
      const date = new Date(now - 3_600_000);
      expect(formatRelativeTime(date)).toBe('1h ago');
    });
  });

  describe('formatUptime', () => {
    it('formats with days when > 24 hours', () => {
      // 14 days, 7 hours, 23 minutes, 41 seconds
      const ms = (14 * 24 * 60 * 60 + 7 * 60 * 60 + 23 * 60 + 41) * 1000;
      expect(formatUptime(ms)).toBe('14d 07:23:41');
    });

    it('formats without days when < 24 hours', () => {
      // 7 hours, 23 minutes, 41 seconds
      const ms = (7 * 60 * 60 + 23 * 60 + 41) * 1000;
      expect(formatUptime(ms)).toBe('07:23:41');
    });

    it('pads single digits with zeros', () => {
      const ms = (1 * 60 * 60 + 5 * 60 + 9) * 1000;
      expect(formatUptime(ms)).toBe('01:05:09');
    });

    it('handles zero', () => {
      expect(formatUptime(0)).toBe('00:00:00');
    });

    it('handles exactly 1 day', () => {
      const ms = 24 * 60 * 60 * 1000;
      expect(formatUptime(ms)).toBe('1d 00:00:00');
    });
  });

  describe('formatTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-23T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "now" for recent times', () => {
      const now = Date.now();
      expect(formatTime(now)).toBe('now');
      expect(formatTime(now - 30_000)).toBe('now'); // 30 seconds
      expect(formatTime(now - 59_999)).toBe('now'); // just under 1 minute
    });

    it('formats minutes without "ago"', () => {
      const now = Date.now();
      expect(formatTime(now - 60_000)).toBe('1m');
      expect(formatTime(now - 300_000)).toBe('5m');
      expect(formatTime(now - 3_540_000)).toBe('59m');
    });

    it('formats hours without "ago"', () => {
      const now = Date.now();
      expect(formatTime(now - 3_600_000)).toBe('1h');
      expect(formatTime(now - 7_200_000)).toBe('2h');
      expect(formatTime(now - 82_800_000)).toBe('23h');
    });

    it('formats days without "ago"', () => {
      const now = Date.now();
      expect(formatTime(now - 86_400_000)).toBe('1d');
      expect(formatTime(now - 172_800_000)).toBe('2d');
      expect(formatTime(now - 604_800_000)).toBe('7d');
    });
  });
});
