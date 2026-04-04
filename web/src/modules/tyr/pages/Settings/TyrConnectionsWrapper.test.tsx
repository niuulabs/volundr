import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TyrConnectionsWrapper } from './TyrConnectionsWrapper';

vi.mock('@/modules/tyr/adapters', () => ({
  tyrIntegrationService: {
    listIntegrations: vi.fn().mockResolvedValue([]),
    createIntegration: vi.fn(),
    deleteIntegration: vi.fn(),
    toggleIntegration: vi.fn(),
    getTelegramSetup: vi.fn(),
  },
}));

describe('TyrConnectionsWrapper', () => {
  it('renders TyrSettings', async () => {
    render(<TyrConnectionsWrapper />);

    expect(await screen.findByText('Tyr Connections')).toBeDefined();
  });
});
