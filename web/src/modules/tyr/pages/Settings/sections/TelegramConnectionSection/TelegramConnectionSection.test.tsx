import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TelegramConnectionSection } from './TelegramConnectionSection';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { ITyrIntegrationService } from '@/modules/tyr/ports';

const mockConnection: IntegrationConnection = {
  id: 'conn-3',
  slug: '',
  integrationType: 'messaging',
  adapter: 'tyr.adapters.telegram.TelegramAdapter',
  credentialName: 'telegram-chat',
  config: {},
  enabled: true,
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-15T10:00:00Z',
};

function mockService(overrides: Partial<ITyrIntegrationService> = {}): ITyrIntegrationService {
  return {
    listIntegrations: vi.fn().mockResolvedValue([]),
    createIntegration: vi.fn().mockResolvedValue(mockConnection),
    deleteIntegration: vi.fn().mockResolvedValue(undefined),
    toggleIntegration: vi.fn().mockResolvedValue(mockConnection),
    getTelegramSetup: vi.fn().mockResolvedValue({
      deeplink: 'https://t.me/TyrBot?start=token123',
      token: 'token123',
    }),
    ...overrides,
  };
}

describe('TelegramConnectionSection', () => {
  it('renders disconnected state with generate link button', () => {
    render(
      <TelegramConnectionSection connection={null} service={mockService()} onDisconnect={vi.fn()} />
    );

    expect(screen.getByText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Generate Link')).toBeInTheDocument();
  });

  it('renders connected state', () => {
    render(
      <TelegramConnectionSection
        connection={mockConnection}
        service={mockService()}
        onDisconnect={vi.fn()}
      />
    );

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  it('generates deeplink on button click', async () => {
    const service = mockService();
    render(
      <TelegramConnectionSection connection={null} service={service} onDisconnect={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Generate Link'));

    await waitFor(() => {
      expect(screen.getByText('Open in Telegram')).toBeInTheDocument();
    });
    expect(service.getTelegramSetup).toHaveBeenCalled();
  });

  it('deeplink opens in new tab', async () => {
    render(
      <TelegramConnectionSection connection={null} service={mockService()} onDisconnect={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Generate Link'));

    await waitFor(() => {
      const link = screen.getByText('Open in Telegram');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('href', 'https://t.me/TyrBot?start=token123');
    });
  });

  it('calls onDisconnect on disconnect', async () => {
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <TelegramConnectionSection
        connection={mockConnection}
        service={mockService()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledWith('conn-3');
    });
  });

  it('shows error on setup failure', async () => {
    const service = mockService({
      getTelegramSetup: vi.fn().mockRejectedValue(new Error('Bot unavailable')),
    });
    render(
      <TelegramConnectionSection connection={null} service={service} onDisconnect={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Generate Link'));

    await waitFor(() => {
      expect(screen.getByText('Bot unavailable')).toBeInTheDocument();
    });
  });

  it('shows fallback error on non-Error setup failure', async () => {
    const service = mockService({
      getTelegramSetup: vi.fn().mockRejectedValue('string error'),
    });
    render(
      <TelegramConnectionSection connection={null} service={service} onDisconnect={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Generate Link'));

    await waitFor(() => {
      expect(screen.getByText('Failed to generate link')).toBeInTheDocument();
    });
  });

  it('shows error on disconnect failure', async () => {
    const onDisconnect = vi.fn().mockRejectedValue(new Error('Disconnect failed'));
    render(
      <TelegramConnectionSection
        connection={mockConnection}
        service={mockService()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(screen.getByText('Disconnect failed')).toBeInTheDocument();
    });
  });

  it('shows fallback error on non-Error disconnect failure', async () => {
    const onDisconnect = vi.fn().mockRejectedValue('string error');
    render(
      <TelegramConnectionSection
        connection={mockConnection}
        service={mockService()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(screen.getByText('Failed to disconnect')).toBeInTheDocument();
    });
  });
});
