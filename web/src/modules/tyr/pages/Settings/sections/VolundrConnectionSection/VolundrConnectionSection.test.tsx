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
  config: { url: 'http://volundr-staging', name: 'staging' },
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

function renderSection(overrides: Partial<Parameters<typeof VolundrConnectionSection>[0]> = {}) {
  const props = {
    connections: [],
    onConnect: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn().mockResolvedValue(undefined),
    service: mockService,
    showForm: false,
    onShowFormChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<VolundrConnectionSection {...props} />), props };
}

describe('VolundrConnectionSection', () => {
  it('renders empty state when no connections and form hidden', () => {
    renderSection({ connections: [] });
    expect(screen.getByText('No clusters connected')).toBeInTheDocument();
  });

  it('renders form when showForm is true', () => {
    renderSection({ showForm: true });
    expect(screen.getByText('Add Volundr Cluster')).toBeInTheDocument();
    expect(screen.getByText('Cluster Name')).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('renders connected state for single connection', () => {
    renderSection({ connections: [mockConnection] });
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/production/)).toBeInTheDocument();
  });

  it('renders multiple connected clusters', () => {
    renderSection({ connections: [mockConnection, mockConnection2] });
    const badges = screen.getAllByText('Connected');
    expect(badges).toHaveLength(2);
    expect(screen.getByText(/production/)).toBeInTheDocument();
    expect(screen.getAllByText(/staging/).length).toBeGreaterThanOrEqual(1);
  });

  it('disconnect button uses icon with title', () => {
    renderSection({ connections: [mockConnection] });
    expect(screen.getByTitle('Disconnect')).toBeInTheDocument();
  });

  it('test connection button uses icon with title', () => {
    renderSection({ connections: [mockConnection] });
    expect(screen.getByTitle('Test connection')).toBeInTheDocument();
  });

  it('calls onConnect with correct params', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    renderSection({ showForm: true, onConnect });

    fireEvent.change(screen.getByPlaceholderText('Paste your PAT'), {
      target: { value: 'my-secret-pat' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          integrationType: 'code_forge',
          credentialValue: 'my-secret-pat',
        })
      );
    });
  });

  it('sends cluster name and custom URL in config', async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    renderSection({ showForm: true, onConnect });

    fireEvent.change(screen.getByPlaceholderText('e.g. production, staging'), {
      target: { value: 'staging' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://volundr.example.com'), {
      target: { value: 'http://staging' },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste your PAT'), {
      target: { value: 'pat-123' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialValue: 'pat-123',
          config: { url: 'http://staging', name: 'staging' },
        })
      );
    });
  });

  it('connect button disabled when PAT is empty', () => {
    renderSection({ showForm: true });

    const btn = screen.getByText('Connect');
    expect(btn).toBeDisabled();
  });

  it('calls onDisconnect via icon button', async () => {
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    renderSection({ connections: [mockConnection], onDisconnect });

    fireEvent.click(screen.getByTitle('Disconnect'));

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledWith('conn-1');
    });
  });

  it('shows error on connect failure', async () => {
    const onConnect = vi.fn().mockRejectedValue(new Error('Network error'));
    renderSection({ showForm: true, onConnect });

    fireEvent.change(screen.getByPlaceholderText('Paste your PAT'), {
      target: { value: 'token' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('PAT input is password type', () => {
    renderSection({ showForm: true });
    const patInput = screen.getByPlaceholderText('Paste your PAT');
    expect(patInput).toHaveAttribute('type', 'password');
  });

  it('runs test connection and shows result', async () => {
    renderSection({ connections: [mockConnection] });

    fireEvent.click(screen.getByTitle('Test connection'));

    await waitFor(() => {
      expect(screen.getByText('OK')).toBeInTheDocument();
    });
  });

  it('calls onShowFormChange(false) on cancel', () => {
    const onShowFormChange = vi.fn();
    renderSection({ showForm: true, onShowFormChange });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onShowFormChange).toHaveBeenCalledWith(false);
  });
});
