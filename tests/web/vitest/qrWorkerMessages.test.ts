import { describe, expect, it } from "vitest";

import {
  hasQrWorkerResponseType,
  isQrWorkerResponse,
  normalizeQrWorkerMessage,
} from "@web/workers/qrWorkerMessages";

describe("qrWorkerMessages", () => {
  it("accepts the runtime worker messages consumed by the QR pool", () => {
    const initMessage = {
      type: "INIT_SUCCESS",
      hasOffscreenCanvas: true,
    };
    const batchCompleteMessage = {
      type: "BATCH_COMPLETE",
      payload: {
        batchId: 3,
        frames: [
          { id: 7, buffer: new Uint8Array([1, 2, 3]) },
          { id: 8, buffer: new Uint8Array([4, 5, 6]) },
        ],
        frameWidth: 29,
        frameHeight: 29,
      },
    };
    const errorMessage = {
      type: "ERROR",
      payload: "boom",
    };

    expect(isQrWorkerResponse(initMessage)).toBe(true);
    expect(hasQrWorkerResponseType(initMessage, "INIT_SUCCESS")).toBe(true);
    expect(isQrWorkerResponse(batchCompleteMessage)).toBe(true);
    expect(hasQrWorkerResponseType(batchCompleteMessage, "BATCH_COMPLETE")).toBe(true);
    expect(isQrWorkerResponse(errorMessage)).toBe(true);
  });

  it("normalizes transferable COMPLETE payloads into stable Uint8Array frames", () => {
    const normalized = normalizeQrWorkerMessage({
      type: "BATCH_COMPLETE",
      payload: {
        batchId: "9",
        frames: [
          { id: "1", buffer: new Uint8Array([1, 2]).buffer },
          { id: 2, buffer: new Uint8Array([3, 4]) },
        ],
        frameWidth: "41",
        frameHeight: 41,
      },
    });

    expect(normalized).toMatchObject({
      type: "BATCH_COMPLETE",
      payload: {
        batchId: 9,
        frameWidth: 41,
        frameHeight: 41,
      },
    });
    if (normalized?.type !== "BATCH_COMPLETE") {
      throw new Error("expected batch complete");
    }
    expect(normalized.payload.frames[0].buffer).toBeInstanceOf(Uint8Array);
    expect(Array.from(normalized.payload.frames[0].buffer)).toEqual([1, 2]);
    expect(Array.from(normalized.payload.frames[1].buffer)).toEqual([3, 4]);
  });

  it("accepts shared-buffer batch completions without per-frame placeholders", () => {
    const normalized = normalizeQrWorkerMessage({
      type: "BATCH_COMPLETE",
      payload: {
        batchId: 4,
        frames: [],
        frameCount: "64",
        frameWidth: 177,
        frameHeight: 177,
      },
    });

    expect(normalized).toMatchObject({
      type: "BATCH_COMPLETE",
      payload: {
        batchId: 4,
        frameCount: 64,
        frames: [],
        frameWidth: 177,
        frameHeight: 177,
      },
    });
  });

  it("rejects malformed or unknown QR worker messages", () => {
    expect(
      isQrWorkerResponse({
        type: "INIT_SUCCESS",
        hasOffscreenCanvas: "yes",
      })
    ).toBe(false);
    expect(
      isQrWorkerResponse({
        type: "BATCH_COMPLETE",
        payload: {
          batchId: 1,
          frames: [{ id: 1 }],
        },
      })
    ).toBe(false);
    expect(
      isQrWorkerResponse({
        type: "ERROR",
        payload: { message: "boom" },
      })
    ).toBe(false);
    expect(normalizeQrWorkerMessage({ type: "UNKNOWN" })).toBeNull();
  });
});
