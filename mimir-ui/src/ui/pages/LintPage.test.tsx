import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PortsProvider } from '@/contexts/PortsContext';
import type { PortsContextValue, InstancePorts } from '@/contexts/PortsContext';
import { LintPage } from './LintPage';
import type { MimirLintReport } from '@/domain';

const cleanReport: MimirLintReport = {
  orphans: [],
  contradictions: [],
  stale: [],
  gaps: [],
  pagesChecked: 10,
  issuesFound: false,
};

const reportWithIssues: MimirLintReport = {
  orphans: ['old/page.md'],
  contradictions: [],
  stale: [],
  gaps: ['security'],
  pagesChecked: 20,
  issuesFound: true,
};

function makePorts(getLint: () => Promise<MimirLintReport>): InstancePorts {
  return {
    instance: { name: 'local', url: 'http://localhost/mimir', role: 'local', writeEnabled: true },
    api: {
      getStats: vi.fn(),
      listPages: vi.fn(),
      getPage: vi.fn(),
      search: vi.fn(),
      getLog: vi.fn(),
      getLint: vi.fn().mockImplementation(getLint),
      upsertPage: vi.fn(),
    },
    ingest: { ingest: vi.fn() },
    graph: { getGraph: vi.fn() },
    events: { subscribe: vi.fn().mockReturnValue(() => {}), isConnected: vi.fn().mockReturnValue(false) },
  };
}

function renderLintPage(ports: InstancePorts) {
  const value: PortsContextValue = {
    instances: [ports],
    activeInstanceName: 'local',
    setActiveInstanceName: vi.fn(),
  };
  return render(
    <PortsProvider value={value}>
      <MemoryRouter>
        <LintPage />
      </MemoryRouter>
    </PortsProvider>,
  );
}

describe('LintPage', () => {
  it('shows Health Report heading', async () => {
    const ports = makePorts(() => Promise.resolve(cleanReport));
    renderLintPage(ports);
    expect(screen.getByText('Health Report')).toBeDefined();
  });

  it('shows loading state initially', () => {
    const ports = makePorts(() => new Promise(() => {})); // never resolves
    renderLintPage(ports);
    expect(screen.getByText(/Running health checks/i)).toBeDefined();
  });

  it('renders lint report when loaded', async () => {
    const ports = makePorts(() => Promise.resolve(cleanReport));
    renderLintPage(ports);
    await waitFor(() => {
      expect(screen.getByText('All clear')).toBeDefined();
    });
  });

  it('shows pages checked count in subheading', async () => {
    const ports = makePorts(() => Promise.resolve(cleanReport));
    renderLintPage(ports);
    await waitFor(() => {
      expect(screen.getByText(/10 pages checked/i)).toBeDefined();
    });
  });

  it('shows "issues found" when report has issues', async () => {
    const ports = makePorts(() => Promise.resolve(reportWithIssues));
    renderLintPage(ports);
    await waitFor(() => {
      expect(screen.getAllByText(/issues found/i).length).toBeGreaterThan(0);
    });
  });

  it('shows error message when getLint fails', async () => {
    const ports = makePorts(() => Promise.reject(new Error('Service unavailable')));
    renderLintPage(ports);
    await waitFor(() => {
      expect(screen.getByText('Service unavailable')).toBeDefined();
    });
  });

  it('shows Re-check button after load', async () => {
    const ports = makePorts(() => Promise.resolve(cleanReport));
    renderLintPage(ports);
    // After loading, button shows "Re-check" (not "Checking…")
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Re-check' })).toBeDefined();
    });
  });

  it('Re-check button re-fetches lint report', async () => {
    const getLint = vi.fn().mockResolvedValue(cleanReport);
    const ports = makePorts(getLint);
    renderLintPage(ports);
    await waitFor(() => screen.getByText('All clear'));
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await waitFor(() => {
      expect(getLint).toHaveBeenCalledTimes(2);
    });
  });
});
