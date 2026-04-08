import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PortsProvider, usePorts, useActivePorts } from '@/contexts/PortsContext';
import type { PortsContextValue, InstancePorts } from '@/contexts/PortsContext';
import type { MimirApiPort, IngestPort, GraphPort, EventPort } from '@/ports';

// Minimal stub implementations
function makeMockApi(): MimirApiPort {
  return {
    getStats: vi.fn(),
    listPages: vi.fn(),
    getPage: vi.fn(),
    search: vi.fn(),
    getLog: vi.fn(),
    getLint: vi.fn(),
    upsertPage: vi.fn(),
  };
}

function makeMockIngest(): IngestPort {
  return {
    ingest: vi.fn(),
  };
}

function makeMockGraph(): GraphPort {
  return {
    getGraph: vi.fn(),
  };
}

function makeMockEvents(): EventPort {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    isConnected: vi.fn().mockReturnValue(false),
  };
}

function makeInstancePorts(name: string): InstancePorts {
  return {
    instance: { name, url: `http://localhost/${name}`, role: 'local', writeEnabled: true },
    api: makeMockApi(),
    ingest: makeMockIngest(),
    graph: makeMockGraph(),
    events: makeMockEvents(),
  };
}

function makeContextValue(overrides?: Partial<PortsContextValue>): PortsContextValue {
  return {
    instances: [makeInstancePorts('local')],
    activeInstanceName: 'local',
    setActiveInstanceName: vi.fn(),
    ...overrides,
  };
}

function wrapper(value: PortsContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <PortsProvider value={value}>{children}</PortsProvider>;
  };
}

describe('usePorts()', () => {
  it('throws when used outside PortsProvider', () => {
    expect(() => {
      renderHook(() => usePorts());
    }).toThrow('usePorts must be used within a PortsProvider');
  });

  it('returns the provided value inside PortsProvider', () => {
    const value = makeContextValue();
    const { result } = renderHook(() => usePorts(), { wrapper: wrapper(value) });

    expect(result.current).toBe(value);
  });

  it('returns instances array', () => {
    const value = makeContextValue();
    const { result } = renderHook(() => usePorts(), { wrapper: wrapper(value) });

    expect(result.current.instances).toHaveLength(1);
  });

  it('returns activeInstanceName', () => {
    const value = makeContextValue({ activeInstanceName: 'local' });
    const { result } = renderHook(() => usePorts(), { wrapper: wrapper(value) });

    expect(result.current.activeInstanceName).toBe('local');
  });

  it('returns setActiveInstanceName function', () => {
    const setFn = vi.fn();
    const value = makeContextValue({ setActiveInstanceName: setFn });
    const { result } = renderHook(() => usePorts(), { wrapper: wrapper(value) });

    expect(result.current.setActiveInstanceName).toBe(setFn);
  });
});

describe('useActivePorts()', () => {
  it('returns the active instance ports', () => {
    const localPorts = makeInstancePorts('local');
    const value = makeContextValue({
      instances: [localPorts],
      activeInstanceName: 'local',
    });

    const { result } = renderHook(() => useActivePorts(), { wrapper: wrapper(value) });

    expect(result.current).toBe(localPorts);
  });

  it('returns the correct ports when multiple instances present', () => {
    const localPorts = makeInstancePorts('local');
    const prodPorts = makeInstancePorts('production');
    const value = makeContextValue({
      instances: [localPorts, prodPorts],
      activeInstanceName: 'production',
    });

    const { result } = renderHook(() => useActivePorts(), { wrapper: wrapper(value) });

    expect(result.current).toBe(prodPorts);
  });

  it('throws when active instance not found', () => {
    const value = makeContextValue({
      instances: [makeInstancePorts('local')],
      activeInstanceName: 'nonexistent',
    });

    expect(() => {
      renderHook(() => useActivePorts(), { wrapper: wrapper(value) });
    }).toThrow('No ports for instance: nonexistent');
  });

  it('throws with the name of the missing instance in the error', () => {
    const value = makeContextValue({
      instances: [makeInstancePorts('local')],
      activeInstanceName: 'my-missing-instance',
    });

    expect(() => {
      renderHook(() => useActivePorts(), { wrapper: wrapper(value) });
    }).toThrow('my-missing-instance');
  });

  it('provides api, ingest, graph, events on the returned ports', () => {
    const localPorts = makeInstancePorts('local');
    const value = makeContextValue({
      instances: [localPorts],
      activeInstanceName: 'local',
    });

    const { result } = renderHook(() => useActivePorts(), { wrapper: wrapper(value) });

    expect(result.current.api).toBeDefined();
    expect(result.current.ingest).toBeDefined();
    expect(result.current.graph).toBeDefined();
    expect(result.current.events).toBeDefined();
  });
});
