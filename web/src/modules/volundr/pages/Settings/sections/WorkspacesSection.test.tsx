import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WorkspacesSection } from './WorkspacesSection';
import type { IVolundrService } from '@/modules/volundr/ports';
import type { VolundrWorkspace } from '@/modules/volundr/models';

const mockWorkspaces: VolundrWorkspace[] = [
  {
    id: 'ws-1',
    pvcName: 'ws-pvc-001',
    sessionId: 'session-1',
    ownerId: 'user-1',
    tenantId: 'tenant-1',
    sizeGb: 10,
    status: 'active',
    createdAt: '2026-01-15T10:00:00Z',
    sessionName: 'my-feature-work',
    sourceUrl: 'https://github.com/org/repo.git',
    sourceRef: 'main',
  },
  {
    id: 'ws-2',
    pvcName: 'ws-pvc-002',
    sessionId: 'session-2',
    ownerId: 'user-1',
    tenantId: 'tenant-1',
    sizeGb: 20,
    status: 'archived',
    createdAt: '2026-02-01T09:00:00Z',
    archivedAt: '2026-02-10T09:00:00Z',
    sourceUrl: 'https://github.com/org/other-repo.git',
    sourceRef: 'develop',
  },
];

function createMockService(overrides: Partial<IVolundrService> = {}): IVolundrService {
  return {
    listWorkspaces: vi.fn().mockResolvedValue(mockWorkspaces),
    restoreWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    bulkDeleteWorkspaces: vi.fn().mockResolvedValue({ deleted: 0, failed: [] }),
    ...overrides,
  } as unknown as IVolundrService;
}

describe('WorkspacesSection', () => {
  let service: IVolundrService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = createMockService();
  });

  it('renders loading state initially', () => {
    service = createMockService({
      listWorkspaces: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<WorkspacesSection service={service} />);
    expect(screen.getByText('Loading workspaces...')).toBeDefined();
  });

  it('renders empty state when no workspaces', async () => {
    service = createMockService({
      listWorkspaces: vi.fn().mockResolvedValue([]),
    });
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('No workspaces found')).toBeDefined();
    });
  });

  it('renders workspace list with human-readable labels', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    // Second workspace falls back to repo/branch since no sessionName
    expect(screen.getByText('other-repo / develop')).toBeDefined();
    // PVC names shown as secondary text
    expect(screen.getByText('ws-pvc-001')).toBeDefined();
    expect(screen.getByText('ws-pvc-002')).toBeDefined();
    expect(screen.getByText('30 GB')).toBeDefined(); // total storage
  });

  it('shows Restore button only for archived workspaces', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const restoreButtons = screen.getAllByText('Restore');
    expect(restoreButtons).toHaveLength(1);
  });

  it('calls restoreWorkspace and reloads', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('other-repo / develop')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Restore'));
    });

    expect(service.restoreWorkspace).toHaveBeenCalledWith('ws-2');
    expect(service.listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('shows delete confirmation dialog with readable name', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText(/Delete workspace/)).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('cancels delete confirmation', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText(/Delete workspace/)).toBeNull();
  });

  it('confirms delete and reloads', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    // Click the confirm Delete in the dialog (not the row button)
    const confirmButtons = screen.getAllByText('Delete');
    const confirmDelete = confirmButtons[confirmButtons.length - 1];
    await act(async () => {
      fireEvent.click(confirmDelete);
    });

    expect(service.deleteWorkspace).toHaveBeenCalledWith('session-1');
    expect(service.listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('supports multi-select and bulk delete', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    // Select both checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is select-all, next are per-row
    await act(async () => {
      fireEvent.click(checkboxes[1]); // first row
      fireEvent.click(checkboxes[2]); // second row
    });

    expect(screen.getByText('2 selected')).toBeDefined();

    // Click bulk delete
    await act(async () => {
      fireEvent.click(screen.getByText('Delete 2 workspaces'));
    });

    expect(service.bulkDeleteWorkspaces).toHaveBeenCalledWith(['session-1', 'session-2']);
  });

  it('select-all toggles all checkboxes', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    // Click select-all
    await act(async () => {
      fireEvent.click(checkboxes[0]);
    });

    expect(screen.getByText('2 selected')).toBeDefined();

    // Click select-all again to deselect
    await act(async () => {
      fireEvent.click(checkboxes[0]);
    });

    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('falls back to PVC name when no session info', async () => {
    const plainWorkspaces: VolundrWorkspace[] = [
      {
        id: 'ws-3',
        pvcName: 'ws-pvc-plain',
        sessionId: 'session-3',
        ownerId: 'user-1',
        tenantId: 'tenant-1',
        sizeGb: 5,
        status: 'active',
        createdAt: '2026-03-01T10:00:00Z',
      },
    ];
    service = createMockService({
      listWorkspaces: vi.fn().mockResolvedValue(plainWorkspaces),
    });
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      // Should show PVC name as the label when no sessionName/sourceUrl
      const pvcElements = screen.getAllByText('ws-pvc-plain');
      expect(pvcElements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
