import { describe, expect, it } from "vitest";

import {
  mergeScanSessionState,
  normalizeScanSessionState,
} from "@web/utils/scanSessionState";
import type {
  ScanChunkState,
  ScanSessionState,
} from "@web/types/scanSessionState";

function chunk(overrides: Partial<ScanChunkState> = {}): ScanChunkState {
  return {
    chunkId: 0,
    receivedUnique: 0,
    decodeThreshold: null,
    totalPackets: null,
    totalPacketsExact: false,
    state: "missing",
    missingCount: null,
    missingRanges: [],
    targetFrameCount: null,
    targetFrameRanges: [],
    unseenFrameCount: null,
    unseenFrameRanges: [],
    ...overrides,
  };
}

function state(overrides: Partial<ScanSessionState> = {}): ScanSessionState {
  return {
    type: "scan-session-state",
    stateVersion: 1,
    sessionId: "scan-1",
    status: "active",
    updatedAt: "2026-06-10T08:00:00.000Z",
    filename: "archive.zip",
    receivedUnique: 100,
    decodeThreshold: 200,
    totalPackets: null,
    totalPacketsExact: false,
    completionPercent: 50,
    decodeState: "scanning",
    isComplete: false,
    fileAvailable: false,
    chunksTotal: 1,
    chunksComplete: 0,
    chunksMissing: 1,
    chunks: [],
    assembly: {
      inProgress: false,
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
    },
    ...overrides,
  };
}

