import "omggif";

declare module "omggif" {
  interface GifWriter {
    addFrame(
      x: number,
      y: number,
      w: number,
      h: number,
      indexed_pixels: number[] | Uint8Array | Uint8ClampedArray,
      opts?: FrameOptions
    ): number;
  }
}

export {};
