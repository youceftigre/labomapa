const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 12_000;
/** Mobile-first defaults: small files, fast uploads, and lower storage usage. */
const DEFAULT_MAX_DIM = 480;
const DEFAULT_QUALITY = 0.55;
const MAX_UPLOAD_BYTES = 350 * 1024;
const MIN_OUTPUT_DIM = 280;
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

function dataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  return Math.floor((dataUrl.length - comma - 1) * 0.75);
}

/**
 * Re-encode progressively until the image fits the mobile upload budget.
 * This prevents large camera photos from being saved only in one browser's
 * local cache when Firestore rejects an oversized document.
 */
function compressLoadedImage(
  img: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDim = DEFAULT_MAX_DIM,
  quality = DEFAULT_QUALITY,
) {
  let currentDim = Math.min(maxDim, Math.max(sourceWidth, sourceHeight));
  let currentQuality = quality;
  let result = canvasToJpeg(img, sourceWidth, sourceHeight, currentDim, currentQuality);

  for (let pass = 0; pass < 5 && dataUrlBytes(result) > MAX_UPLOAD_BYTES; pass += 1) {
    currentQuality = Math.max(0.38, currentQuality - 0.06);
    currentDim = Math.max(MIN_OUTPUT_DIM, Math.round(currentDim * 0.82));
    result = canvasToJpeg(img, sourceWidth, sourceHeight, currentDim, currentQuality);
  }
  return result;
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
        const result = compressLoadedImage(img, sourceWidth, sourceHeight, maxDim, quality);
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

/** Normalize every existing data URL before upload. */
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
        resolve(compressLoadedImage(img, sourceWidth, sourceHeight, maxDim, quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
