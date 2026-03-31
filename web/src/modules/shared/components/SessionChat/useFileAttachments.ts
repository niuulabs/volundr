import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type DragEvent,
  type ClipboardEvent,
} from 'react';
import { compressImage } from './compressImage';

export interface FileAttachment {
  id: string;
  file: File;
  name: string;
  previewUrl: string | null;
  compressed: Blob | null;
}

interface UseFileAttachmentsReturn {
  attachments: FileAttachment[];
  isDragging: boolean;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  handleDragOver: (e: DragEvent) => void;
  handleDragLeave: (e: DragEvent) => void;
  handleDrop: (e: DragEvent) => Promise<void>;
  handlePaste: (e: ClipboardEvent) => Promise<void>;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useFileAttachments(): UseFileAttachmentsReturn {
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const previewUrlsRef = useRef<string[]>([]);

  // Clean up preview URLs on unmount
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newAttachments: FileAttachment[] = [];

    for (const file of fileArray) {
      const id = generateId();

      if (isImageFile(file)) {
        try {
          const { blob, previewUrl } = await compressImage(file);
          previewUrlsRef.current.push(previewUrl);
          newAttachments.push({ id, file, name: file.name, previewUrl, compressed: blob });
        } catch {
          // Compression failed — attach original without preview
          newAttachments.push({ id, file, name: file.name, previewUrl: null, compressed: null });
        }
      } else {
        newAttachments.push({ id, file, name: file.name, previewUrl: null, compressed: null });
      }
    }

    setAttachments(prev => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const removed = prev.find(a => a.id === id);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter(u => u !== removed.previewUrl);
      }
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments(prev => {
      for (const a of prev) {
        if (a.previewUrl) {
          URL.revokeObjectURL(a.previewUrl);
        }
      }
      previewUrlsRef.current = [];
      return [];
    });
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await addFiles(files);
      }
    },
    [addFiles]
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        await addFiles(imageFiles);
      }
    },
    [addFiles]
  );

  return {
    attachments,
    isDragging,
    addFiles,
    removeAttachment,
    clearAttachments,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
  };
}
