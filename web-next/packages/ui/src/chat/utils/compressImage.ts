const MAX_DIMENSION = 1280;
const INITIAL_QUALITY = 0.85;
const FALLBACK_QUALITY = 0.5;
const TARGET_SIZE_BYTES = 300 * 1024;

export async function compressImage(
  file: File
): Promise<{ blob: Blob; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('Canvas toBlob failed'));
            return;
          }
          if (blob.size <= TARGET_SIZE_BYTES) {
            const previewUrl = URL.createObjectURL(blob);
            resolve({ blob, previewUrl });
            return;
          }
          // Try fallback quality
          canvas.toBlob(
            fallbackBlob => {
              if (!fallbackBlob) {
                reject(new Error('Canvas toBlob (fallback) failed'));
                return;
              }
              const previewUrl = URL.createObjectURL(fallbackBlob);
              resolve({ blob: fallbackBlob, previewUrl });
            },
            'image/jpeg',
            FALLBACK_QUALITY
          );
        },
        'image/jpeg',
        INITIAL_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image load failed'));
    };

    img.src = objectUrl;
  });
}
