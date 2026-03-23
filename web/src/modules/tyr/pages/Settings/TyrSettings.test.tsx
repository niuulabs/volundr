import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TyrSettings } from './TyrSettings';
import type { ITyrIntegrationService, TyrIntegrationConnection } from '@/modules/tyr/ports';

const volundrConn: TyrIntegrationConnection = {
  id: 'v-1',
  integration_type: 'code_forge',
  adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
  credential_name: 'volundr-pat',
  config: { url: 'http://volundr' },
  enabled: true,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
};

const githubConn: TyrIntegrationConnection = {
  id: 'g-1',
  integration_type: 'source_control',
  adapter: 'tyr.adapters.git.github.GitHubAdapter',
  credential_name: 'github-pat',
  config: { org: 'niuulabs' },
  enabled: true,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
};

function mockService(
  connections: TyrIntegrationConnection[] = [],
): ITyrIntegrationService {
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
    expect(screen.getByText('Loading integrations...')).toBeInTheDocument();
  });

  it('renders all three sections when no connections', async () => {
    render(<TyrSettings service={mockService()} />);

    await waitFor(() => {
      expect(screen.getByText('Volundr')).toBeInTheDocument();
      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('Telegram')).toBeInTheDocument();
    });
  });

  it('shows connected state for existing connections', async () => {
    render(<TyrSettings service={mockService([volundrConn, githubConn])} />);

    await waitFor(() => {
      const badges = screen.getAllByText('Connected');
      expect(badges).toHaveLength(2);
    });
  });

  it('renders page heading', async () => {
    render(<TyrSettings service={mockService()} />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Manage your integration connections')).toBeInTheDocument();
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
