// GIF Decoder Utility Functions
import { GifReader } from "omggif";
import { unzipFilesInWorker } from "../../utils/zipWorker";

/**
 * Extract all frames from a GIF file as ImageData
 */
export async function extractGifFrames(
  gifData: Uint8Array
): Promise<ImageData[]> {
  const reader = new GifReader(gifData);
  const width = reader.width;
  const height = reader.height;
  const numFrames = reader.numFrames();

  const frames: ImageData[] = [];
  const pixelBuffer = new Uint8Array(width * height * 4);

  for (let i = 0; i < numFrames; i++) {
    reader.decodeAndBlitFrameRGBA(i, pixelBuffer);

    // Create a new ImageData for this frame
    const imageData = new ImageData(
      new Uint8ClampedArray(pixelBuffer),
      width,
      height
    );
    frames.push(imageData);
  }

  return frames;
}

/**
 * Extract GIF files from a ZIP archive
 */
export async function extractGifsFromZip(
  zipData: Uint8Array
): Promise<Map<string, Uint8Array>> {
  const entries = await unzipFilesInWorker(zipData, { filterExt: ".gif" });
  const gifFiles = new Map<string, Uint8Array>();

  for (const entry of entries) {
    gifFiles.set(entry.name, entry.data);
  }

  return gifFiles;
}

/**
 * Detect if file is a ZIP archive
 */
export function isZipFile(data: Uint8Array): boolean {
  // ZIP files start with PK (0x50 0x4B)
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;
}

/**
 * Detect if file is a GIF
 */
export function isGifFile(data: Uint8Array): boolean {
  // GIF files start with "GIF89a" or "GIF87a"
  return (
    data.length >= 6 &&
    data[0] === 0x47 && // G
    data[1] === 0x49 && // I
    data[2] === 0x46 && // F
    data[3] === 0x38 && // 8
    (data[4] === 0x39 || data[4] === 0x37) && // 9 or 7
    data[5] === 0x61 // a
  );
}

/**
 * Format duration to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}
