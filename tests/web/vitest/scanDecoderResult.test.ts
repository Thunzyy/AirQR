import { describe, expect, it } from "vitest";

import {
  normalizeDecodeResult,
  type NormalizedChunkCompletedDecodeResult,
} from "@web/features/scanner/scanDecoderResult";

describe("normalizeDecodeResult", () => {
  it("normalizes shared packet counters from legacy aliases", () => {
    const result = normalizeDecodeResult({
      type: "progress",
      filename: "hello.bin",
      sessionId: 42,
      received_packets: 18,
      packets_received_chunk: 7,
      expected_packets: 24,
      total_packets: 31,
      chunkId: 1,
      chunksCompleted: 2,
      totalChunks: 3,
      percent: 75,
    });

    expect(result).toMatchObject({
      type: "progress",
      filename: "hello.bin",
      sessionId: "42",
      receivedPackets: 18,
      packetsReceivedChunk: 7,
      expectedPackets: 24,
      totalPackets: 31,
      totalPacketsExact: true,
      chunkId: 1,
      chunksCompleted: 2,
      totalChunks: 3,
      percent: 75,
    });
  });

  it("derives the session expected minimum from per-chunk minimums when needed", () => {
    const result = normalizeDecodeResult({
      type: "progress",
      packetsExpectedChunk: 132,
      totalChunks: 6,
      packetsTotalChunk: 158,
    });

    expect(result.expectedPackets).toBe(792);
    expect(result.packetsExpectedChunk).toBe(132);
    expect(result.totalPackets).toBe(158);
    expect(result.totalPacketsExact).toBe(true);
  });

  it("normalizes chunk-completed payloads with explicit chunk fields", () => {
    const chunkData = new Uint8Array([1, 2, 3]);

    const result = normalizeDecodeResult({
      type: "chunk_completed",
      chunkId: 2,
      totalChunks: 4,
      chunkData,
      packetsExpectedChunk: 140,
      packetsReceivedTotal: 417,
      chunksCompleted: 3,
      overallPercent: 88.5,
    }) as NormalizedChunkCompletedDecodeResult;

    expect(result.type).toBe("chunk_completed");
    expect(result.chunkId).toBe(2);
    expect(result.totalChunks).toBe(4);
    expect(result.chunkData).toBe(chunkData);
    expect(result.packetsExpectedChunk).toBe(140);
    expect(result.packetsReceivedTotal).toBe(417);
    expect(result.expectedPackets).toBe(560);
    expect(result.receivedPackets).toBe(417);
    expect(result.overallPercent).toBe(88.5);
  });
});
