import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TyrSettings } from './TyrSettings';
import type { ITyrIntegrationService } from '@/modules/tyr/ports';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';

const volundrConn: IntegrationConnection = {
  id: 'v-1',
  integrationType: 'code_forge',
  adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
  credentialName: 'volundr-pat',
  config: { url: 'http://volundr' },
  enabled: true,
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-15T10:00:00Z',
  slug: '',
};

function mockService(connections: IntegrationConnection[] = []): ITyrIntegrationService {
  return {
    listIntegrations: vi.fn().mockResolvedValue(connections),
    createIntegration: vi.fn().mockResolvedValue(connections[0] ?? volundrConn),
    deleteIntegration: vi.fn().mockResolvedValue(undefined),
    toggleIntegration: vi.fn().mockResolvedValue(connections[0] ?? volundrConn),
    getTelegramSetup: vi.fn().mockResolvedValue({
      deeplink: 'https://t.me/TyrBot?start=tok',
      token: 'tok',
    }),
  };
}

describe('TyrSettings', () => {
  it('shows loading state initially', () => {
    render(<TyrSettings service={mockService()} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders volundr connection section', async () => {
    render(<TyrSettings service={mockService()} />);

    await waitFor(() => {
      expect(screen.getByText('Volundr')).toBeInTheDocument();
    });
  });

  it('shows connected state for existing connection', async () => {
    render(<TyrSettings service={mockService([volundrConn])} />);

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });
  });

  it('renders page heading', async () => {
    render(<TyrSettings service={mockService()} />);

    await waitFor(() => {
      expect(screen.getByText('Tyr Connections')).toBeInTheDocument();
    });
  });

  it('shows error from service', async () => {
    const service = {
      ...mockService(),
      listIntegrations: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    render(<TyrSettings service={service} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
