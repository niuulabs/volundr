import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import React from 'react';
import { useSessions, useSession, useMessages } from './useSessions';
import { createMockSessionStream } from '../adapters/mock';

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

const svc = { 'ravn.sessions': createMockSessionStream() };

describe('useSessions', () => {
  it('returns all sessions', async () => {
    const { result } = renderHook(() => useSessions(), { wrapper: makeWrapper(svc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(6);
  });

  it('starts loading', () => {
    const { result } = renderHook(() => useSessions(), { wrapper: makeWrapper(svc) });
    expect(result.current.isLoading).toBe(true);
  });
});

describe('useSession', () => {
  it('returns a specific session', async () => {
    const { result } = renderHook(() => useSession('10000001-0000-4000-8000-000000000001'), {
      wrapper: makeWrapper(svc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.personaName).toBe('coding-agent');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useSession(''), { wrapper: makeWrapper(svc) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useMessages', () => {
  it('returns messages for a session', async () => {
    const { result } = renderHook(() => useMessages('10000001-0000-4000-8000-000000000001'), {
      wrapper: makeWrapper(svc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBeGreaterThan(0);
  });

  it('does not fetch when sessionId is empty', () => {
    const { result } = renderHook(() => useMessages(''), { wrapper: makeWrapper(svc) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
