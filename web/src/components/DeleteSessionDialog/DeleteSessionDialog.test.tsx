import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DeleteSessionDialog } from './DeleteSessionDialog';

describe('DeleteSessionDialog', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onConfirm = vi.fn();
    onCancel = vi.fn();
  });

  it('renders nothing when closed', () => {
    render(
      <DeleteSessionDialog
        isOpen={false}
        sessionName="test-session"
        isManual={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.queryByTestId('delete-session-dialog')).not.toBeInTheDocument();
  });

  it('renders delete dialog with cleanup checkboxes for managed sessions', () => {
    render(
      <DeleteSessionDialog
        isOpen={true}
        sessionName="my-session"
        isManual={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByTestId('delete-session-dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete session')).toBeInTheDocument();
    expect(screen.getByText('my-session')).toBeInTheDocument();
    expect(screen.getByTestId('cleanup-workspace_storage')).toBeInTheDocument();
    expect(screen.getByTestId('cleanup-chronicles')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('does not show cleanup checkboxes for manual sessions', () => {
    render(
      <DeleteSessionDialog
        isOpen={true}
        sessionName="manual-session"
        isManual={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Remove session')).toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-workspace_storage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-chronicles')).not.toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });

  it('calls onConfirm with empty array when no checkboxes selected', () => {
    render(
      <DeleteSessionDialog
        isOpen={true}
        sessionName="my-session"
        isManual={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('delete-session-confirm'));

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('calls onConfirm with selected cleanup targets', () => {
    render(
      <DeleteSessionDialog
        isOpen={true}
        sessionName="my-session"
        isManual={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('cleanup-workspace_storage'));
    fireEvent.click(screen.getByTestId('cleanup-chronicles'));
    fireEvent.click(screen.getByTestId('delete-session-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining(['workspace_storage', 'chronicles'])
    );
    expect(onConfirm.mock.calls[0][0]).toHaveLength(2);
  });

  it('can toggle checkboxes on and off', () => {
    render(
      <DeleteSessionDialog
        isOpen={true}
        sessionName="my-session"
        isManual={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const checkbox = screen.getByTestId('cleanup-workspace_storage');
    fireEvent.click(checkbox);
    fireEvent.click(checkbox); // toggle off
    fireEvent.click(screen.getByTestId('delete-session-confirm'));

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('calls onCancel when Cancel button clicked', () => {
    render(
      <DeleteSessionDialog
        isOpen={true}
        sessionName="my-session"
        isManual={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByTestId('delete-session-cancel'));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when backdrop clicked', () => {
    render(
      <DeleteSessionDialog
        isOpen={true}
        sessionName="my-session"
        isManual={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    // Backdrop is the second child of the overlay
    const overlay = screen.getByTestId('delete-session-dialog');
    const backdrop = overlay.children[0];
    fireEvent.click(backdrop);

    expect(onCancel).toHaveBeenCalled();
  });
});
