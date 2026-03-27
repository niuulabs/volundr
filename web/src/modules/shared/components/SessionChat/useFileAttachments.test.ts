import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileAttachments } from './useFileAttachments';

vi.mock('./compressImage', () => ({
  compressImage: vi.fn().mockResolvedValue({
    blob: new Blob(['compressed'], { type: 'image/jpeg' }),
    previewUrl: 'blob:preview-mock',
  }),
}));

beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:url'),
    revokeObjectURL: vi.fn(),
  });
});

describe('useFileAttachments', () => {
  it('starts with empty attachments and not dragging', () => {
    const { result } = renderHook(() => useFileAttachments());
    expect(result.current.attachments).toEqual([]);
    expect(result.current.isDragging).toBe(false);
  });

  it('addFiles adds non-image files without preview', async () => {
    const { result } = renderHook(() => useFileAttachments());
    const file = new File(['content'], 'readme.md', { type: 'text/markdown' });

    await act(async () => {
      await result.current.addFiles([file]);
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].name).toBe('readme.md');
    expect(result.current.attachments[0].previewUrl).toBeNull();
    expect(result.current.attachments[0].compressed).toBeNull();
  });

  it('addFiles processes image files with compression', async () => {
    const { result } = renderHook(() => useFileAttachments());
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await result.current.addFiles([file]);
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].name).toBe('photo.jpg');
    expect(result.current.attachments[0].previewUrl).toBe('blob:preview-mock');
    expect(result.current.attachments[0].compressed).toBeTruthy();
  });

  it('removeAttachment removes by id and revokes preview URL', async () => {
    const { result } = renderHook(() => useFileAttachments());
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await result.current.addFiles([file]);
    });

    const id = result.current.attachments[0].id;

    act(() => {
      result.current.removeAttachment(id);
    });

    expect(result.current.attachments).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('clearAttachments removes all and revokes URLs', async () => {
    const { result } = renderHook(() => useFileAttachments());
    const file1 = new File(['img1'], 'a.jpg', { type: 'image/jpeg' });
    const file2 = new File(['txt'], 'b.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.addFiles([file1, file2]);
    });

    expect(result.current.attachments).toHaveLength(2);

    act(() => {
      result.current.clearAttachments();
    });

    expect(result.current.attachments).toHaveLength(0);
  });

  it('handleDragOver sets isDragging to true', () => {
    const { result } = renderHook(() => useFileAttachments());

    act(() => {
      result.current.handleDragOver({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);
    });

    expect(result.current.isDragging).toBe(true);
  });

  it('handleDragLeave sets isDragging to false', () => {
    const { result } = renderHook(() => useFileAttachments());

    act(() => {
      result.current.handleDragOver({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);
    });

    expect(result.current.isDragging).toBe(true);

    act(() => {
      result.current.handleDragLeave({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('handleDrop processes dropped files', async () => {
    const { result } = renderHook(() => useFileAttachments());
    const file = new File(['data'], 'dropped.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.handleDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files: [file] as unknown as FileList },
      } as unknown as React.DragEvent);
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].name).toBe('dropped.txt');
    expect(result.current.isDragging).toBe(false);
  });

  it('handlePaste processes pasted files and calls preventDefault', async () => {
    const { result } = renderHook(() => useFileAttachments());
    const file = new File(['data'], 'pasted.png', { type: 'image/png' });
    const preventDefault = vi.fn();

    await act(async () => {
      await result.current.handlePaste({
        preventDefault,
        clipboardData: {
          items: [
            {
              kind: 'file',
              getAsFile: () => file,
            },
          ],
        },
      } as unknown as React.ClipboardEvent);
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].name).toBe('pasted.png');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('handlePaste ignores non-file items', async () => {
    const { result } = renderHook(() => useFileAttachments());

    await act(async () => {
      await result.current.handlePaste({
        clipboardData: {
          items: [{ kind: 'string', getAsFile: () => null }],
        },
      } as unknown as React.ClipboardEvent);
    });

    expect(result.current.attachments).toHaveLength(0);
  });

  it('handles missing clipboardData gracefully', async () => {
    const { result } = renderHook(() => useFileAttachments());

    await act(async () => {
      await result.current.handlePaste({
        clipboardData: null,
      } as unknown as React.ClipboardEvent);
    });

    expect(result.current.attachments).toHaveLength(0);
  });
});
