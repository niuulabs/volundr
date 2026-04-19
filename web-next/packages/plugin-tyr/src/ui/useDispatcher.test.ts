import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { useDispatcher } from './useDispatcher';
import type { DispatcherState } from '../domain/dispatcher';

const MOCK_STATE: DispatcherState = {
  id: '00000000-0000-0000-0000-000000000999',
  running: true,
  threshold: 70,
  maxConcurrentRaids: 3,
  autoContinue: false,
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeWrapper(service: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(ServicesProvider, { services: service }, children),
    );
  };
}

describe('useDispatcher', () => {
  it('returns dispatcher state from the service', async () => {
    const svc = { getState: vi.fn().mockResolvedValue(MOCK_STATE) };
    const { result } = renderHook(() => useDispatcher(), {
      wrapper: makeWrapper({ 'tyr.dispatcher': svc }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(MOCK_STATE);
    expect(svc.getState).toHaveBeenCalledOnce();
  });

  it('returns null when dispatcher returns null', async () => {
    const svc = { getState: vi.fn().mockResolvedValue(null) };
    const { result } = renderHook(() => useDispatcher(), {
      wrapper: makeWrapper({ 'tyr.dispatcher': svc }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('enters error state when service rejects', async () => {
    const svc = { getState: vi.fn().mockRejectedValue(new Error('dispatcher unavailable')) };
    const { result } = renderHook(() => useDispatcher(), {
      wrapper: makeWrapper({ 'tyr.dispatcher': svc }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('starts in loading state', () => {
    const svc = { getState: vi.fn().mockReturnValue(new Promise(() => undefined)) };
    const { result } = renderHook(() => useDispatcher(), {
      wrapper: makeWrapper({ 'tyr.dispatcher': svc }),
    });
    expect(result.current.isLoading).toBe(true);
  });
});
