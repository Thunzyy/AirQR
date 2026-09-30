import { describe, expect, it } from "vitest";

import {
  hasGifDecoderWorkerResponseType,
  isGifDecoderWorkerResponse,
  normalizeGifDecoderWorkerMessage,
} from "@web/workers/gifDecoderWorkerMessages";

describe("gifDecoderWorkerMessages", () => {
  it("accepts the runtime worker messages consumed by the GIF decoder pool", () => {
    const successMessage = {
      type: "DECODE_FRAME_RESULT",
      payload: {
        frameId: 7,
        found: true,
        binaryData: new Uint8Array([1, 2, 3]),
        decodeTimeMs: 4.5,
      },
    };
    const failureMessage = {
      type: "DECODE_FRAME_RESULT",
      payload: {
        frameId: 8,
        found: false,
        error: "boom",
        decodeTimeMs: 0.25,
      },
    };

    expect(isGifDecoderWorkerResponse(successMessage)).toBe(true);
    expect(
      hasGifDecoderWorkerResponseType(successMessage, "DECODE_FRAME_RESULT")
    ).toBe(true);
    expect(isGifDecoderWorkerResponse(failureMessage)).toBe(true);
  });

  it("normalizes transferable binary payloads into stable Uint8Array messages", () => {
    const normalized = normalizeGifDecoderWorkerMessage({
      type: "DECODE_FRAME_RESULT",
      payload: {
        frameId: "9",
        found: true,
        binaryData: new Uint8Array([4, 5, 6]).buffer,
        decodeTimeMs: "6.75",
      },
    });

    expect(normalized).toMatchObject({
      type: "DECODE_FRAME_RESULT",
      payload: {
        frameId: 9,
        found: true,
        decodeTimeMs: 6.75,
      },
    });
    if (normalized?.type !== "DECODE_FRAME_RESULT") {
      throw new Error("expected decode frame result");
    }

    expect(normalized.payload.binaryData).toBeInstanceOf(Uint8Array);
    expect(Array.from(normalized.payload.binaryData ?? [])).toEqual([4, 5, 6]);
  });

  it("rejects malformed or unknown GIF worker messages", () => {
    expect(
      isGifDecoderWorkerResponse({
        type: "DECODE_FRAME_RESULT",
        payload: {
          frameId: 1,
          found: true,
          decodeTimeMs: "fast",
        },
      })
    ).toBe(false);
    expect(
      isGifDecoderWorkerResponse({
        type: "DECODE_FRAME_RESULT",
        payload: {
          frameId: 1,
          found: "yes",
          decodeTimeMs: 1,
        },
      })
    ).toBe(false);
    expect(normalizeGifDecoderWorkerMessage({ type: "UNKNOWN" })).toBeNull();
  });
});
