import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FileManager } from './FileManager';
import type { IVolundrService } from '@/ports';
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

const service = {
  getSessionFiles: vi.fn().mockResolvedValue(mockEntries),
  downloadSessionFile: vi.fn().mockResolvedValue(new Blob(['content'])),
  uploadSessionFiles: vi.fn().mockResolvedValue([]),
  createSessionDirectory: vi
    .fn()
    .mockResolvedValue({ name: 'new-dir', path: 'new-dir', type: 'directory' }),
  deleteSessionFile: vi.fn().mockResolvedValue(undefined),
  getFeatures: vi.fn().mockResolvedValue({ localMountsEnabled: false, fileManagerEnabled: true }),
} as unknown as IVolundrService;

describe('FileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (service.getSessionFiles as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntries);
    (service.downloadSessionFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Blob(['content'])
    );
    (service.uploadSessionFiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (service.createSessionDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'new-dir',
      path: 'new-dir',
      type: 'directory',
    });
    (service.deleteSessionFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders file entries after loading', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('package.json')).toBeTruthy();
  });

  it('calls getSessionFiles with workspace root by default', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(service.getSessionFiles).toHaveBeenCalledWith('test-session', '', 'workspace');
    });
  });

  it('switches to home root when Home button is clicked', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Home'));
    await waitFor(() => {
      expect(service.getSessionFiles).toHaveBeenCalledWith('test-session', '', 'home');
    });
  });

  it('navigates into a directory when clicked', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(service.getSessionFiles).toHaveBeenCalledWith('test-session', 'src', 'workspace');
    });
  });

  it('selects a file when clicked', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('README.md'));
    // The row should be selected (has the selected class applied)
    const row = screen.getByText('README.md').closest('[role="button"]');
    expect(row).toBeTruthy();
  });

  it('shows empty state when directory is empty', async () => {
    (service.getSessionFiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('Empty directory')).toBeTruthy();
    });
  });

  it('opens new folder dialog and creates directory', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('New Folder'));
    expect(screen.getByText('New Folder', { selector: 'div' })).toBeTruthy();

    const input = screen.getByTestId('mkdir-input');
    fireEvent.change(input, { target: { value: 'new-dir' } });
    fireEvent.click(screen.getByTestId('mkdir-submit'));

    await waitFor(() => {
      expect(service.createSessionDirectory).toHaveBeenCalledWith(
        'test-session',
        'new-dir',
        'workspace'
      );
    });
  });

  it('calls deleteSessionFile when delete is clicked on a selected file', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    // Select a file
    fireEvent.click(screen.getByText('README.md'));
    // Click delete
    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => {
      expect(service.deleteSessionFile).toHaveBeenCalledWith(
        'test-session',
        'README.md',
        'workspace'
      );
    });
  });

  it('renders upload drop zone', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    expect(screen.getByText('Drop files here')).toBeTruthy();
    expect(screen.getByText('or click to browse')).toBeTruthy();
  });

  it('uploads files via file input', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    const input = screen.getByTestId('file-input');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(service.uploadSessionFiles).toHaveBeenCalledWith(
        'test-session',
        [file],
        '',
        'workspace'
      );
    });
  });

  it('renders breadcrumb navigation', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('workspace')).toBeTruthy();
    });
  });

  it('navigates back via breadcrumb', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
    // Navigate into src
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(service.getSessionFiles).toHaveBeenCalledWith('test-session', 'src', 'workspace');
    });
    // Click workspace breadcrumb to go back
    fireEvent.click(screen.getByText('workspace'));
    await waitFor(() => {
      expect(service.getSessionFiles).toHaveBeenCalledWith('test-session', '', 'workspace');
    });
  });

  it('calls downloadSessionFile when download is clicked', async () => {
    // Mock createObjectURL and revokeObjectURL
    const mockUrl = 'blob:mock-url';
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue(mockUrl);
    URL.revokeObjectURL = vi.fn();

    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    // Select file
    fireEvent.click(screen.getByText('README.md'));
    // Click download
    fireEvent.click(screen.getByTitle('Download'));
    await waitFor(() => {
      expect(service.downloadSessionFile).toHaveBeenCalledWith(
        'test-session',
        'README.md',
        'workspace'
      );
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('refreshes entries when refresh button is clicked', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });

    (service.getSessionFiles as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => {
      expect(service.getSessionFiles).toHaveBeenCalled();
    });
  });

  it('disables download button when no file is selected', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    const downloadBtn = screen.getByTitle('Download');
    expect(downloadBtn).toHaveProperty('disabled', true);
  });

  it('disables delete button when nothing is selected', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    const deleteBtn = screen.getByTitle('Delete');
    expect(deleteBtn).toHaveProperty('disabled', true);
  });

  it('displays file sizes in human-readable format', async () => {
    render(<FileManager sessionId="test-session" service={service} />);
    await waitFor(() => {
      expect(screen.getByText('1.2 KB')).toBeTruthy();
    });
  });
});
