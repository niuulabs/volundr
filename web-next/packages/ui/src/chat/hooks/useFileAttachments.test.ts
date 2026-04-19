import { renderHook, act } from '@testing-library/react';
import { useFileAttachments } from './useFileAttachments';

vi.mock('../utils/compressImage', () => ({
  compressImage: vi.fn().mockResolvedValue({ blob: new Blob(['compressed']), previewUrl: 'mock-url' }),
}));

// Mock URL.createObjectURL and URL.revokeObjectURL
const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
const revokeObjectURLMock = vi.fn();
Object.defineProperty(URL, 'createObjectURL', {
  value: createObjectURLMock,
  writable: true,
  configurable: true,
});
Object.defineProperty(URL, 'revokeObjectURL', {
  value: revokeObjectURLMock,
  writable: true,
  configurable: true,
});

function makeFile(name = 'test.txt', type = 'text/plain'): File {
  return new File(['content'], name, { type });
}

function makeImageFile(name = 'photo.jpg'): File {
  return new File(['data'], name, { type: 'image/jpeg' });
}

describe('useFileAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with empty attachments', () => {
    const { result } = renderHook(() => useFileAttachments());
    expect(result.current.attachments).toHaveLength(0);
  });

  it('starts with isDragging=false', () => {
    const { result } = renderHook(() => useFileAttachments());
    expect(result.current.isDragging).toBe(false);
  });

  describe('addFiles', () => {
    it('adds a non-image file to attachments', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = makeFile('doc.pdf', 'application/pdf');
      await act(async () => {
        await result.current.addFiles([file]);
      });
      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0]?.name).toBe('doc.pdf');
      expect(result.current.attachments[0]?.previewUrl).toBeNull();
    });

    it('adds an image file with previewUrl from compressImage', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = makeImageFile('photo.jpg');
      await act(async () => {
        await result.current.addFiles([file]);
      });
      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0]?.previewUrl).toBe('mock-url');
    });

    it('adds multiple files', async () => {
      const { result } = renderHook(() => useFileAttachments());
      await act(async () => {
        await result.current.addFiles([makeFile('a.txt'), makeFile('b.txt')]);
      });
      expect(result.current.attachments).toHaveLength(2);
    });
  });

  describe('removeAttachment', () => {
    it('removes attachment by id', async () => {
      const { result } = renderHook(() => useFileAttachments());
      await act(async () => {
        await result.current.addFiles([makeFile('test.txt')]);
      });
      const id = result.current.attachments[0]!.id;
      act(() => {
        result.current.removeAttachment(id);
      });
      expect(result.current.attachments).toHaveLength(0);
    });

    it('only removes the targeted attachment', async () => {
      const { result } = renderHook(() => useFileAttachments());
      await act(async () => {
        await result.current.addFiles([makeFile('a.txt'), makeFile('b.txt')]);
      });
      const idToRemove = result.current.attachments[0]!.id;
      act(() => {
        result.current.removeAttachment(idToRemove);
      });
      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0]?.name).toBe('b.txt');
    });
  });

  describe('clearAttachments', () => {
    it('empties the attachments list', async () => {
      const { result } = renderHook(() => useFileAttachments());
      await act(async () => {
        await result.current.addFiles([makeFile('a.txt'), makeFile('b.txt')]);
      });
      act(() => {
        result.current.clearAttachments();
      });
      expect(result.current.attachments).toHaveLength(0);
    });
  });

  describe('drag events', () => {
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
      act(() => {
        result.current.handleDragLeave({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.DragEvent);
      });
      expect(result.current.isDragging).toBe(false);
    });
  });

  describe('paste event', () => {
    it('handlePaste with file items calls addFiles', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const file = makeFile('pasted.png', 'image/png');
      const mockItem = {
        kind: 'file',
        getAsFile: vi.fn().mockReturnValue(file),
      };
      const mockEvent = {
        clipboardData: { items: [mockItem] },
        preventDefault: vi.fn(),
      } as unknown as React.ClipboardEvent;

      await act(async () => {
        await result.current.handlePaste(mockEvent);
      });

      expect(result.current.attachments).toHaveLength(1);
    });

    it('handlePaste with no file items does nothing', async () => {
      const { result } = renderHook(() => useFileAttachments());
      const mockEvent = {
        clipboardData: { items: [] },
        preventDefault: vi.fn(),
      } as unknown as React.ClipboardEvent;

      await act(async () => {
        await result.current.handlePaste(mockEvent);
      });

      expect(result.current.attachments).toHaveLength(0);
    });
  });
});
