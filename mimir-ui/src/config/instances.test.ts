import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadInstances } from '@/config/instances';

describe('loadInstances()', () => {
  afterEach(() => {
    // Reset env after each test
    (import.meta.env as Record<string, unknown>)['VITE_MIMIR_INSTANCES'] = undefined;
    vi.restoreAllMocks();
  });

  it('returns default local instance when VITE_MIMIR_INSTANCES not set', () => {
    (import.meta.env as Record<string, unknown>)['VITE_MIMIR_INSTANCES'] = undefined;

    const instances = loadInstances();

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe('local');
    expect(instances[0].url).toBe('http://localhost:7477/mimir');
    expect(instances[0].role).toBe('local');
    expect(instances[0].writeEnabled).toBe(true);
  });

  it('returns default instance when env var is empty string', () => {
    (import.meta.env as Record<string, unknown>)['VITE_MIMIR_INSTANCES'] = '';

    const instances = loadInstances();

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe('local');
  });

  it('parses JSON from VITE_MIMIR_INSTANCES env var', () => {
    const customInstances = [
      {
        name: 'production',
        url: 'https://mimir.example.com/mimir',
        role: 'shared',
        writeEnabled: false,
      },
      {
        name: 'staging',
        url: 'https://staging.example.com/mimir',
        role: 'domain',
        writeEnabled: true,
      },
    ];
    (import.meta.env as Record<string, unknown>)['VITE_MIMIR_INSTANCES'] =
      JSON.stringify(customInstances);

    const instances = loadInstances();

    expect(instances).toHaveLength(2);
    expect(instances[0].name).toBe('production');
    expect(instances[0].url).toBe('https://mimir.example.com/mimir');
    expect(instances[0].role).toBe('shared');
    expect(instances[0].writeEnabled).toBe(false);
    expect(instances[1].name).toBe('staging');
  });

  it('returns defaults when env var contains invalid JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (import.meta.env as Record<string, unknown>)['VITE_MIMIR_INSTANCES'] =
      'this is not valid json {{{';

    const instances = loadInstances();

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe('local');
    warnSpy.mockRestore();
  });

  it('logs a warning when env var contains invalid JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (import.meta.env as Record<string, unknown>)['VITE_MIMIR_INSTANCES'] = '{bad json';

    loadInstances();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/VITE_MIMIR_INSTANCES/);
    warnSpy.mockRestore();
  });

  it('parses single instance JSON correctly', () => {
    (import.meta.env as Record<string, unknown>)['VITE_MIMIR_INSTANCES'] = JSON.stringify([
      {
        name: 'custom',
        url: 'http://192.168.1.100:7477/mimir',
        role: 'local',
        writeEnabled: true,
      },
    ]);

    const instances = loadInstances();

    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe('custom');
    expect(instances[0].url).toBe('http://192.168.1.100:7477/mimir');
  });
});
