import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { DotfileManager } from './DotfileManager';
import { getAccessToken } from '@/modules/volundr/adapters/api/client';

vi.mock('@/modules/volundr/adapters/api/client', () => ({
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

  it('returns empty list when fetchDotfiles response is not ok', async () => {
    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: false }) // dotfiles non-ok
      .mockResolvedValueOnce({ ok: true, json: async () => mockPreferences });

    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should render with no dotfiles listed (only section headers)
    expect(screen.getByText('Default Shell')).toBeInTheDocument();
    expect(screen.getByText('Dotfiles')).toBeInTheDocument();
    expect(screen.queryByText('.bashrc')).not.toBeInTheDocument();
  });

  it('returns empty list when dotfiles field is missing from response', async () => {
    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // no dotfiles key
      .mockResolvedValueOnce({ ok: true, json: async () => mockPreferences });

    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('Default Shell')).toBeInTheDocument();
    expect(screen.queryByText('.bashrc')).not.toBeInTheDocument();
  });

  it('returns default shell when fetchPreferences response is not ok', async () => {
    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => mockDotfiles })
      .mockResolvedValueOnce({ ok: false }); // preferences non-ok

    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should fall back to bash
    expect(screen.getByText('bash')).toHaveAttribute('data-active', 'true');
  });

  it('does not include Authorization header when token is null', async () => {
    (getAccessToken as Mock).mockReturnValue(null);

    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => mockDotfiles })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPreferences });

    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const firstCall = (globalThis.fetch as Mock).mock.calls[0];
    expect(firstCall[1].headers).not.toHaveProperty('Authorization');

    // Restore token for other tests
    (getAccessToken as Mock).mockReturnValue('test-token');
  });

  it('does not reload when delete fails (non-ok response)', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock delete returning non-ok, no reload mocks needed
    (globalThis.fetch as Mock).mockResolvedValueOnce({ ok: false });

    const fetchCallCountBefore = (globalThis.fetch as Mock).mock.calls.length;

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    // Only the DELETE call should have been made, no reload calls
    const fetchCallCountAfter = (globalThis.fetch as Mock).mock.calls.length;
    expect(fetchCallCountAfter - fetchCallCountBefore).toBe(1);
  });

  it('does not reload when delete throws a network error', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    (globalThis.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

    const fetchCallCountBefore = (globalThis.fetch as Mock).mock.calls.length;

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    const fetchCallCountAfter = (globalThis.fetch as Mock).mock.calls.length;
    expect(fetchCallCountAfter - fetchCallCountBefore).toBe(1);
  });

  it('handles upload flow with file input', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock upload success + reload
    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: true }) // upload
      .mockResolvedValueOnce({ ok: true, json: async () => mockDotfiles }) // reload dotfiles
      .mockResolvedValueOnce({ ok: true, json: async () => mockPreferences }); // reload prefs

    // Intercept document.createElement to capture the file input
    const originalCreateElement = document.createElement.bind(document);
    let capturedInput: HTMLInputElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'input') {
        capturedInput = el as HTMLInputElement;
      }
      return el;
    });

    const uploadButtons = screen.getAllByRole('button', { name: /upload/i });
    await act(async () => {
      fireEvent.click(uploadButtons[0]);
    });

    expect(capturedInput).not.toBeNull();

    // Simulate selecting a file
    const testFile = new File(['file content'], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(capturedInput!, 'files', { value: [testFile] });

    await act(async () => {
      capturedInput!.onchange!(new Event('change'));
      await new Promise(r => setTimeout(r, 10));
    });

    // Verify upload POST was made
    const calls = (globalThis.fetch as Mock).mock.calls;
    const uploadCall = calls.find(
      (c: unknown[]) =>
        (c[1] as RequestInit)?.method === 'POST' && (c[0] as string).includes('/dotfiles')
    );
    expect(uploadCall).toBeTruthy();

    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('does not reload when upload returns non-ok', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock upload failure
    (globalThis.fetch as Mock).mockResolvedValueOnce({ ok: false });

    const originalCreateElement = document.createElement.bind(document);
    let capturedInput: HTMLInputElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'input') {
        capturedInput = el as HTMLInputElement;
      }
      return el;
    });

    const uploadButtons = screen.getAllByRole('button', { name: /upload/i });
    await act(async () => {
      fireEvent.click(uploadButtons[0]);
    });

    const testFile = new File(['content'], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(capturedInput!, 'files', { value: [testFile] });

    const fetchCallCountBefore = (globalThis.fetch as Mock).mock.calls.length;

    await act(async () => {
      capturedInput!.onchange!(new Event('change'));
      await new Promise(r => setTimeout(r, 10));
    });

    // Only the upload call, no reload
    const fetchCallCountAfter = (globalThis.fetch as Mock).mock.calls.length;
    expect(fetchCallCountAfter - fetchCallCountBefore).toBe(1);

    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('handles upload when no file is selected', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const originalCreateElement = document.createElement.bind(document);
    let capturedInput: HTMLInputElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'input') {
        capturedInput = el as HTMLInputElement;
      }
      return el;
    });

    const uploadButtons = screen.getAllByRole('button', { name: /upload/i });
    await act(async () => {
      fireEvent.click(uploadButtons[0]);
    });

    // Simulate no file selected (empty files list)
    Object.defineProperty(capturedInput!, 'files', { value: [] });

    const fetchCallCountBefore = (globalThis.fetch as Mock).mock.calls.length;

    await act(async () => {
      capturedInput!.onchange!(new Event('change'));
      await new Promise(r => setTimeout(r, 10));
    });

    // No upload call should have been made
    const fetchCallCountAfter = (globalThis.fetch as Mock).mock.calls.length;
    expect(fetchCallCountAfter - fetchCallCountBefore).toBe(0);

    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('handles upload network error gracefully', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock upload throwing network error
    (globalThis.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

    const originalCreateElement = document.createElement.bind(document);
    let capturedInput: HTMLInputElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'input') {
        capturedInput = el as HTMLInputElement;
      }
      return el;
    });

    const uploadButtons = screen.getAllByRole('button', { name: /upload/i });
    await act(async () => {
      fireEvent.click(uploadButtons[0]);
    });

    const testFile = new File(['content'], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(capturedInput!, 'files', { value: [testFile] });

    await act(async () => {
      capturedInput!.onchange!(new Event('change'));
      await new Promise(r => setTimeout(r, 10));
    });

    // Should not crash, component still rendered
    expect(screen.getByText('Default Shell')).toBeInTheDocument();

    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('handles savePreferences non-ok response', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock save preferences returning non-ok
    (globalThis.fetch as Mock).mockResolvedValueOnce({ ok: false });

    await act(async () => {
      fireEvent.click(screen.getByText('zsh'));
    });

    // UI still updates optimistically
    expect(screen.getByText('zsh')).toHaveAttribute('data-active', 'true');
  });

  it('handles savePreferences network error', async () => {
    setupFetchMocks();
    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Mock save preferences throwing
    (globalThis.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      fireEvent.click(screen.getByText('fish'));
    });

    // Should not crash
    expect(screen.getByText('Default Shell')).toBeInTheDocument();
  });

  it('shows size only when exists=true and size is defined', async () => {
    const dotfilesWithUndefinedSize = {
      dotfiles: [
        { name: '.bashrc', exists: true, hasDefault: true }, // size undefined
        { name: '.zshrc', exists: true, hasDefault: true, size: 100 },
      ],
    };

    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => dotfilesWithUndefinedSize })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPreferences });

    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // .zshrc has size defined, should show
    expect(screen.getByText('100B')).toBeInTheDocument();
    // .bashrc has no size, should not show any size for it
    // Both entries exist, so both should have delete buttons
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteButtons.length).toBe(2);
  });

  it('shows Trash2 icon for exists=true and hasDefault=false', async () => {
    const dotfilesWithNoDefault = {
      dotfiles: [{ name: '.customrc', exists: true, hasDefault: false, size: 64 }],
    };

    (globalThis.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => dotfilesWithNoDefault })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPreferences });

    render(<DotfileManager httpBase="http://test" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should have a delete button with title "Delete" (not the default restore text)
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    expect(deleteButton).toHaveAttribute('title', 'Delete');
  });
});
