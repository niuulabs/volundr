import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileManager } from './FileManager';
import type { FileTreeEntry } from '@/models';

const mockEntries: FileTreeEntry[] = [
  { name: 'src', path: 'src', type: 'directory', size: 4096, modified: '2026-03-19T10:00:00Z' },
  {
    name: 'README.md',
    path: 'README.md',
    type: 'file',
    size: 1234,
    modified: '2026-03-18T12:00:00Z',
  },
  {
    name: 'package.json',
    path: 'package.json',
    type: 'file',
    size: 567,
    modified: '2026-03-17T08:00:00Z',
  },
];

const CHAT_ENDPOINT = 'wss://localhost:8080/s/test-session/session';

vi.mock('@/adapters/api/client', () => ({
  getAccessToken: vi.fn(() => 'mock-token'),
}));

function mockFetchResponses(overrides: Partial<Record<string, () => Promise<Response>>> = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : '';

    if (overrides[urlStr]) {
      return overrides[urlStr]!();
    }

    // List files
    if (
      urlStr.includes('/api/files') &&
      !urlStr.includes('/download') &&
      !urlStr.includes('/upload') &&
      !urlStr.includes('/mkdir') &&
      (!init || init.method === undefined || init.method === 'GET')
    ) {
      return Promise.resolve(
        new Response(JSON.stringify({ entries: mockEntries }), { status: 200 })
      );
    }

    // Download
    if (urlStr.includes('/api/files/download')) {
      return Promise.resolve(new Response('content', { status: 200 }));
    }

    // Upload
    if (urlStr.includes('/api/files/upload')) {
      return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    }

    // Mkdir
    if (urlStr.includes('/api/files/mkdir')) {
      return Promise.resolve(
        new Response(JSON.stringify({ name: 'new-dir', path: 'new-dir', type: 'directory' }), {
          status: 200,
        })
      );
    }

    // Delete
    if (init?.method === 'DELETE') {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }

    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as unknown as typeof fetch;
}

