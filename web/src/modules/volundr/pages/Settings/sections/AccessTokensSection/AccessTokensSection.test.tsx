import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccessTokensSection } from './AccessTokensSection';
import type { IVolundrService } from '@/modules/volundr/ports';
import type { PersonalAccessToken } from '@/modules/volundr/models';

const mockServiceRef = { current: {} as IVolundrService };

vi.mock('@/modules/volundr/adapters', () => ({
  get volundrService() {
    return mockServiceRef.current;
  },
}));

const mockTokens: PersonalAccessToken[] = [
  {
    id: 'tok-1',
    name: 'CI Pipeline',
    createdAt: '2026-01-15T10:00:00Z',
    lastUsedAt: '2026-03-20T08:00:00Z',
  },
  {
    id: 'tok-2',
    name: 'Local Dev',
    createdAt: '2026-02-01T09:00:00Z',
    lastUsedAt: null,
  },
];

function createMockService(overrides: Partial<IVolundrService> = {}): IVolundrService {
  return {
    listTokens: vi.fn().mockResolvedValue(mockTokens),
    createToken: vi.fn().mockResolvedValue({
      id: 'tok-new',
      name: 'New Token',
      token: 'pat_raw_secret_123',
      createdAt: '2026-03-23T12:00:00Z',
    }),
    revokeToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IVolundrService;
}

describe('AccessTokensSection', () => {
  let service: IVolundrService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = createMockService();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders loading state initially', () => {
    service = createMockService({
      listTokens: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    mockServiceRef.current = service;
    render(<AccessTokensSection />);
    expect(screen.getByText('Loading tokens...')).toBeDefined();
  });

  it('renders empty state when no tokens', async () => {
    service = createMockService({
      listTokens: vi.fn().mockResolvedValue([]),
    });
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'No access tokens. Create one to allow external services like Tyr to authenticate as you.'
        )
      ).toBeDefined();
    });
  });

  it('renders token list from API', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });
    expect(screen.getByText('Local Dev')).toBeDefined();
  });

  it('shows creation date and last used for tokens', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    // The first token has lastUsedAt
    const ciRow = screen.getByText('CI Pipeline').closest('div')!.parentElement!;
    expect(ciRow.textContent).toContain('Created');
    expect(ciRow.textContent).toContain('Last used');
  });

  it('shows create form when New Token is clicked', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    expect(screen.getByPlaceholderText('Token name')).toBeDefined();
  });

  it('disables Create button when name is empty', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    const createBtn = screen.getByText('Create');
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Create button when name is entered', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    const input = screen.getByPlaceholderText('Token name');
    fireEvent.change(input, { target: { value: 'My Token' } });

    const createBtn = screen.getByText('Create');
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('create flow: form submit shows overlay, done closes and refreshes', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    // Open form and type a name
    fireEvent.click(screen.getByText('New Token'));
    const input = screen.getByPlaceholderText('Token name');
    fireEvent.change(input, { target: { value: 'My Token' } });
    fireEvent.click(screen.getByText('Create'));

    // Overlay should appear with the raw token
    await waitFor(() => {
      expect(screen.getByText('pat_raw_secret_123')).toBeDefined();
    });
    expect(screen.getByText('Token Created')).toBeDefined();

    // Click Done to close overlay and trigger refresh
    fireEvent.click(screen.getByText('Done'));

    await waitFor(() => {
      expect(screen.queryByText('pat_raw_secret_123')).toBeNull();
    });

    // Refresh should have been called (initial load + after done)
    expect(service.listTokens).toHaveBeenCalledTimes(2);
  });

  it('shows create error when API fails', async () => {
    service = createMockService({
      createToken: vi.fn().mockRejectedValue(new Error('Duplicate name')),
    });
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    fireEvent.change(screen.getByPlaceholderText('Token name'), {
      target: { value: 'Dup' },
    });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText('Duplicate name')).toBeDefined();
    });
  });

  it('revoke: row removed on success', async () => {
    // After revoke, listTokens returns only the second token
    const listTokensFn = vi
      .fn()
      .mockResolvedValueOnce(mockTokens)
      .mockResolvedValueOnce([mockTokens[1]]);

    service = createMockService({
      listTokens: listTokensFn,
    });

    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Revoke CI Pipeline'));

    await waitFor(() => {
      expect(screen.queryByText('CI Pipeline')).toBeNull();
    });
    expect(service.revokeToken).toHaveBeenCalledWith('tok-1');
  });

  it('revoke: row retained with error on failure', async () => {
    service = createMockService({
      revokeToken: vi.fn().mockRejectedValue(new Error('Not authorized')),
    });

    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Revoke CI Pipeline'));

    await waitFor(() => {
      expect(screen.getByText('Not authorized')).toBeDefined();
    });
    // Row should still be visible
    expect(screen.getByText('CI Pipeline')).toBeDefined();
  });

  it('hides form on Cancel click', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    expect(screen.getByPlaceholderText('Token name')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Token name')).toBeNull();
  });

  it('submits create form on Enter key', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    const input = screen.getByPlaceholderText('Token name');
    fireEvent.change(input, { target: { value: 'Enter Token' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('pat_raw_secret_123')).toBeDefined();
    });
    expect(service.createToken).toHaveBeenCalledWith('Enter Token');
  });

  it('does not submit on Enter when name is empty', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    const input = screen.getByPlaceholderText('Token name');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(service.createToken).not.toHaveBeenCalled();
    });
  });

  it('shows fallback error when create rejects with non-Error', async () => {
    service = createMockService({
      createToken: vi.fn().mockRejectedValue('string error'),
    });
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    fireEvent.change(screen.getByPlaceholderText('Token name'), {
      target: { value: 'Test' },
    });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText('Failed to create token')).toBeDefined();
    });
  });

  it('shows fallback error when revoke rejects with non-Error', async () => {
    service = createMockService({
      revokeToken: vi.fn().mockRejectedValue('revoke failed'),
    });

    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Revoke CI Pipeline'));

    await waitFor(() => {
      expect(screen.getByText('Failed to revoke token')).toBeDefined();
    });
    expect(screen.getByText('CI Pipeline')).toBeDefined();
  });

  it('handles listTokens failure gracefully', async () => {
    service = createMockService({
      listTokens: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    // Loading should eventually resolve (error state doesn't show loading)
    await waitFor(() => {
      expect(screen.queryByText('Loading tokens...')).toBeNull();
    });
  });

  it('does not ignore non-Enter key presses', async () => {
    mockServiceRef.current = service;
    render(<AccessTokensSection />);

    await waitFor(() => {
      expect(screen.getByText('CI Pipeline')).toBeDefined();
    });

    fireEvent.click(screen.getByText('New Token'));
    const input = screen.getByPlaceholderText('Token name');
    fireEvent.change(input, { target: { value: 'Test' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(service.createToken).not.toHaveBeenCalled();
  });
});
