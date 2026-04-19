import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRavens, useRaven } from './useRavens';
import { createMockRavenStream } from '../adapters/mock';
import { wrapWithServices } from '../testing/wrapWithRavn';

const makeWrapper = wrapWithServices;

describe('useRavens', () => {
  it('returns all ravens from the service', async () => {
    const { result } = renderHook(() => useRavens(), {
      wrapper: makeWrapper({ 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(6);
  });

  it('returns isLoading true initially', () => {
    const { result } = renderHook(() => useRavens(), {
      wrapper: makeWrapper({ 'ravn.ravens': createMockRavenStream() }),
    });
    expect(result.current.isLoading).toBe(true);
  });

  it('sets isError on failure', async () => {
    const failing = {
      listRavens: async () => {
        throw new Error('fail');
      },
      getRaven: async () => {
        throw new Error('fail');
      },
    };
    const { result } = renderHook(() => useRavens(), {
      wrapper: makeWrapper({ 'ravn.ravens': failing }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRaven', () => {
  it('returns a specific raven by id', async () => {
    const { result } = renderHook(() => useRaven('a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c'), {
      wrapper: makeWrapper({ 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.personaName).toBe('coding-agent');
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useRaven(''), {
      wrapper: makeWrapper({ 'ravn.ravens': createMockRavenStream() }),
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });
});
