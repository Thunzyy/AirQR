import { describe, expect, it } from "vitest";

import {
  hasScanWorkerResponseType,
  isScanWorkerResponse,
  normalizeScanWorkerMessage,
} from "@web/workers/scanWorkerMessages";

describe("scanWorkerMessages", () => {
  it("accepts the runtime worker messages used by the scanner", () => {
    const readyMessage = { type: "WORKER_READY" };
    const warmupCompleteMessage = { type: "WARMUP_COMPLETE" };
    const warmupErrorMessage = { type: "WARMUP_ERROR", error: "boom" };

    expect(isScanWorkerResponse(readyMessage)).toBe(true);
    expect(hasScanWorkerResponseType(readyMessage, "WORKER_READY")).toBe(true);
    expect(isScanWorkerResponse(warmupCompleteMessage)).toBe(true);
    expect(isScanWorkerResponse(warmupErrorMessage)).toBe(true);
  });

  it("normalizes scan results into a stable SCAN_RESULT shape", () => {
    const normalized = normalizeScanWorkerMessage({
      found: true,
      binaryData: new Uint8Array([1, 2, 3]).buffer,
      location: {
        topLeftCorner: { x: 1, y: 2 },
        topRightCorner: { x: 3, y: 4 },
        bottomRightCorner: { x: 5, y: 6 },
        bottomLeftCorner: { x: 7, y: 8 },
      },
      requestId: 42,
      data: "hello",
      format: "QRCode",
    });

    expect(normalized).toMatchObject({
      type: "SCAN_RESULT",
      found: true,
      requestId: 42,
      data: "hello",
      format: "QRCode",
    });
    if (normalized?.type !== "SCAN_RESULT") {
      throw new Error("expected scan result");
    }
    expect(normalized.binaryData).toBeInstanceOf(Uint8Array);
    expect(Array.from(normalized.binaryData ?? [])).toEqual([1, 2, 3]);
    expect(normalized.location?.topLeftCorner).toEqual({ x: 1, y: 2 });
  });

  it("rejects malformed scan worker messages", () => {
    expect(
      isScanWorkerResponse({
        type: "WARMUP_ERROR",
        error: { message: "boom" },
      })
    ).toBe(false);
    expect(
      normalizeScanWorkerMessage({
        found: true,
        binaryData: 123,
      })
    ).toBeNull();
    expect(normalizeScanWorkerMessage({ type: "UNKNOWN" })).toBeNull();
  });
});
