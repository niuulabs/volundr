import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { DotfileManager } from './DotfileManager';

vi.mock('@/adapters/api/client', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}));

describe('DotfileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  const mockDotfiles = {
    dotfiles: [
      { name: '.bashrc', exists: true, hasDefault: true, size: 512 },
      { name: '.zshrc', exists: false, hasDefault: true },
      { name: '.config/fish/config.fish', exists: true, hasDefault: true, size: 256 },
      { name: '.config/starship.toml', exists: true, hasDefault: true, size: 128 },
      { name: '.gitconfig', exists: false, hasDefault: false },
      { name: '.vimrc', exists: false, hasDefault: false },
    ],
  };

  const mockPreferences = { default_shell: 'bash' };

  function setupFetchMocks() {
    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDotfiles,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockPreferences,
      });
  }

  it('shows loading state initially', () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders dotfile list after loading', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('.bashrc')).toBeInTheDocument();
    expect(screen.getByText('.zshrc')).toBeInTheDocument();
    expect(screen.getByText('.config/fish/config.fish')).toBeInTheDocument();
    expect(screen.getByText('.gitconfig')).toBeInTheDocument();
  });

  it('renders shell preference buttons', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('zsh')).toBeInTheDocument();
    expect(screen.getByText('fish')).toBeInTheDocument();
  });

  it('highlights the active default shell', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('bash')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('zsh')).toHaveAttribute('data-active', 'false');
  });

  it('changes default shell on click', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock the preferences save
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, default_shell: 'zsh' }),
    });

    await act(async () => {
      fireEvent.click(screen.getByText('zsh'));
    });

    expect(screen.getByText('zsh')).toHaveAttribute('data-active', 'true');
  });

  it('shows upload button for all dotfiles', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const uploadButtons = screen.getAllByRole('button', { name: /upload/i });
    expect(uploadButtons.length).toBe(6);
  });

  it('shows delete button only for existing dotfiles', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    // .bashrc, .config/fish/config.fish, .config/starship.toml exist
    expect(deleteButtons.length).toBe(3);
  });

  it('calls delete endpoint when delete button is clicked', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock delete + subsequent reload
    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => mockDotfiles })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPreferences });

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    // Check DELETE was called
    const calls = (globalThis.fetch as Mock).mock.calls;
    const deleteCall = calls.find((c: unknown[]) => (c[1] as RequestInit)?.method === 'DELETE');
    expect(deleteCall).toBeTruthy();
  });

  it('shows file sizes for existing dotfiles', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('512B')).toBeInTheDocument();
    expect(screen.getByText('256B')).toBeInTheDocument();
  });

  it('handles fetch errors gracefully', async () => {
    (globalThis.fetch as Mock)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'));

    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should render without crashing, just empty
    expect(screen.getByText('Default Shell')).toBeInTheDocument();
  });
});