describe('FileManager', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = mockFetchResponses();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders file entries after loading', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('package.json')).toBeTruthy();
  });

  it('fetches files with workspace root by default', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/files?root=workspace'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mock-token' }),
      })
    );
  });

  it('switches to home root when Home button is clicked', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Home'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('root=home'),
        expect.any(Object)
      );
    });
  });

  it('navigates into a directory when clicked', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('path=src'),
        expect.any(Object)
      );
    });
  });

  it('selects a file when clicked', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    const row = screen.getByText('README.md').closest('[role="button"]');
    expect(row).toBeTruthy();
  });

  it('shows empty state when directory is empty', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('Empty directory')).toBeTruthy();
    });
  });

  it('opens new folder dialog and creates directory', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('New Folder'));
    expect(screen.getByText('New Folder', { selector: 'div' })).toBeTruthy();

    const input = screen.getByTestId('mkdir-input');
    fireEvent.change(input, { target: { value: 'new-dir' } });
    fireEvent.click(screen.getByTestId('mkdir-submit'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/mkdir'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('new-dir'),
        })
      );
    });
  });

  it('calls delete when delete is clicked on a selected file', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('path=README.md'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  it('has an upload button in the toolbar', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    expect(screen.getByTitle('Upload')).toBeTruthy();
  });

  it('triggers file input when upload button is clicked', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByTitle('Upload'));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('uploads files via file input', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const input = screen.getByTestId('file-input');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/upload'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('shows upload status after uploading', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const input = screen.getByTestId('file-input');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('test.txt')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy();
    });
  });

  it('shows upload count in upload bar', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const input = screen.getByTestId('file-input');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('Uploads (1/1)')).toBeTruthy();
    });
  });

  it('clears finished uploads when Clear is clicked', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const input = screen.getByTestId('file-input');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('Clear')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByText('test.txt')).toBeNull();
  });

  it('renders breadcrumb navigation', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('workspace')).toBeTruthy();
    });
  });

  it('navigates back via breadcrumb', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('path=src'),
        expect.any(Object)
      );
    });
    fireEvent.click(screen.getByText('workspace'));
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1][0] as string;
      expect(lastCall).toContain('/api/files?root=workspace');
      expect(lastCall).not.toContain('path=');
    });
  });

  it('calls download when download is clicked', async () => {
    const mockUrl = 'blob:mock-url';
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue(mockUrl);
    URL.revokeObjectURL = vi.fn();

    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    fireEvent.click(screen.getByTitle('Download'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/download'),
        expect.any(Object)
      );
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('refreshes entries when refresh button is clicked', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('disables download button when no file is selected', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    const downloadBtn = screen.getByTitle('Download');
    expect(downloadBtn).toHaveProperty('disabled', true);
  });

  it('disables delete button when nothing is selected', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    const deleteBtn = screen.getByTitle('Delete');
    expect(deleteBtn).toHaveProperty('disabled', true);
  });

  it('displays file sizes in human-readable format', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('1.2 KB')).toBeTruthy();
    });
  });

  it('deselects a file when clicking the same file again', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    fireEvent.click(screen.getByText('README.md'));
    const downloadBtn = screen.getByTitle('Download');
    expect(downloadBtn).toHaveProperty('disabled', true);
  });

  it('handles fetchEntries error by setting entries to empty', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('Empty directory')).toBeTruthy();
    });
  });

  it('does nothing when handleDownload is called with no selection', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    const downloadBtn = screen.getByTitle('Download');
    fireEvent.click(downloadBtn);
    // Only the list fetch should have been called, not download
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const downloadCalls = calls.filter((c: unknown[]) => (c[0] as string).includes('/download'));
      expect(downloadCalls).toHaveLength(0);
    });
  });

  it('shows error message when download fails', async () => {
    global.fetch = mockFetchResponses();
    const originalFetchFn = global.fetch as ReturnType<typeof vi.fn>;
    const origImpl = originalFetchFn.getMockImplementation();
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/download')) {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      return origImpl!(url, init);
    }) as unknown as typeof fetch;

    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    fireEvent.click(screen.getByTitle('Download'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('Download failed (500)')).toBeTruthy();
    });
  });

  it('dismisses error when Dismiss is clicked', async () => {
    global.fetch = mockFetchResponses();
    const originalFetchFn = global.fetch as ReturnType<typeof vi.fn>;
    const origImpl = originalFetchFn.getMockImplementation();
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/download')) {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      return origImpl!(url, init);
    }) as unknown as typeof fetch;

    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    fireEvent.click(screen.getByTitle('Download'));
    await waitFor(() => {
      expect(screen.getByText('Dismiss')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does nothing when handleDelete is called with no selection', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    const deleteBtn = screen.getByTitle('Delete');
    fireEvent.click(deleteBtn);
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const deleteCalls = calls.filter((c: unknown[]) => (c[1] as RequestInit)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });

  it('shows error message when delete fails', async () => {
    const baseFetch = mockFetchResponses();
    const baseFetchImpl = (baseFetch as ReturnType<typeof vi.fn>).getMockImplementation()!;
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.reject(new Error('Delete failed'));
      }
      return baseFetchImpl(url, init);
    }) as unknown as typeof fetch;

    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('Delete failed')).toBeTruthy();
    });
  });

  it('does nothing when handleMkdir is called with empty name', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('New Folder'));
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTestId('mkdir-submit'));
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const mkdirCalls = calls.filter((c: unknown[]) => (c[0] as string).includes('/mkdir'));
    expect(mkdirCalls).toHaveLength(0);
  });

  it('shows error message when mkdir fails', async () => {
    const baseFetch = mockFetchResponses();
    const baseFetchImpl = (baseFetch as ReturnType<typeof vi.fn>).getMockImplementation()!;
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/mkdir')) {
        return Promise.reject(new Error('Mkdir failed'));
      }
      return baseFetchImpl(url, init);
    }) as unknown as typeof fetch;

    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('New Folder'));
    const input = screen.getByTestId('mkdir-input');
    fireEvent.change(input, { target: { value: 'fail-dir' } });
    fireEvent.click(screen.getByTestId('mkdir-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('handles upload failure by setting status to error', async () => {
    const baseFetch = mockFetchResponses();
    const baseFetchImpl = (baseFetch as ReturnType<typeof vi.fn>).getMockImplementation()!;
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/upload')) {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      return baseFetchImpl(url, init);
    }) as unknown as typeof fetch;

    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const input = screen.getByTestId('file-input');
    const file = new File(['hello'], 'bad-file.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('bad-file.txt')).toBeTruthy();
    });
  });

  it('does not upload when file input change has no files', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const input = screen.getByTestId('file-input');
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(input, { target: { files: null } });
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const uploadCalls = calls.filter((c: unknown[]) => (c[0] as string).includes('/upload'));
    expect(uploadCalls).toHaveLength(0);
  });

  it('handles Enter keydown on file row', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    const row = screen.getByText('README.md').closest('[role="button"]')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    const downloadBtn = screen.getByTitle('Download');
    expect(downloadBtn).toHaveProperty('disabled', false);
  });

  it('handles Enter keydown on mkdir input to submit', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('New Folder'));
    const input = screen.getByTestId('mkdir-input');
    fireEvent.change(input, { target: { value: 'enter-dir' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/mkdir'),
        expect.any(Object)
      );
    });
  });

  it('handles Escape keydown on mkdir input to close dialog', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('New Folder'));
    const input = screen.getByTestId('mkdir-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('mkdir-input')).toBeNull();
  });

  it('renders entry with null size as empty string', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            {
              name: 'no-size.txt',
              path: 'no-size.txt',
              type: 'file',
              size: null,
              modified: '2026-03-19T10:00:00Z',
            },
          ],
        }),
        { status: 200 }
      )
    );
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('no-size.txt')).toBeTruthy();
    });
  });

  it('renders entry with no modified date as empty string', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            { name: 'no-date.txt', path: 'no-date.txt', type: 'file', size: 100, modified: '' },
          ],
        }),
        { status: 200 }
      )
    );
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('no-date.txt')).toBeTruthy();
    });
  });

  it('formats 0 bytes correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            {
              name: 'empty.txt',
              path: 'empty.txt',
              type: 'file',
              size: 0,
              modified: '2026-03-19T10:00:00Z',
            },
          ],
        }),
        { status: 200 }
      )
    );
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    await waitFor(() => {
      expect(screen.getByText('0 B')).toBeTruthy();
    });
  });

  it('does nothing when chatEndpoint is null', async () => {
    render(<FileManager chatEndpoint={null} />);
    // Should show empty directory since no fetch is made
    await waitFor(() => {
      expect(screen.getByText('Empty directory')).toBeTruthy();
    });
  });

  it('supports drag and drop on the whole container', async () => {
    render(<FileManager chatEndpoint={CHAT_ENDPOINT} />);
    const container = screen.getByText('workspace').closest('[class*="container"]')!;
    const file = new File(['hello'], 'dropped.txt', { type: 'text/plain' });
    fireEvent.dragOver(container, { dataTransfer: { files: [file] } });
    fireEvent.drop(container, { dataTransfer: { files: [file] } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/files/upload'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
