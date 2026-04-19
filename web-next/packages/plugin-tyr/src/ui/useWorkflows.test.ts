import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { useWorkflows, useWorkflow } from './useWorkflows';
import type { Workflow } from '../domain/workflow';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const wf1: Workflow = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Workflow 1',
  nodes: [],
  edges: [],
};

const wf2: Workflow = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Workflow 2',
  nodes: [],
  edges: [],
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

// ---------------------------------------------------------------------------
// useWorkflows
// ---------------------------------------------------------------------------

describe('useWorkflows', () => {
  it('returns workflows list from the service', async () => {
    const svc = { listWorkflows: vi.fn().mockResolvedValue([wf1, wf2]) };
    const { result } = renderHook(() => useWorkflows(), {
      wrapper: makeWrapper({ workflows: svc }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.name).toBe('Workflow 1');
    expect(svc.listWorkflows).toHaveBeenCalled();
  });

  it('enters error state when service rejects', async () => {
    const svc = { listWorkflows: vi.fn().mockRejectedValue(new Error('unavailable')) };
    const { result } = renderHook(() => useWorkflows(), {
      wrapper: makeWrapper({ workflows: svc }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('starts in loading state', () => {
    const svc = { listWorkflows: vi.fn().mockReturnValue(new Promise(() => undefined)) };
    const { result } = renderHook(() => useWorkflows(), {
      wrapper: makeWrapper({ workflows: svc }),
    });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns empty array when service returns empty list', async () => {
    const svc = { listWorkflows: vi.fn().mockResolvedValue([]) };
    const { result } = renderHook(() => useWorkflows(), {
      wrapper: makeWrapper({ workflows: svc }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// useWorkflow
// ---------------------------------------------------------------------------

describe('useWorkflow', () => {
  it('returns a single workflow by id', async () => {
    const svc = {
      getWorkflow: vi.fn().mockResolvedValue(wf1),
    };
    const { result } = renderHook(() => useWorkflow(wf1.id), {
      wrapper: makeWrapper({ workflows: svc }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('Workflow 1');
    expect(svc.getWorkflow).toHaveBeenCalledWith(wf1.id);
  });

  it('returns null when workflow not found', async () => {
    const svc = { getWorkflow: vi.fn().mockResolvedValue(null) };
    const { result } = renderHook(() => useWorkflow('missing'), {
      wrapper: makeWrapper({ workflows: svc }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('enters error state when service rejects', async () => {
    const svc = { getWorkflow: vi.fn().mockRejectedValue(new Error('not found')) };
    const { result } = renderHook(() => useWorkflow('bad-id'), {
      wrapper: makeWrapper({ workflows: svc }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
