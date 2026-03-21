import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { StorageSection } from './StorageSection';
import type { IVolundrService } from '@/ports';
import type { VolundrWorkspace } from '@/models';

const mockWorkspaces: VolundrWorkspace[] = [
  {
    id: 'ws-1',
    pvcName: 'ws-pvc-001',
    sessionId: 'session-1',
    ownerId: 'user-alice',
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
    ownerId: 'user-bob',
    tenantId: 'tenant-1',
    sizeGb: 20,
    status: 'archived',
    createdAt: '2026-02-01T09:00:00Z',
    archivedAt: '2026-02-10T09:00:00Z',
    sourceUrl: 'https://github.com/org/other-repo.git',
    sourceRef: 'develop',
  },
  {
    id: 'ws-3',
    pvcName: 'ws-pvc-003',
    sessionId: 'session-3',
    ownerId: 'user-alice',
    tenantId: 'tenant-1',
    sizeGb: 5,
    status: 'active',
    createdAt: '2026-03-01T10:00:00Z',
    sessionName: 'bugfix-session',
  },
];

function createMockService(overrides: Partial<IVolundrService> = {}): IVolundrService {
  return {
    listAllWorkspaces: vi.fn().mockResolvedValue(mockWorkspaces),
    getAdminSettings: vi
      .fn()
      .mockResolvedValue({ storage: { homeEnabled: true, fileManagerEnabled: true } }),
    restoreWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    bulkDeleteWorkspaces: vi.fn().mockResolvedValue({ deleted: 0, failed: [] }),
    updateAdminSettings: vi
      .fn()
      .mockResolvedValue({ storage: { homeEnabled: false, fileManagerEnabled: true } }),
    ...overrides,
  } as unknown as IVolundrService;
}

