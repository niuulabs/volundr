import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WorkspacesSection } from './WorkspacesSection';
import type { IVolundrService } from '@/ports';
import type { VolundrWorkspace } from '@/models';

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
  },
];

function createMockService(overrides: Partial<IVolundrService> = {}): IVolundrService {
  return {
    listWorkspaces: vi.fn().mockResolvedValue(mockWorkspaces),
    restoreWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
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

  it('renders workspace list with data', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('ws-pvc-001')).toBeDefined();
    });

    expect(screen.getByText('ws-pvc-002')).toBeDefined();
    expect(screen.getByText('30 GB')).toBeDefined(); // total storage
  });

  it('shows Restore button only for archived workspaces', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('ws-pvc-001')).toBeDefined();
    });

    const restoreButtons = screen.getAllByText('Restore');
    expect(restoreButtons).toHaveLength(1);
  });

  it('calls restoreWorkspace and reloads', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('ws-pvc-002')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Restore'));
    });

    expect(service.restoreWorkspace).toHaveBeenCalledWith('ws-2');
    expect(service.listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('shows delete confirmation dialog', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('ws-pvc-001')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText(/Delete workspace/)).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('cancels delete confirmation', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('ws-pvc-001')).toBeDefined();
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText(/Delete workspace/)).toBeNull();
  });

  it('confirms delete and reloads', async () => {
    render(<WorkspacesSection service={service} />);

    await waitFor(() => {
      expect(screen.getByText('ws-pvc-001')).toBeDefined();
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
});
