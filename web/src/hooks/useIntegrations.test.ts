import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useIntegrations } from './useIntegrations';

// Mock the adapters module
vi.mock('@/adapters', () => ({
  volundrService: {
    getIntegrations: vi.fn().mockResolvedValue([
      {
        id: 'int-1',
        integrationType: 'issue_tracker',
        adapter: 'volundr.adapters.outbound.linear.LinearAdapter',
        credentialName: 'linear-key',
        config: {},
        enabled: true,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
        slug: 'linear',
      },
    ]),
    createIntegration: vi.fn().mockImplementation(conn => {
      return Promise.resolve({
        ...conn,
        id: 'int-new',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });
    }),
    deleteIntegration: vi.fn().mockResolvedValue(undefined),
    testIntegration: vi.fn().mockResolvedValue({
      success: true,
      provider: 'linear',
      workspace: 'Test',
    }),
  },
}));

describe('useIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches integrations on mount', async () => {
    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.integrations).toHaveLength(1);
    expect(result.current.integrations[0].id).toBe('int-1');
  });

  it('creates an integration', async () => {
    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.createIntegration({
        integrationType: 'issue_tracker',
        adapter: 'volundr.adapters.outbound.jira.JiraAdapter',
        credentialName: 'jira-key',
        config: { site_url: 'https://test.atlassian.net' },
        enabled: true,
      });
    });

    expect(result.current.integrations).toHaveLength(2);
  });

  it('deletes an integration', async () => {
    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteIntegration('int-1');
    });

    expect(result.current.integrations).toHaveLength(0);
  });

  it('tests an integration', async () => {
    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let testResult;
    await act(async () => {
      testResult = await result.current.testIntegration('int-1');
    });

    expect(testResult).toEqual({
      success: true,
      provider: 'linear',
      workspace: 'Test',
    });
  });

  it('has no error on successful fetch', async () => {
    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
  });

  it('sets error when fetch fails with Error', async () => {
    const { volundrService } = await import('@/adapters');
    vi.mocked(volundrService.getIntegrations).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
  });

  it('wraps non-Error fetch failures', async () => {
    const { volundrService } = await import('@/adapters');
    vi.mocked(volundrService.getIntegrations).mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Failed to fetch integrations');
  });

  it('refreshes integrations', async () => {
    const { result } = renderHook(() => useIntegrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const { volundrService } = await import('@/adapters');
    vi.mocked(volundrService.getIntegrations).mockResolvedValueOnce([]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.integrations).toHaveLength(0);
  });

  it('starts OAuth flow and refreshes after popup closes', async () => {
    const mockPopup = { closed: false } as Window;
    vi.spyOn(window, 'open').mockReturnValue(mockPopup);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://oauth.example.com/authorize' }),
    } as Response);

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const flowPromise = act(async () => {
      setTimeout(() => {
        (mockPopup as { closed: boolean }).closed = true;
      }, 10);
      await result.current.startOAuthFlow('linear');
    });

    await flowPromise;
    expect(window.open).toHaveBeenCalledWith(
      'https://oauth.example.com/authorize',
      'oauth-linear',
      'width=600,height=700'
    );

    vi.restoreAllMocks();
  });

  it('throws when OAuth fetch response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.startOAuthFlow('linear');
      })
    ).rejects.toThrow('Failed to start OAuth flow');

    vi.restoreAllMocks();
  });

  it('throws when popup is blocked (window.open returns null)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://oauth.example.com/authorize' }),
    } as Response);
    vi.spyOn(window, 'open').mockReturnValue(null);

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.startOAuthFlow('linear');
      })
    ).rejects.toThrow('Popup blocked');

    vi.restoreAllMocks();
  });
});
