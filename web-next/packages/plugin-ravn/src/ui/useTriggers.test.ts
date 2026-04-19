import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import React from 'react';
import { useTriggers } from './useTriggers';
import { createMockTriggerStore } from '../adapters/mock';

function makeWrapper(services: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ServicesProvider, { services }, children),
    );
  };
}

describe('useTriggers', () => {
  it('returns all triggers', async () => {
    const { result } = renderHook(() => useTriggers(), {
      wrapper: makeWrapper({ 'ravn.triggers': createMockTriggerStore() }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(5);
  });

  it('starts loading', () => {
    const { result } = renderHook(() => useTriggers(), {
      wrapper: makeWrapper({ 'ravn.triggers': createMockTriggerStore() }),
    });
    expect(result.current.isLoading).toBe(true);
  });

  it('sets isError on failure', async () => {
    const failing = { listTriggers: async () => { throw new Error('fail'); }, createTrigger: async () => { throw new Error(); }, deleteTrigger: async () => { throw new Error(); } };
    const { result } = renderHook(() => useTriggers(), {
      wrapper: makeWrapper({ 'ravn.triggers': failing }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
