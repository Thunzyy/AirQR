import { describe, expect, it } from "vitest";

import { buildGifDecodeMetrics } from "@web/features/decoder/gifDecoderPerf";

describe("gifDecoderPerf", () => {
  it("derives stable measured metrics from decode timings", () => {
    expect(
      buildGifDecodeMetrics({
        processedFrames: 40,
        qrDetected: 18,
        wallTimeMs: 2000,
        workerDecodeTimeMs: 500,
      })
    ).toEqual({
      processedFrames: 40,
      qrDetected: 18,
      wallTimeMs: 2000,
      workerDecodeTimeMs: 500,
      framesPerSecond: 20,
      averageFrameDecodeMs: 12.5,
    });
  });

  it("guards against zero or missing frame counts", () => {
    expect(
      buildGifDecodeMetrics({
        processedFrames: 0,
        qrDetected: 0,
        wallTimeMs: 750,
        workerDecodeTimeMs: 100,
      })
    ).toEqual({
      processedFrames: 0,
      qrDetected: 0,
      wallTimeMs: 750,
      workerDecodeTimeMs: 100,
      framesPerSecond: 0,
      averageFrameDecodeMs: 0,
    });
  });
});
