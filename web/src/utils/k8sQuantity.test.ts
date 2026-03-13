import { describe, it, expect } from 'vitest';
import {
  parseK8sQuantity,
  formatHumanBytes,
  formatResourceValue,
  BYTE_MULTIPLIERS,
} from './k8sQuantity';

describe('BYTE_MULTIPLIERS', () => {
  it('contains SI and binary suffixes', () => {
    expect(BYTE_MULTIPLIERS['K']).toBe(1e3);
    expect(BYTE_MULTIPLIERS['Ki']).toBe(1024);
    expect(BYTE_MULTIPLIERS['Gi']).toBe(1024 ** 3);
    expect(BYTE_MULTIPLIERS['']).toBe(1);
  });
});

describe('parseK8sQuantity', () => {
  describe('bytes unit', () => {
    it('parses plain bytes', () => {
      expect(parseK8sQuantity('1024', 'bytes')).toBe(1024);
    });
    it('parses Ki suffix', () => {
      expect(parseK8sQuantity('8Ki', 'bytes')).toBe(8 * 1024);
    });
    it('parses Mi suffix', () => {
      expect(parseK8sQuantity('512Mi', 'bytes')).toBe(512 * 1024 ** 2);
    });
    it('parses Gi suffix', () => {
      expect(parseK8sQuantity('4Gi', 'bytes')).toBe(4 * 1024 ** 3);
    });
    it('parses SI suffix G', () => {
      expect(parseK8sQuantity('2G', 'bytes')).toBe(2e9);
    });
    it('returns NaN for invalid byte string', () => {
      expect(parseK8sQuantity('abc', 'bytes')).toBeNaN();
    });
    it('returns NaN for empty string', () => {
      expect(parseK8sQuantity('', 'bytes')).toBeNaN();
    });
    it('returns NaN for unknown suffix', () => {
      expect(parseK8sQuantity('8Xi', 'bytes')).toBeNaN();
    });
    it('handles whitespace', () => {
      expect(parseK8sQuantity('  4Gi  ', 'bytes')).toBe(4 * 1024 ** 3);
    });
    it('parses decimal bytes', () => {
      expect(parseK8sQuantity('1.5Gi', 'bytes')).toBe(1.5 * 1024 ** 3);
    });
  });

  describe('cores unit', () => {
    it('parses plain number', () => {
      expect(parseK8sQuantity('4', 'cores')).toBe(4);
    });
    it('parses millicores', () => {
      expect(parseK8sQuantity('500m', 'cores')).toBe(0.5);
    });
    it('parses decimal cores', () => {
      expect(parseK8sQuantity('1.5', 'cores')).toBe(1.5);
    });
    it('returns NaN for negative cores', () => {
      expect(parseK8sQuantity('-1', 'cores')).toBeNaN();
    });
    it('returns NaN for non-numeric', () => {
      expect(parseK8sQuantity('abc', 'cores')).toBeNaN();
    });
  });

  describe('generic unit', () => {
    it('parses plain number', () => {
      expect(parseK8sQuantity('3', 'count')).toBe(3);
    });
    it('returns NaN for negative', () => {
      expect(parseK8sQuantity('-5', 'count')).toBeNaN();
    });
    it('returns NaN for non-numeric', () => {
      expect(parseK8sQuantity('xyz', 'count')).toBeNaN();
    });
  });
});

describe('formatHumanBytes', () => {
  it('formats bytes', () => {
    expect(formatHumanBytes(500)).toBe('500 B');
  });
  it('formats KiB', () => {
    expect(formatHumanBytes(2048)).toBe('2.0 KiB');
  });
  it('formats MiB', () => {
    expect(formatHumanBytes(5 * 1024 ** 2)).toBe('5.0 MiB');
  });
  it('formats GiB', () => {
    expect(formatHumanBytes(1024 ** 3)).toBe('1.0 GiB');
  });
  it('formats TiB', () => {
    expect(formatHumanBytes(2 * 1024 ** 4)).toBe('2.0 TiB');
  });
  it('formats PiB', () => {
    expect(formatHumanBytes(1024 ** 5)).toBe('1.0 PiB');
  });
});

describe('formatResourceValue', () => {
  it('formats bytes unit with K8s quantity', () => {
    expect(formatResourceValue('4Gi', 'bytes')).toBe('4.0 GiB');
  });
  it('returns raw string for invalid bytes', () => {
    expect(formatResourceValue('invalid', 'bytes')).toBe('invalid');
  });
  it('formats integer non-bytes', () => {
    expect(formatResourceValue(4, 'cores')).toBe('4');
  });
  it('formats decimal non-bytes', () => {
    expect(formatResourceValue(1.5, 'cores')).toBe('1.5');
  });
  it('handles string input for non-bytes', () => {
    expect(formatResourceValue('8', 'cores')).toBe('8');
  });
  it('handles zero', () => {
    expect(formatResourceValue(0, 'cores')).toBe('0');
  });
});
