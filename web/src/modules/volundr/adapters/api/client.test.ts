import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient, ApiClientError } from './client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('createApiClient', () => {
  const client = createApiClient('/api/v1/test');

  beforeEach(() => {
    mockFetch.mockReset();
  });

  function mockResponse(data: unknown, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
    });
  }

  describe('get', () => {
    it('makes GET request to correct URL', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ data: 'test' }));

      const result = await client.get('/items');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual({ data: 'test' });
    });
  });

  describe('post', () => {
    it('makes POST request with body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));

      await client.post('/items', { name: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        })
      );
    });

    it('makes POST request without body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));

      await client.post('/items');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items',
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        })
      );
    });
  });

  describe('put', () => {
    it('makes PUT request with body', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ id: 1 }));

      await client.put('/items/1', { name: 'updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'updated' }),
        })
      );
    });
  });

  describe('delete', () => {
    it('makes DELETE request', async () => {
      mockFetch.mockReturnValueOnce(mockResponse(null, 204));

      await client.delete('/items/1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test/items/1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('204 No Content', () => {
    it('returns undefined for 204 responses', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.reject(new Error('No content')),
        })
      );

      const result = await client.delete('/items/1');

      expect(result).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws ApiClientError for non-ok responses', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Not found' }, 404));

      try {
        await client.get('/items/999');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).status).toBe(404);
        expect((error as ApiClientError).detail).toBe('Not found');
      }
    });

    it('handles error response without detail', async () => {
      mockFetch.mockReturnValueOnce(mockResponse({}, 500));

      try {
        await client.get('/items');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).status).toBe(500);
        expect((error as ApiClientError).detail).toBe('Unknown error');
      }
    });
  });
});

describe('ApiClientError', () => {
  it('has correct properties', () => {
    const error = new ApiClientError('test message', 404, 'Not found');

    expect(error.message).toBe('test message');
    expect(error.status).toBe(404);
    expect(error.detail).toBe('Not found');
    expect(error.name).toBe('ApiClientError');
    expect(error).toBeInstanceOf(Error);
  });
});
