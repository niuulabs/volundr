import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TyrConnectionsWrapper } from './TyrConnectionsWrapper';
import type { IVolundrService } from '@/modules/volundr/ports';

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
    const mockService = {} as IVolundrService;
    render(<TyrConnectionsWrapper service={mockService} />);

    expect(await screen.findByText('Settings')).toBeDefined();
  });
});