describe('StorageSection', () => {
  let service: IVolundrService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = createMockService();
  });

  it('renders loading state initially', () => {
    service = createMockService({
      listAllWorkspaces: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<StorageSection service={service} />);
    expect(screen.getByText('Loading workspaces...')).toBeDefined();
  });

  it('renders empty state when no workspaces match filters', async () => {
    service = createMockService({
      listAllWorkspaces: vi.fn().mockResolvedValue([]),
    });
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('No workspaces match the current filters')).toBeDefined();
    });
  });

  it('renders workspace list with human-readable labels', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      // sessionName is used as label
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    // Second workspace falls back to repo/branch since no sessionName
    expect(screen.getByText('other-repo / develop')).toBeDefined();

    // Third workspace uses sessionName
    expect(screen.getByText('bugfix-session')).toBeDefined();

    // PVC names shown as secondary text
    expect(screen.getByText('ws-pvc-001')).toBeDefined();
    expect(screen.getByText('ws-pvc-002')).toBeDefined();
    expect(screen.getByText('ws-pvc-003')).toBeDefined();
  });

  it('renders summary cards with correct counts', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    // Total: 3 workspaces
    const summaryValues = screen.getAllByText('3');
    expect(summaryValues.length).toBeGreaterThanOrEqual(1);

    // Active: 2
    const activeValues = screen.getAllByText('2');
    expect(activeValues.length).toBeGreaterThanOrEqual(1);

    // Archived: 1
    const archivedValues = screen.getAllByText('1');
    expect(archivedValues.length).toBeGreaterThanOrEqual(1);

    // Storage: 35 GB (10+20+5)
    expect(screen.getByText('35 GB')).toBeDefined();
  });

  it('supports multi-select and bulk delete', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    // First is select-all, then per-row
    await act(async () => {
      fireEvent.click(checkboxes[1]);
      fireEvent.click(checkboxes[2]);
    });

    expect(screen.getByText('2 selected')).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByText('Delete 2 workspaces'));
    });

    expect(service.bulkDeleteWorkspaces).toHaveBeenCalledWith(['session-1', 'session-2']);
  });

  it('select-all toggles all checkboxes', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const checkboxes = screen.getAllByRole('checkbox');

    // Click select-all
    await act(async () => {
      fireEvent.click(checkboxes[0]);
    });

    expect(screen.getByText('3 selected')).toBeDefined();

    // Click select-all again to deselect
    await act(async () => {
      fireEvent.click(checkboxes[0]);
    });

    expect(screen.queryByText('3 selected')).toBeNull();
  });

  it('shows delete confirmation dialog with readable name', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText(/Delete workspace/)).toBeDefined();
    // "my-feature-work" appears in both the table row and the confirmation dialog
    const nameElements = screen.getAllByText('my-feature-work');
    expect(nameElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('confirms delete and reloads', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    // Click confirm Delete in the dialog
    const confirmButtons = screen.getAllByText('Delete');
    const confirmDelete = confirmButtons[confirmButtons.length - 1];
    await act(async () => {
      fireEvent.click(confirmDelete);
    });

    expect(service.deleteWorkspace).toHaveBeenCalledWith('session-1');
    expect(service.listAllWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('cancels delete confirmation', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText(/Delete workspace/)).toBeNull();
  });

  it('filters by status', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    // Filter to archived only
    fireEvent.change(screen.getByDisplayValue('All'), {
      target: { value: 'archived' },
    });

    // Only archived workspace should be visible
    expect(screen.getByText('other-repo / develop')).toBeDefined();
    expect(screen.queryByText('my-feature-work')).toBeNull();
    expect(screen.queryByText('bugfix-session')).toBeNull();
  });

  it('filters by user', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    // Filter to user-bob
    fireEvent.change(screen.getByDisplayValue('All users'), {
      target: { value: 'user-bob' },
    });

    expect(screen.getByText('other-repo / develop')).toBeDefined();
    expect(screen.queryByText('my-feature-work')).toBeNull();
    expect(screen.queryByText('bugfix-session')).toBeNull();
  });

  it('shows Restore button only for archived workspaces', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('my-feature-work')).toBeDefined();
    });

    const restoreButtons = screen.getAllByText('Restore');
    expect(restoreButtons).toHaveLength(1);
  });

  it('calls restoreWorkspace and reloads', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('other-repo / develop')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Restore'));
    });

    expect(service.restoreWorkspace).toHaveBeenCalledWith('ws-2');
    expect(service.listAllWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('renders admin settings toggles', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('Persistent home directories')).toBeDefined();
    });

    expect(screen.getByText('File Manager')).toBeDefined();
    expect(screen.getByLabelText('Toggle persistent home directories')).toBeDefined();
    expect(screen.getByLabelText('Toggle file manager')).toBeDefined();
  });

  it('toggles home directories setting', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle persistent home directories')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Toggle persistent home directories'));
    });

    expect(service.updateAdminSettings).toHaveBeenCalledWith({
      storage: { homeEnabled: false, fileManagerEnabled: true },
    });
  });

  it('toggles file manager setting', async () => {
    render(<StorageSection service={service} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle file manager')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Toggle file manager'));
    });

    expect(service.updateAdminSettings).toHaveBeenCalledWith({
      storage: { homeEnabled: true, fileManagerEnabled: false },
    });
  });

  it('falls back to PVC name when no session info', async () => {
    const plainWorkspaces: VolundrWorkspace[] = [
      {
        id: 'ws-plain',
        pvcName: 'ws-pvc-plain',
        sessionId: 'session-plain',
        ownerId: 'user-1',
        tenantId: 'tenant-1',
        sizeGb: 5,
        status: 'active',
        createdAt: '2026-03-01T10:00:00Z',
      },
    ];
    service = createMockService({
      listAllWorkspaces: vi.fn().mockResolvedValue(plainWorkspaces),
    });
    render(<StorageSection service={service} />);

    await waitFor(() => {
      const pvcElements = screen.getAllByText('ws-pvc-plain');
      expect(pvcElements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
