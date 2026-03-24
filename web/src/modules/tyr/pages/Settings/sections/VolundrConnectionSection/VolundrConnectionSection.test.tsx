import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VolundrConnectionSection } from './VolundrConnectionSection';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';

const mockConnection: IntegrationConnection = {
  id: 'conn-1',
  slug: '',
  integrationType: 'code_forge',
  adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
  credentialName: 'volundr-pat',
  config: { url: 'http://volundr' },
  enabled: true,
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-15T10:00:00Z',
};

describe('VolundrConnectionSection', () => {
  it('renders disconnected state with form', () => {
    render(
      <VolundrConnectionSection connection={null} onConnect={vi.fn()} onDisconnect={vi.fn()} />
    );

    expect(screen.getByText('Volundr')).toBeInTheDocument();
    expect(screen.getByLabelText('Volundr URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('renders connected state', () => {
    render(
      <VolundrConnectionSection
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('http://volundr')).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  it('calls onConnect with correct params', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <VolundrConnectionSection connection={null} onConnect={onConnect} onDisconnect={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Personal Access Token'), {
      target: { value: 'my-secret-pat' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith({
        integrationType: 'code_forge',
        adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
        credentialName: 'volundr-pat',
        credentialValue: 'my-secret-pat',
        config: { url: 'http://volundr' },
      });
    });
  });

  it('shows error when PAT is empty', async () => {
    render(
      <VolundrConnectionSection connection={null} onConnect={vi.fn()} onDisconnect={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(screen.getByText('PAT is required')).toBeInTheDocument();
    });
  });

  it('calls onDisconnect', async () => {
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <VolundrConnectionSection
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledWith('conn-1');
    });
  });

  it('shows error on connect failure', async () => {
    const onConnect = vi.fn().mockRejectedValue(new Error('Network error'));
    render(
      <VolundrConnectionSection connection={null} onConnect={onConnect} onDisconnect={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Personal Access Token'), {
      target: { value: 'token' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows error on disconnect failure', async () => {
    const onDisconnect = vi.fn().mockRejectedValue(new Error('Disconnect failed'));
    render(
      <VolundrConnectionSection
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(screen.getByText('Disconnect failed')).toBeInTheDocument();
    });
  });

  it('shows fallback error on non-Error connect failure', async () => {
    const onConnect = vi.fn().mockRejectedValue('string error');
    render(
      <VolundrConnectionSection connection={null} onConnect={onConnect} onDisconnect={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Personal Access Token'), {
      target: { value: 'token' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(screen.getByText('Failed to connect')).toBeInTheDocument();
    });
  });

  it('shows fallback error on non-Error disconnect failure', async () => {
    const onDisconnect = vi.fn().mockRejectedValue('string error');
    render(
      <VolundrConnectionSection
        connection={mockConnection}
        onConnect={vi.fn()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(screen.getByText('Failed to disconnect')).toBeInTheDocument();
    });
  });

  it('PAT input is password type', () => {
    render(
      <VolundrConnectionSection connection={null} onConnect={vi.fn()} onDisconnect={vi.fn()} />
    );

    const patInput = screen.getByLabelText('Personal Access Token');
    expect(patInput).toHaveAttribute('type', 'password');
  });
});
