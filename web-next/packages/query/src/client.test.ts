import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createApiClient,
  ApiClientError,
  setTokenProvider,
  getAccessToken,
  type ApiClient,
} from './client';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  setTokenProvider(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response;
}

function noContentResponse(): Response {
  return { ok: true, status: 204, json: () => Promise.reject('no body') } as unknown as Response;
}

describe('createApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = createApiClient('/api/v1/test');
  });

  describe('get', () => {
    it('sends a GET request to the correct URL', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));
      const result = await client.get<{ id: number }>('/items');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('post', () => {
    it('sends a POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ created: true }));
      await client.post('/items', { name: 'test' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        }),
      );
    });

    it('sends a POST without body when not provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await client.post('/items');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items',
        expect.objectContaining({ method: 'POST', body: undefined }),
      );
    });
  });

  describe('put', () => {
    it('sends a PUT request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ updated: true }));
      await client.put('/items/1', { name: 'updated' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'updated' }),
        }),
      );
    });
  });

  describe('patch', () => {
    it('sends a PATCH request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ patched: true }));
      await client.patch('/items/1', { enabled: false });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ enabled: false }),
        }),
      );
    });
  });

  describe('delete', () => {
    it('sends a DELETE request without body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ deleted: true }));
      await client.delete('/items/1');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('sends a DELETE request with body when provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ deleted: true }));
      await client.delete('/items/1', { reason: 'test' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items/1',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ reason: 'test' }),
        }),
      );
    });
  });

  describe('204 No Content', () => {
    it('returns undefined for 204 responses', async () => {
      mockFetch.mockResolvedValueOnce(noContentResponse());
      const result = await client.delete('/items/1');
      expect(result).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws ApiClientError on non-2xx responses', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ detail: 'Not found' }, 404));
      await expect(client.get('/missing')).rejects.toThrow(ApiClientError);
    });

    it('includes status and detail in ApiClientError', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ detail: 'Forbidden' }, 403));
      try {
        await client.get('/secret');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(403);
        expect(apiErr.detail).toBe('Forbidden');
        expect(apiErr.message).toContain('403');
      }
    });

    it('uses "Unknown error" when detail is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      try {
        await client.get('/broken');
        expect.unreachable('should have thrown');
      } catch (err) {
        const apiErr = err as ApiClientError;
        expect(apiErr.detail).toBe('Unknown error');
      }
    });
  });

  describe('Content-Type header', () => {
    it('sets Content-Type to application/json by default', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await client.get('/items');
      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });
});

describe('token provider', () => {
  beforeEach(() => {
    setTokenProvider(null);
  });

  it('getAccessToken returns null when no provider is set', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('getAccessToken returns token from provider', () => {
    setTokenProvider(() => 'test-token');
    expect(getAccessToken()).toBe('test-token');
  });

  it('getAccessToken returns null when provider returns null', () => {
    setTokenProvider(() => null);
    expect(getAccessToken()).toBeNull();
  });

  it('includes Authorization header when token provider is set', async () => {
    setTokenProvider(() => 'my-jwt');
    const client = createApiClient('/api');
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await client.get('/data');
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-jwt');
  });

  it('omits Authorization header when no token provider', async () => {
    const client = createApiClient('/api');
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await client.get('/data');
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('omits Authorization header when provider returns null', async () => {
    setTokenProvider(() => null);
    const client = createApiClient('/api');
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await client.get('/data');
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('clears provider when set to null', () => {
    setTokenProvider(() => 'token');
    expect(getAccessToken()).toBe('token');
    setTokenProvider(null);
    expect(getAccessToken()).toBeNull();
  });
});
