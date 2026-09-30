import { describe, expect, it } from "vitest";

import {
  advanceOverallEncoderProgress,
  normalizeEncoderWorkerMessage,
} from "@web/workers/encoderWorkerMessages";

describe("normalizeEncoderWorkerMessage", () => {
  it("normalizes progress and metadata payloads from loose worker messages", () => {
    const progress = normalizeEncoderWorkerMessage({
      type: "PROGRESS",
      payload: { phase: "Encoding", percent: "42", current: "12", total: 30 },
    });
    const metadata = normalizeEncoderWorkerMessage({
      type: "METADATA",
      payload: {
        minFrames: "120",
        totalFrames: 158,
        chunkId: "2",
        packetSize: "256",
      },
    });

    expect(progress).toEqual({
      type: "PROGRESS",
      payload: {
        phase: "Encoding",
        percent: 42,
        current: 12,
        total: 30,
      },
    });
    expect(metadata).toEqual({
      type: "METADATA",
      payload: {
        minFrames: 120,
        totalFrames: 158,
        chunkId: 2,
        packetSize: 256,
      },
    });
  });

  it("normalizes complete and error worker messages into predictable payloads", () => {
    const complete = normalizeEncoderWorkerMessage({
      type: "COMPLETE",
      payload: new Uint8Array([1, 2, 3]).buffer,
    });
    const error = normalizeEncoderWorkerMessage({
      type: "ERROR",
      payload: 404,
    });

    expect(complete).toEqual({
      type: "COMPLETE",
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(error).toEqual({
      type: "ERROR",
      payload: "404",
    });
  });

  it("ignores unrelated worker payloads instead of pretending they match the contract", () => {
    expect(normalizeEncoderWorkerMessage({})).toBeNull();
    expect(
      normalizeEncoderWorkerMessage({ type: "UNEXPECTED", payload: { foo: "bar" } })
    ).toBeNull();
  });

  it("keeps overall encoding progress monotonic across phase resets and out-of-order updates", () => {
    let progress = 0;

    progress = advanceOverallEncoderProgress(progress, {
      phase: "Generating packets",
      percent: 0,
    });
    expect(progress).toBe(0);

    progress = advanceOverallEncoderProgress(progress, {
      phase: "Encoding QR codes (parallel)",
      percent: 80,
    });
    expect(progress).toBe(73);

    progress = advanceOverallEncoderProgress(progress, {
      phase: "Encoding QR codes (parallel)",
      percent: 64,
    });
    expect(progress).toBe(73);

    progress = advanceOverallEncoderProgress(progress, {
      phase: "Assembling GIF",
      percent: 0,
    });
    expect(progress).toBe(90);
  });
});