describe("scanSessionState", () => {
  it("normalizes canonical scan-session-state payloads", () => {
    const normalized = normalizeScanSessionState({
      type: "scan-session-state",
      stateVersion: 7,
      sessionId: "scan-canonical",
      status: "active",
      updatedAt: "2026-06-10T08:00:01.000Z",
      filename: "archive.zip",
      receivedUnique: 55,
      decodeThreshold: 100,
      totalPackets: 120,
      totalPacketsExact: true,
      completionPercent: 55,
      decodeState: "scanning",
      isComplete: false,
      fileAvailable: false,
      chunksTotal: 2,
      chunksComplete: 1,
      chunksMissing: 1,
      chunks: [
        {
          chunkId: 1,
          receivedUnique: 20,
          decodeThreshold: 50,
          totalPackets: null,
          totalPacketsExact: false,
          state: "scanning",
          missingCount: 30,
          missingRanges: [[20, 49]],
        },
      ],
      assembly: {
        inProgress: true,
        attempts: 2,
        lastAttemptAt: "2026-06-10T08:00:00.500Z",
        lastError: null,
      },
    });

    expect(normalized?.sessionId).toBe("scan-canonical");
    expect(normalized?.stateVersion).toBe(7);
    expect(normalized?.totalPacketsExact).toBe(true);
    expect(normalized?.decodeState).toBe("assembling");
    expect(normalized?.chunks).toHaveLength(2);
    expect(normalized?.chunks[0]).toMatchObject({
      chunkId: 0,
      state: "missing",
    });
    expect(normalized?.chunks[1]).toMatchObject({
      chunkId: 1,
      receivedUnique: 20,
      missingRanges: [[20, 49]],
    });
    expect(normalized?.assembly.attempts).toBe(2);
  });

  it("normalizes legacy progress into canonical state", () => {
    const normalized = normalizeScanSessionState({
      sessionId: "scan-legacy",
      receivedCount: 8982,
      expectedPackets: 8954,
      totalPacketsExact: false,
      completed: false,
      chunkStates: [
        { chunkId: 0, receivedCount: 3, lastContiguous: 2, missing: [] },
      ],
    });

    expect(normalized?.sessionId).toBe("scan-legacy");
    expect(normalized?.receivedUnique).toBe(8982);
    expect(normalized?.decodeThreshold).toBe(8954);
    expect(normalized?.completionPercent).toBe(99.9);
    expect(normalized?.decodeState).toBe("threshold_reached");
    expect(normalized?.chunks[0].receivedUnique).toBe(3);
  });

  it("normalizes chunk target frame ranges separately from missing ranges", () => {
    const normalized = normalizeScanSessionState({
      type: "scan-session-state",
      sessionId: "scan-targets",
      chunksTotal: 1,
      chunks: [
        {
          chunkId: 0,
          receivedUnique: 2,
          decodeThreshold: 5,
          totalPackets: 12,
          totalPacketsExact: true,
          state: "scanning",
          missingCount: 5,
          missingRanges: [[0, 0], [2, 4]],
          targetFrameCount: 3,
          unseenFrameCount: 10,
          targetFrameRanges: [[0, 0], [2, 3]],
          unseenFrameRanges: [[0, 0], [2, 4], [6, 11]],
        },
      ],
    });

    expect(normalized?.chunks[0]).toMatchObject({
      receivedUnique: 2,
      missingRanges: [[0, 0], [2, 4]],
      targetFrameCount: 3,
      unseenFrameCount: 10,
      targetFrameRanges: [[0, 0], [2, 3]],
      unseenFrameRanges: [[0, 0], [2, 4], [6, 11]],
    });
  });

  it("ignores lower state versions", () => {
    const current = state({ stateVersion: 5, receivedUnique: 500 });
    const incoming = state({ stateVersion: 4, receivedUnique: 600 });

    expect(mergeScanSessionState(current, incoming)).toBe(current);
  });

  it("preserves highest received count and completion percent for same version", () => {
    const current = state({
      stateVersion: 5,
      receivedUnique: 500,
      completionPercent: 50,
    });
    const incoming = state({
      stateVersion: 5,
      receivedUnique: 450,
      completionPercent: 45,
    });

    const merged = mergeScanSessionState(current, incoming);

    expect(merged?.receivedUnique).toBe(500);
    expect(merged?.completionPercent).toBe(50);
  });

  it("allows 100 only for complete file available state", () => {
    const incomplete = normalizeScanSessionState({
      sessionId: "scan-1",
      receivedUnique: 300,
      decodeThreshold: 200,
      completionPercent: 100,
      isComplete: false,
      fileAvailable: false,
    });
    const complete = normalizeScanSessionState({
      sessionId: "scan-1",
      receivedUnique: 300,
      decodeThreshold: 200,
      completionPercent: 100,
      isComplete: true,
      fileAvailable: true,
      completed: true,
    });

    expect(incomplete?.completionPercent).toBe(99.9);
    expect(complete?.completionPercent).toBe(100);
  });

  it("preserves decimal incomplete completion percent below 100", () => {
    const normalized = normalizeScanSessionState({
      sessionId: "scan-decimal",
      receivedUnique: 199,
      decodeThreshold: 200,
      completionPercent: 99.5,
      isComplete: false,
      fileAvailable: false,
    });

    expect(normalized?.completionPercent).toBe(99.5);
  });

  it("caps incomplete raw 100 completion at 99.9", () => {
    const normalized = normalizeScanSessionState({
      sessionId: "scan-cap",
      receivedUnique: 200,
      decodeThreshold: 200,
      completionPercent: 100,
      isComplete: false,
      fileAvailable: false,
    });

    expect(normalized?.completionPercent).toBe(99.9);
  });

  it("merges chunks by chunkId without regressing chunk progress", () => {
    const current = state({
      stateVersion: 5,
      chunksTotal: 3,
      chunksComplete: 1,
      chunksMissing: 2,
      chunks: [
        chunk({
          chunkId: 0,
          receivedUnique: 25,
          decodeThreshold: 50,
          state: "scanning",
          missingCount: 25,
          missingRanges: [[25, 49]],
        }),
        chunk({
          chunkId: 1,
          receivedUnique: 50,
          decodeThreshold: 50,
          totalPackets: 50,
          totalPacketsExact: true,
          state: "complete",
          missingCount: 0,
        }),
      ],
    });
    const incoming = state({
      stateVersion: 5,
      chunksTotal: 3,
      chunksComplete: 0,
      chunksMissing: 3,
      chunks: [
        chunk({
          chunkId: 0,
          receivedUnique: 20,
          decodeThreshold: 50,
          state: "scanning",
          missingCount: 30,
          missingRanges: [[20, 49]],
        }),
        chunk({
          chunkId: 1,
          receivedUnique: 45,
          decodeThreshold: 50,
          totalPackets: 50,
          totalPacketsExact: true,
          state: "threshold_reached",
          missingCount: 5,
        }),
        chunk({
          chunkId: 2,
          receivedUnique: 5,
          decodeThreshold: 50,
          state: "scanning",
          missingCount: 45,
        }),
      ],
    });

    const merged = mergeScanSessionState(current, incoming);

    expect(merged?.chunks.map((item) => item.chunkId)).toEqual([0, 1, 2]);
    expect(merged?.chunks[0]).toMatchObject({
      receivedUnique: 25,
      missingCount: 25,
      missingRanges: [[25, 49]],
    });
    expect(merged?.chunks[1]).toMatchObject({
      receivedUnique: 50,
      state: "complete",
      missingCount: 0,
    });
    expect(merged?.chunks[2]).toMatchObject({
      receivedUnique: 5,
      state: "scanning",
    });
    expect(merged?.chunksComplete).toBe(1);
    expect(merged?.chunksMissing).toBe(2);
  });

  it("allows newer server state to clear assembling status", () => {
    const current = state({
      stateVersion: 5,
      receivedUnique: 200,
      decodeThreshold: 200,
      completionPercent: 99,
      decodeState: "assembling",
      assembly: {
        inProgress: true,
        attempts: 1,
        lastAttemptAt: "2026-06-10T08:00:00.000Z",
        lastError: null,
      },
    });
    const incoming = state({
      stateVersion: 6,
      receivedUnique: 200,
      decodeThreshold: 200,
      completionPercent: 99,
      decodeState: "decode_pending",
      assembly: {
        inProgress: false,
        attempts: 1,
        lastAttemptAt: "2026-06-10T08:00:00.000Z",
        lastError: "Need more packets",
      },
    });

    const merged = mergeScanSessionState(current, incoming);

    expect(merged?.assembly.inProgress).toBe(false);
    expect(merged?.assembly.lastError).toBe("Need more packets");
    expect(merged?.decodeState).toBe("decode_pending");
  });

  it("allows newer legacy completion to merge into versioned state", () => {
    const current = state({
      stateVersion: 5,
      updatedAt: "2026-06-10T08:00:00.000Z",
      receivedUnique: 200,
      decodeThreshold: 200,
      completionPercent: 99,
      decodeState: "threshold_reached",
    });
    const incoming = normalizeScanSessionState({
      sessionId: "scan-1",
      status: "complete",
      completed: true,
      fileAvailable: true,
      filePath: "sessions/scan-1/files/archive.zip",
      updatedAt: "2026-06-10T08:01:00.000Z",
      receivedCount: 180,
      expectedPackets: 200,
      completionPercent: 100,
    });

    const merged = mergeScanSessionState(current, incoming);

    expect(merged?.stateVersion).toBe(5);
    expect(merged?.status).toBe("complete");
    expect(merged?.fileAvailable).toBe(true);
    expect(merged?.completionPercent).toBe(100);
    expect(merged?.receivedUnique).toBe(200);
  });

  it("marks all merged chunks complete when file becomes available", () => {
    const current = state({
      stateVersion: 5,
      chunksTotal: 1,
      chunksComplete: 0,
      chunksMissing: 1,
      chunks: [
        chunk({
          chunkId: 0,
          receivedUnique: 10,
          state: "failed",
          missingCount: 5,
          missingRanges: [[10, 14]],
        }),
      ],
      assembly: {
        inProgress: true,
        attempts: 1,
        lastAttemptAt: "2026-06-10T08:00:00.000Z",
        lastError: null,
      },
    });
    const incoming = state({
      stateVersion: 6,
      status: "complete",
      isComplete: true,
      fileAvailable: true,
      completionPercent: 100,
      decodeState: "complete",
      chunksTotal: 1,
      chunksComplete: 1,
      chunksMissing: 0,
      chunks: [
        chunk({
          chunkId: 0,
          receivedUnique: 10,
          state: "complete",
          missingCount: 0,
          missingRanges: [],
        }),
      ],
    });

    const merged = mergeScanSessionState(current, incoming);

    expect(merged?.chunks[0]).toMatchObject({
      state: "complete",
      missingCount: 0,
      missingRanges: [],
    });
    expect(merged?.chunksMissing).toBe(0);
    expect(merged?.assembly.inProgress).toBe(false);
  });

  it("keeps the smaller missing packet range when chunk progress ties", () => {
    const current = state({
      stateVersion: 5,
      chunks: [
        chunk({
          chunkId: 0,
          receivedUnique: 10,
          missingCount: 11,
          missingRanges: [[0, 10]],
        }),
      ],
    });
    const incoming = state({
      stateVersion: 5,
      chunks: [
        chunk({
          chunkId: 0,
          receivedUnique: 10,
          missingCount: 2,
          missingRanges: [
            [2, 2],
            [4, 4],
          ],
        }),
      ],
    });

    const merged = mergeScanSessionState(current, incoming);

    expect(merged?.chunks[0].missingCount).toBe(2);
    expect(merged?.chunks[0].missingRanges).toEqual([
      [2, 2],
      [4, 4],
    ]);
  });
});
