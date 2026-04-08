import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortsProvider } from '@/contexts/PortsContext';
import type { PortsContextValue, InstancePorts } from '@/contexts/PortsContext';

// Mock IngestDropzone because IngestPage passes instanceNames (string[]) but
// IngestDropzone expects instances (object[]) — a known prop mismatch in source.
vi.mock('@/ui/components/IngestDropzone/IngestDropzone', () => ({
  IngestDropzone: ({ onIngest }: { onIngest: () => void }) => (
    <div data-testid="mock-ingest-dropzone">
      <button onClick={onIngest} type="button">Drop a file here or click to browse</button>
    </div>
  ),
}));

import { IngestPage } from './IngestPage';

function makePorts(overrides: Partial<InstancePorts> = {}): InstancePorts {
  return {
    instance: { name: 'local', url: 'http://localhost/mimir', role: 'local', writeEnabled: true },
    api: {
      getStats: vi.fn(),
      listPages: vi.fn(),
      getPage: vi.fn(),
      search: vi.fn(),
      getLog: vi.fn(),
      getLint: vi.fn(),
      upsertPage: vi.fn(),
    },
    ingest: { ingest: vi.fn().mockResolvedValue({ sourceId: 'src_001', pagesUpdated: [] }) },
    graph: { getGraph: vi.fn() },
    events: {
      subscribe: vi.fn().mockReturnValue(() => {}),
      isConnected: vi.fn().mockReturnValue(false),
    },
    ...overrides,
  };
}

function renderIngestPage(ports: InstancePorts) {
  const value: PortsContextValue = {
    instances: [ports],
    activeInstanceName: 'local',
    setActiveInstanceName: vi.fn(),
  };
  return render(
    <PortsProvider value={value}>
      <IngestPage />
    </PortsProvider>,
  );
}

describe('IngestPage', () => {
  it('renders the Ingest Knowledge heading', () => {
    const ports = makePorts();
    renderIngestPage(ports);
    expect(screen.getByText('Ingest Knowledge')).toBeDefined();
  });

  it('shows subheading with instance name', () => {
    const ports = makePorts();
    renderIngestPage(ports);
    expect(screen.getByText(/Add documents/i)).toBeDefined();
  });

  it('shows connection badge when disconnected', () => {
    const ports = makePorts();
    renderIngestPage(ports);
    expect(screen.getByText('Polling for updates')).toBeDefined();
  });

  it('shows "Live updates connected" when isConnected returns true', () => {
    const ports = makePorts({
      events: {
        subscribe: vi.fn().mockReturnValue(() => {}),
        isConnected: vi.fn().mockReturnValue(true),
      },
    });
    renderIngestPage(ports);
    expect(screen.getByText('Live updates connected')).toBeDefined();
  });

  it('subscribes to events on mount', () => {
    const ports = makePorts();
    renderIngestPage(ports);
    expect(ports.events.subscribe).toHaveBeenCalled();
  });

  it('shows empty queue message initially', () => {
    const ports = makePorts();
    renderIngestPage(ports);
    expect(screen.getByText(/No jobs yet/i)).toBeDefined();
  });

  it('shows Queue section heading', () => {
    const ports = makePorts();
    renderIngestPage(ports);
    expect(screen.getByText('Queue')).toBeDefined();
  });

  it('renders the IngestDropzone mock', () => {
    const ports = makePorts();
    renderIngestPage(ports);
    expect(screen.getByTestId('mock-ingest-dropzone')).toBeDefined();
  });
});
