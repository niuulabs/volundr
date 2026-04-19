import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import React from 'react';
import { useFleetBudget, useRavnBudget } from './useBudget';
import { createMockBudgetStream } from '../adapters/mock';

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

const svc = { 'ravn.budget': createMockBudgetStream() };

describe('useFleetBudget', () => {
  it('returns fleet budget totals', async () => {
    const { result } = renderHook(() => useFleetBudget(), { wrapper: makeWrapper(svc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.spentUsd).toBeGreaterThan(0);
    expect(result.current.data?.capUsd).toBeGreaterThan(0);
  });

  it('starts loading', () => {
    const { result } = renderHook(() => useFleetBudget(), { wrapper: makeWrapper(svc) });
    expect(result.current.isLoading).toBe(true);
  });
});

describe('useRavnBudget', () => {
  it('returns budget for a specific ravn', async () => {
    const { result } = renderHook(() => useRavnBudget('a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c'), {
      wrapper: makeWrapper(svc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.spentUsd).toBe(1.24);
  });

  it('does not fetch when ravnId is empty', () => {
    const { result } = renderHook(() => useRavnBudget(''), { wrapper: makeWrapper(svc) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
