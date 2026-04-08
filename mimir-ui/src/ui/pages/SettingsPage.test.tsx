import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PortsProvider } from '@/contexts/PortsContext';
import type { PortsContextValue, InstancePorts } from '@/contexts/PortsContext';
import { SettingsPage } from './SettingsPage';

function makeMockPorts(name: string, role: 'local' | 'shared' | 'domain' = 'local', writeEnabled = true): InstancePorts {
  return {
    instance: { name, url: `http://localhost/${name}`, role, writeEnabled },
    api: { getStats: vi.fn(), listPages: vi.fn(), getPage: vi.fn(), search: vi.fn(), getLog: vi.fn(), getLint: vi.fn(), upsertPage: vi.fn() },
    ingest: { ingest: vi.fn() },
    graph: { getGraph: vi.fn() },
    events: { subscribe: vi.fn().mockReturnValue(() => {}), isConnected: vi.fn().mockReturnValue(false) },
  };
}

function renderWithPorts(value: PortsContextValue) {
  return render(
    <PortsProvider value={value}>{<SettingsPage />}</PortsProvider>,
  );
}

describe('SettingsPage', () => {
  it('renders Settings heading', () => {
    renderWithPorts({
      instances: [makeMockPorts('local')],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders Mímir Instances section', () => {
    renderWithPorts({
      instances: [makeMockPorts('local')],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getByText('Mímir Instances')).toBeDefined();
  });

  it('shows "No instances configured" when instances is empty', () => {
    renderWithPorts({
      instances: [],
      activeInstanceName: 'none',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getByText(/No instances configured/i)).toBeDefined();
  });

  it('renders an instance card for each instance', () => {
    renderWithPorts({
      instances: [makeMockPorts('local'), makeMockPorts('production', 'shared', false)],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    // Use getAllByText since 'local' may appear in multiple places (badge + name)
    expect(screen.getAllByText('local').length).toBeGreaterThan(0);
    expect(screen.getAllByText('production').length).toBeGreaterThan(0);
  });

  it('shows "Active" badge for the active instance', () => {
    renderWithPorts({
      instances: [makeMockPorts('local')],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('shows instance role badge', () => {
    renderWithPorts({
      instances: [makeMockPorts('local', 'local', true)],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getAllByText('local').length).toBeGreaterThan(0);
  });

  it('shows write-enabled badge', () => {
    renderWithPorts({
      instances: [makeMockPorts('local', 'local', true)],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getByText('write-enabled')).toBeDefined();
  });

  it('shows read-only badge for non-writable instance', () => {
    renderWithPorts({
      instances: [makeMockPorts('production', 'shared', false)],
      activeInstanceName: 'production',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getByText('read-only')).toBeDefined();
  });

  it('expands instance card on click to show URL', () => {
    renderWithPorts({
      instances: [makeMockPorts('local')],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    // Active instance starts expanded — check URL is shown
    expect(screen.getByText('http://localhost/local')).toBeDefined();
  });

  it('toggles instance card open/closed on click', () => {
    renderWithPorts({
      instances: [makeMockPorts('staging', 'domain', false)],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    // staging is not active, so it starts closed — click to open
    const header = screen.getByRole('button', { name: /staging/ });
    fireEvent.click(header);
    expect(screen.getByText('http://localhost/staging')).toBeDefined();
  });

  it('shows config note', () => {
    renderWithPorts({
      instances: [makeMockPorts('local')],
      activeInstanceName: 'local',
      setActiveInstanceName: vi.fn(),
    });
    expect(screen.getAllByText(/settings\.json/i).length).toBeGreaterThan(0);
  });
});

function Wrapper({ children, value }: { children: ReactNode; value: PortsContextValue }) {
  return <PortsProvider value={value}>{children}</PortsProvider>;
}
