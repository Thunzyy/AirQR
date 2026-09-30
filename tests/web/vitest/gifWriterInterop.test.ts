import { describe, expect, it, vi } from "vitest";

import { writeGifFrame } from "@web/workers/gifWriterInterop";

describe("gifWriterInterop", () => {
  it("passes Uint8Array frame data to GifWriter without copying", () => {
    const indexedPixels = new Uint8Array([0, 1, 0, 1]);
    const addFrame = vi.fn();

    writeGifFrame(
      { addFrame } as { addFrame: (...args: unknown[]) => number },
      {
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        indexedPixels,
        delay: 4,
        disposal: 2,
      }
    );

    expect(addFrame).toHaveBeenCalledTimes(1);
    const [, , , , actualPixels, actualOptions] = addFrame.mock.calls[0];
    expect(actualPixels).toBe(indexedPixels);
    expect(actualOptions).toMatchObject({
      delay: 4,
      disposal: 2,
    });
  });
});
