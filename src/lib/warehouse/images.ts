const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 12_000;
/** Mobile-friendly defaults: small files, faster upload, and lower Storage usage. */
const DEFAULT_MAX_DIM = 480;
const DEFAULT_QUALITY = 0.55;
const MAX_UPLOAD_BYTES = 350 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function canvasToJpeg(
  img: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDim: number,
  quality: number,
): string {
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ctx");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function compressImage(
  file: File,
  maxDim = DEFAULT_MAX_DIM,
  quality = DEFAULT_QUALITY,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      reject(new Error("not-image"));
      return;
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      reject(new Error("image-size"));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    img.onload = () => {
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      if (
        sourceWidth < 1 ||
        sourceHeight < 1 ||
        sourceWidth > MAX_SOURCE_DIMENSION ||
        sourceHeight > MAX_SOURCE_DIMENSION
      ) {
        cleanup();
        reject(new Error("image-dimensions"));
        return;
      }
      try {
        const result = canvasToJpeg(img, sourceWidth, sourceHeight, maxDim, quality);
        cleanup();
        resolve(result);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("img"));
    };
    img.src = objectUrl;
  });
}

/**
 * Normalize every existing data URL before upload. Even small images are
 * recompressed so PNGs and large camera images do not bypass the upload limit.
 */
export function compressDataUrl(
  dataUrl: string,
  maxDim = DEFAULT_MAX_DIM,
  quality = DEFAULT_QUALITY,
  _minBytesToCompress = 0,
): Promise<string> {
  if (!dataUrl.startsWith("data:image")) return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const sourceWidth = img.naturalWidth || img.width;
        const sourceHeight = img.naturalHeight || img.height;
        if (sourceWidth < 1 || sourceHeight < 1) {
          resolve(dataUrl);
          return;
        }
        const compressed = canvasToJpeg(img, sourceWidth, sourceHeight, maxDim, quality);
        const compressedBytes = Math.floor((compressed.length * 3) / 4);
        // Use a second pass for unusually detailed images so Firebase receives
        // a predictably small payload on the free plan.
        resolve(
          compressedBytes > MAX_UPLOAD_BYTES
            ? canvasToJpeg(img, sourceWidth, sourceHeight, 560, 0.5)
            : compressed,
        );
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
