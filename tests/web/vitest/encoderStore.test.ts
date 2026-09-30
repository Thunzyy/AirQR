import { afterEach, describe, expect, it } from "vitest";

import { useEncoderStore } from "@web/store";
import { DEFAULT_ENCODER_CONFIG } from "@web/constants";
import { migrateLegacyEncoderDefaults } from "@web/utils/encoderConfig";

describe("encoderStore generated FPS", () => {
  afterEach(() => {
    localStorage.clear();
    useEncoderStore.setState(useEncoderStore.getInitialState(), true);
  });

  it("uses the same encoder defaults as Flutter", () => {
    expect(DEFAULT_ENCODER_CONFIG).toEqual({
      fps: 10,
      packetSize: 1500,
      ecc: "LOW",
      targetSize: 177,
      raptorqOverhead: 1.3,
      compressionEnabled: true,
      forceChunkMode: false,
      customChunkSize: 10,
    });
  });

  it("migrates legacy defaults without overwriting unrelated preferences", () => {
    expect(
      migrateLegacyEncoderDefaults({
        fps: 10,
        packetSize: 800,
        ecc: "MEDIUM",
        targetSize: 150,
        raptorqOverhead: 1.2,
        compressionEnabled: false,
        forceChunkMode: true,
        customChunkSize: 0.2,
      })
    ).toEqual({
      fps: 10,
      packetSize: 1500,
      ecc: "LOW",
      targetSize: 177,
      raptorqOverhead: 1.3,
      compressionEnabled: false,
      forceChunkMode: true,
      customChunkSize: 0.2,
    });
  });

  it("stores generated FPS with GIF results and clears it with output reset", () => {
    useEncoderStore.getState().setGifResults(
      ["blob:gif-1"],
      {
        fileSize: 256,
        originalSize: 128,
        totalFrames: 20,
        minFrames: 12,
      },
      {
        generatedFps: 4,
        isStreamingResult: false,
      }
    );

    expect(useEncoderStore.getState().generatedFps).toBe(4);

    useEncoderStore.getState().setGifResults(
      ["blob:gif-1"],
      {
        fileSize: 512,
        originalSize: 128,
      }
    );

    expect(useEncoderStore.getState().generatedFps).toBe(4);

    useEncoderStore.getState().resetOutput();

    expect(useEncoderStore.getState().generatedFps).toBeNull();
  });
});
