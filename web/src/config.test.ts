import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('loadRuntimeConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('fetches and returns config from /config.json', async () => {
    const mockConfig = {
      apiBaseUrl: 'http://api.local',
      oidc: { authority: 'https://auth', clientId: 'app' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      })
    );

    const { loadRuntimeConfig } = await import('./config');
    const config = await loadRuntimeConfig();

    expect(fetch).toHaveBeenCalledWith('/config.json');
    expect(config.apiBaseUrl).toBe('http://api.local');
    expect(config.oidc?.authority).toBe('https://auth');
  });

  it('returns default config when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { loadRuntimeConfig } = await import('./config');
    const config = await loadRuntimeConfig();

    expect(config.apiBaseUrl).toBe('');
    expect(config.oidc).toBeUndefined();
  });

  it('returns default config when response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })
    );

    const { loadRuntimeConfig } = await import('./config');
    const config = await loadRuntimeConfig();

    expect(config.apiBaseUrl).toBe('');
  });

  it('caches the result after first load', async () => {
    const mockConfig = { apiBaseUrl: 'http://cached' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      })
    );

    const { loadRuntimeConfig } = await import('./config');
    await loadRuntimeConfig();
    await loadRuntimeConfig();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('getRuntimeConfig returns null before load', async () => {
    const { getRuntimeConfig } = await import('./config');
    expect(getRuntimeConfig()).toBeNull();
  });

  it('getRuntimeConfig returns cached value after load', async () => {
    const mockConfig = { apiBaseUrl: 'http://test' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      })
    );

    const { loadRuntimeConfig, getRuntimeConfig } = await import('./config');
    await loadRuntimeConfig();

    expect(getRuntimeConfig()?.apiBaseUrl).toBe('http://test');
  });
});
