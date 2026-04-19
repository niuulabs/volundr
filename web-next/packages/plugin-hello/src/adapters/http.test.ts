import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@niuulabs/query';
import { createHttpHelloService } from './http';

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe('createHttpHelloService', () => {
  it('fetches greetings from /greetings', async () => {
    const greetings = [
      { id: '1', text: 'hello', mood: 'warm' },
      { id: '2', text: 'hi', mood: 'cold' },
    ];
    const client = mockApiClient({
      get: vi.fn().mockResolvedValue(greetings),
    });

    const service = createHttpHelloService(client);
    const result = await service.listGreetings();

    expect(client.get).toHaveBeenCalledWith('/greetings');
    expect(result).toEqual(greetings);
  });

  it('propagates API errors', async () => {
    const client = mockApiClient({
      get: vi.fn().mockRejectedValue(new Error('network error')),
    });

    const service = createHttpHelloService(client);
    await expect(service.listGreetings()).rejects.toThrow('network error');
  });

  it('implements IHelloService interface', () => {
    const client = mockApiClient();
    const service = createHttpHelloService(client);
    expect(typeof service.listGreetings).toBe('function');
  });
});
