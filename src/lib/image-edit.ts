/** A region of an image as fractions (0–1) of its width and height. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Formats a crop can be written back in without losing anything a canvas can't hold (a GIF would lose its animation). */
const CROP_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** The mime type to re-encode a cropped attachment with, or null if cropping it would damage it. */
export function cropMime(file: string): string | null {
  return CROP_MIME[file.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Without this the canvas is tainted and toBlob throws; the asset protocol allows it.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen"));
    img.src = src;
  });
}

/** Draws the image (or only `crop` of it) at its natural resolution and encodes it. */
export async function imageBlob(src: string, mime: string, crop?: CropRect): Promise<Blob> {
  const img = await loadImage(src);
  const sx = Math.round((crop?.x ?? 0) * img.naturalWidth);
  const sy = Math.round((crop?.y ?? 0) * img.naturalHeight);
  const sw = Math.max(1, Math.round((crop?.w ?? 1) * img.naturalWidth));
  const sh = Math.max(1, Math.round((crop?.h ?? 1) * img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("No se pudo codificar la imagen"))),
      mime,
      0.92,
    ),
  );
}
