import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './App';
import type { InstancePorts } from '@/contexts/PortsContext';

function makePorts(name: string): InstancePorts {
  return {
    instance: {
      name,
      url: `http://localhost/${name}`,
      role: 'local',
      writeEnabled: true,
    },
    api: {
      getStats: vi.fn().mockResolvedValue({ pageCount: 0, categories: [], healthy: true }),
      listPages: vi.fn().mockResolvedValue([]),
      getPage: vi.fn().mockResolvedValue(null),
      search: vi.fn().mockResolvedValue([]),
      getLog: vi.fn().mockResolvedValue({ raw: '', entries: [] }),
      getLint: vi.fn().mockResolvedValue({ orphans: [], contradictions: [], stale: [], gaps: [], pagesChecked: 0, issuesFound: false }),
      upsertPage: vi.fn(),
    },
    ingest: { ingest: vi.fn() },
    graph: {
      getGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    },
    events: {
      subscribe: vi.fn().mockReturnValue(() => {}),
      isConnected: vi.fn().mockReturnValue(false),
    },
  };
}

describe('App', () => {
  it('renders the brand name Mímir', () => {
    render(<App instances={[makePorts('local')]} defaultInstanceName="local" />);
    expect(screen.getByText('Mímir')).toBeDefined();
  });

  it('renders navigation links', () => {
    render(<App instances={[makePorts('local')]} defaultInstanceName="local" />);
    expect(screen.getByText('Graph')).toBeDefined();
    expect(screen.getByText('Browse')).toBeDefined();
    expect(screen.getByText('Ingest')).toBeDefined();
    expect(screen.getByText('Log')).toBeDefined();
    expect(screen.getByText('Lint')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders InstanceSwitcher with local instance', () => {
    render(<App instances={[makePorts('local')]} defaultInstanceName="local" />);
    // The InstanceSwitcher renders the instance name
    const buttons = screen.getAllByText('local');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('switches active instance when InstanceSwitcher button clicked', () => {
    render(
      <App
        instances={[makePorts('local'), makePorts('staging')]}
        defaultInstanceName="local"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /staging/ }));
    // staging button should now be pressed
    const stagingBtn = screen.getByRole('button', { name: /staging/ });
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders multiple instances in switcher', () => {
    render(
      <App
        instances={[makePorts('local'), makePorts('production')]}
        defaultInstanceName="local"
      />,
    );
    expect(screen.getByText('production')).toBeDefined();
  });
});
