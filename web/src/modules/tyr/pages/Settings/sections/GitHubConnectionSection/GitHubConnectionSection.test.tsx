import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GitHubConnectionSection } from './GitHubConnectionSection';
import type { TyrIntegrationConnection } from '@/modules/tyr/ports';

const mockConnection: TyrIntegrationConnection = {
  id: 'conn-2',
  integration_type: 'source_control',
  adapter: 'tyr.adapters.git.github.GitHubAdapter',
  credential_name: 'github-pat',
  config: { org: 'niuulabs' },
  enabled: true,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
};

describe('GitHubConnectionSection', () => {
  it('renders disconnected state with form', () => {
    render(
      <GitHubConnectionSection connection={null} onConnect={vi.fn()} onDisconnect={vi.fn()} />
    );

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument();
    expect(screen.getByLabelText('Organisation (optional)')).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('renders connected state', () => {
    render(
      <GitHubConnectionSection
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('org: niuulabs')).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  it('calls onConnect with correct params', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <GitHubConnectionSection connection={null} onConnect={onConnect} onDisconnect={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Personal Access Token'), {
      target: { value: 'ghp_abc123' },
    });
    fireEvent.change(screen.getByLabelText('Organisation (optional)'), {
      target: { value: 'niuulabs' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith({
        integration_type: 'source_control',
        adapter: 'tyr.adapters.git.github.GitHubAdapter',
        credential_name: 'github-pat',
        credential_value: 'ghp_abc123',
        config: { org: 'niuulabs' },
      });
    });
  });

  it('shows error when PAT is empty', async () => {
    render(
      <GitHubConnectionSection connection={null} onConnect={vi.fn()} onDisconnect={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(screen.getByText('GitHub PAT is required')).toBeInTheDocument();
    });
  });

  it('calls onDisconnect', async () => {
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <GitHubConnectionSection
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledWith('conn-2');
    });
  });

  it('shows error on failure', async () => {
    const onConnect = vi.fn().mockRejectedValue(new Error('Auth failed'));
    render(
      <GitHubConnectionSection connection={null} onConnect={onConnect} onDisconnect={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Personal Access Token'), {
      target: { value: 'ghp_x' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(screen.getByText('Auth failed')).toBeInTheDocument();
    });
  });

  it('sends empty config when org is blank', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <GitHubConnectionSection connection={null} onConnect={onConnect} onDisconnect={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Personal Access Token'), {
      target: { value: 'ghp_abc' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ config: {} }));
    });
  });
});
