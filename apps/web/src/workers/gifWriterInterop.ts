import type { FrameOptions, GifWriter } from "omggif";

export interface GifFrameWriteRequest {
  x: number;
  y: number;
  width: number;
  height: number;
  indexedPixels: number[] | Uint8Array | Uint8ClampedArray;
  delay: number;
  disposal: NonNullable<FrameOptions["disposal"]>;
}

export function writeGifFrame(
  writer: Pick<GifWriter, "addFrame">,
  request: GifFrameWriteRequest
): number {
  return writer.addFrame(
    request.x,
    request.y,
    request.width,
    request.height,
    request.indexedPixels,
    {
      delay: request.delay,
      disposal: request.disposal,
    }
  );
}
