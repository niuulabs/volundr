import { createContext, useContext, type ReactNode } from 'react';
import type { MimirApiPort, IngestPort, GraphPort, EventPort } from '@/ports';
import type { MimirInstance } from '@/domain';

export interface InstancePorts {
  instance: MimirInstance;
  api: MimirApiPort;
  ingest: IngestPort;
  graph: GraphPort;
  events: EventPort;
}

export interface PortsContextValue {
  instances: InstancePorts[];
  activeInstanceName: string;
  setActiveInstanceName: (name: string) => void;
}

const PortsContext = createContext<PortsContextValue | null>(null);

export function PortsProvider({
  value,
  children,
}: {
  value: PortsContextValue;
  children: ReactNode;
}) {
  return <PortsContext.Provider value={value}>{children}</PortsContext.Provider>;
}

export function usePorts(): PortsContextValue {
  const ctx = useContext(PortsContext);
  if (!ctx) {
    throw new Error('usePorts must be used within a PortsProvider');
  }
  return ctx;
}

export function useActivePorts(): InstancePorts {
  const { instances, activeInstanceName } = usePorts();
  const active = instances.find((i) => i.instance.name === activeInstanceName);
  if (!active) {
    throw new Error(`No ports for instance: ${activeInstanceName}`);
  }
  return active;
}
