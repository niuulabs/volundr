import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressImage } from './compressImage';

describe('compressImage', () => {
  const mockClose = vi.fn();
  const mockConvertToBlob = vi.fn();
  const mockDrawImage = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock createImageBitmap
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 800,
        height: 600,
        close: mockClose,
      })
    );

    // Mock OffscreenCanvas as a class
    class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return { drawImage: mockDrawImage };
      }
      convertToBlob(...args: unknown[]) {
        return mockConvertToBlob(...args);
      }
    }
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  });

  it('compresses an image and returns blob + previewUrl', async () => {
    const smallBlob = new Blob(['x'], { type: 'image/jpeg' });
    mockConvertToBlob.mockResolvedValue(smallBlob);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:preview-123'),
      revokeObjectURL: vi.fn(),
    });

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const result = await compressImage(file);

    expect(result.blob).toBe(smallBlob);
    expect(result.previewUrl).toBe('blob:preview-123');
    expect(mockClose).toHaveBeenCalled();
  });

  it('downscales images larger than 1280px', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 2560,
        height: 1920,
        close: mockClose,
      })
    );

    const smallBlob = new Blob(['x'], { type: 'image/jpeg' });
    mockConvertToBlob.mockResolvedValue(smallBlob);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:url'),
      revokeObjectURL: vi.fn(),
    });

    const file = new File(['data'], 'large.jpg', { type: 'image/jpeg' });
    await compressImage(file);

    // Canvas should have drawn the image (confirming it got created)
    expect(mockDrawImage).toHaveBeenCalled();
    expect(mockConvertToBlob).toHaveBeenCalled();
  });

  it('retries with lower quality if blob exceeds 300KB', async () => {
    const largeBlobData = new Uint8Array(400 * 1024);
    const largeBlob = new Blob([largeBlobData], { type: 'image/jpeg' });
    const smallBlob = new Blob(['small'], { type: 'image/jpeg' });

    mockConvertToBlob.mockResolvedValueOnce(largeBlob).mockResolvedValueOnce(smallBlob);

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:url'),
      revokeObjectURL: vi.fn(),
    });

    const file = new File(['data'], 'big.jpg', { type: 'image/jpeg' });
    const result = await compressImage(file);

    expect(mockConvertToBlob).toHaveBeenCalledTimes(2);
    expect(result.blob).toBe(smallBlob);
  });

  it('throws when canvas context is null', async () => {
    class NullCtxCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return null;
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    }
    vi.stubGlobal('OffscreenCanvas', NullCtxCanvas);

    const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
    await expect(compressImage(file)).rejects.toThrow('Failed to get canvas context');
  });
});
