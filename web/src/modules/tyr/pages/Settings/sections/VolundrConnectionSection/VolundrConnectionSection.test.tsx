import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VolundrConnectionSection } from './VolundrConnectionSection';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { ITyrIntegrationService } from '@/modules/tyr/ports';

const mockConnection: IntegrationConnection = {
  id: 'conn-1',
  slug: '',
  integrationType: 'code_forge',
  adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
  credentialName: 'volundr-pat',
  config: { url: 'http://volundr', name: 'production' },
  enabled: true,
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-15T10:00:00Z',
};

const mockConnection2: IntegrationConnection = {
  id: 'conn-2',
  slug: 'staging',
  integrationType: 'code_forge',
  adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
  credentialName: 'volundr-pat',
  config: { url: 'http://volundr-staging' },
  enabled: true,
  createdAt: '2026-01-20T10:00:00Z',
  updatedAt: '2026-01-20T10:00:00Z',
};

const mockService: ITyrIntegrationService = {
  listIntegrations: vi.fn().mockResolvedValue([]),
  createIntegration: vi.fn().mockResolvedValue(mockConnection),
  deleteIntegration: vi.fn().mockResolvedValue(undefined),
  toggleIntegration: vi.fn().mockResolvedValue(mockConnection),
  testConnection: vi.fn().mockResolvedValue({ success: true, message: 'OK' }),
  getTelegramSetup: vi.fn().mockResolvedValue({ deeplink: '', token: '' }),
};

describe('VolundrConnectionSection', () => {
  it('renders disconnected state with form when no connections', () => {
    render(
      <VolundrConnectionSection
        connections={[]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    expect(screen.getByText('Volundr Clusters')).toBeInTheDocument();
    expect(screen.getByLabelText('Volundr URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('renders connected state for single connection', () => {
    render(
      <VolundrConnectionSection
        connections={[mockConnection]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/production/)).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
    expect(screen.getByText('Add another cluster')).toBeInTheDocument();
  });

  it('renders multiple connected clusters', () => {
    render(
      <VolundrConnectionSection
        connections={[mockConnection, mockConnection2]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    const badges = screen.getAllByText('Connected');
    expect(badges).toHaveLength(2);
    expect(screen.getByText(/production/)).toBeInTheDocument();
    expect(screen.getByText(/staging/)).toBeInTheDocument();
    expect(screen.getAllByText('Disconnect')).toHaveLength(2);
    expect(screen.getByText('Add another cluster')).toBeInTheDocument();
  });

  it('calls onConnect with correct params', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <VolundrConnectionSection
        connections={[]}
        onConnect={onConnect}
        onDisconnect={vi.fn()}
        service={mockService}
      />
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
      <VolundrConnectionSection
        connections={[]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
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
        connections={[mockConnection]}
        onConnect={vi.fn()}
        onDisconnect={onDisconnect}
        service={mockService}
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
      <VolundrConnectionSection
        connections={[]}
        onConnect={onConnect}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    fireEvent.change(screen.getByLabelText('Personal Access Token'), {
      target: { value: 'token' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('PAT input is password type', () => {
    render(
      <VolundrConnectionSection
        connections={[]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    const patInput = screen.getByLabelText('Personal Access Token');
    expect(patInput).toHaveAttribute('type', 'password');
  });

  it('shows add form when button clicked', async () => {
    render(
      <VolundrConnectionSection
        connections={[mockConnection]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    // Form should not be visible initially
    expect(screen.queryByLabelText('Volundr URL')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add another cluster'));

    expect(screen.getByLabelText('Volundr URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Personal Access Token')).toBeInTheDocument();
  });

  it('shows test connection button for connected clusters', () => {
    render(
      <VolundrConnectionSection
        connections={[mockConnection]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    expect(screen.getByText('Test Connection')).toBeInTheDocument();
  });

  it('runs test connection and shows result', async () => {
    render(
      <VolundrConnectionSection
        connections={[mockConnection]}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        service={mockService}
      />
    );

    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(screen.getByText('OK')).toBeInTheDocument();
    });
  });
});
