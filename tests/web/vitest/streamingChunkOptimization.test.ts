import { describe, expect, it, vi } from "vitest";

import {
  buildChunkWorkerInput,
  calculateWeightedChunkProgress,
  createSharedChunkInputBuffer,
  describeStreamingChunkTasks,
  planStreamingChunkParallelism,
  resolveStreamingChunkSizeMB,
  runTasksWithConcurrency,
  shouldUseStreamingEncoding,
  shouldUseSharedChunkInput,
} from "@web/services/streamingChunkOptimization";

describe("streaming chunk optimization", () => {
  it("uses larger automatic chunks for 100MB+ payloads", () => {
    expect(
      resolveStreamingChunkSizeMB({
        forceChunkMode: false,
        customChunkSize: 10,
        dataBytes: 50 * 1024 * 1024,
      }),
    ).toBe(10);

    expect(
      resolveStreamingChunkSizeMB({
        forceChunkMode: false,
        customChunkSize: 10,
        dataBytes: 104.41 * 1024 * 1024,
      }),
    ).toBe(20);

    expect(
      resolveStreamingChunkSizeMB({
        forceChunkMode: false,
        customChunkSize: 10,
        dataBytes: 550 * 1024 * 1024,
      }),
    ).toBe(50);
  });

  it("streams archive inputs once they exceed the automatic chunk size even under the inline limit", () => {
    expect(
      shouldUseStreamingEncoding({
        encodedBytes: 18 * 1024 * 1024,
        forceChunkMode: false,
        isArchiveInput: true,
        maxInlineBytes: 50 * 1024 * 1024,
      }),
    ).toBe(true);

    expect(
      shouldUseStreamingEncoding({
        encodedBytes: 18 * 1024 * 1024,
        forceChunkMode: false,
        isArchiveInput: false,
        maxInlineBytes: 50 * 1024 * 1024,
      }),
    ).toBe(false);
  });

  it("plans bounded chunk-level concurrency with per-coordinator worker limits", () => {
    expect(planStreamingChunkParallelism(1, 8)).toEqual({
      coordinatorCount: 1,
      qrWorkersPerCoordinator: 4,
      wasmThreadsPerCoordinator: 8,
    });

    expect(planStreamingChunkParallelism(6, 8)).toEqual({
      coordinatorCount: 2,
      qrWorkersPerCoordinator: 4,
      wasmThreadsPerCoordinator: 4,
    });

    expect(planStreamingChunkParallelism(12, 16)).toEqual({
      coordinatorCount: 3,
      qrWorkersPerCoordinator: 4,
      wasmThreadsPerCoordinator: 5,
    });
  });

  it("runs chunk jobs with bounded concurrency while preserving result order", async () => {
    let active = 0;
    let maxActive = 0;

    const tasks = [0, 1, 2, 3];

    const results = await runTasksWithConcurrency({
      tasks,
      concurrency: 2,
      runTask: async (task, slot) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => {
          setTimeout(resolve, task % 2 === 0 ? 10 : 1);
        });
        active -= 1;
        return `${slot}:${task}`;
      },
    });

    expect(maxActive).toBe(2);
    expect(results).toEqual(["0:0", "1:1", "1:2", "0:3"]);
  });

  it("describes streaming chunks lazily without pre-slicing payload buffers", () => {
    const data = new Uint8Array(10);
    const filenameBytes = new TextEncoder().encode("demo.bin");

    const tasks = describeStreamingChunkTasks({
      data,
      chunkSizeBytes: 4,
      filenameBytes,
      requestedPacketSize: 250,
    });

    expect(tasks).toEqual([
      {
        chunkId: 0,
        start: 0,
        end: 4,
        chunkBytes: 4,
        payloadLength: 17,
        finalPacketSize: 248,
        fallbackMinFrames: 1,
      },
      {
        chunkId: 1,
        start: 4,
        end: 8,
        chunkBytes: 4,
        payloadLength: 17,
        finalPacketSize: 248,
        fallbackMinFrames: 1,
      },
      {
        chunkId: 2,
        start: 8,
        end: 10,
        chunkBytes: 2,
        payloadLength: 15,
        finalPacketSize: 248,
        fallbackMinFrames: 1,
      },
    ]);

    expect(tasks.every((task) => !("chunkData" in task))).toBe(true);
  });

  it("calculates weighted progress from immutable chunk byte sizes", () => {
    const firstChunk = new Uint8Array(5);
    const secondChunk = new Uint8Array(15);

    const firstWeight = firstChunk.byteLength;
    const secondWeight = secondChunk.byteLength;

    structuredClone(firstChunk.buffer, { transfer: [firstChunk.buffer] });
    structuredClone(secondChunk.buffer, { transfer: [secondChunk.buffer] });

    expect(firstChunk.byteLength).toBe(0);
    expect(secondChunk.byteLength).toBe(0);

    expect(
      calculateWeightedChunkProgress([firstWeight, secondWeight], [100, 0]),
    ).toBe(25);
  });

  it("uses shared input only when the environment and workload justify it", () => {
    expect(
      shouldUseSharedChunkInput({
        totalChunks: 1,
        dataBytes: 20 * 1024 * 1024,
        sharedArrayBufferAvailable: true,
      }),
    ).toBe(false);

    expect(
      shouldUseSharedChunkInput({
        totalChunks: 3,
        dataBytes: 2 * 1024 * 1024,
        sharedArrayBufferAvailable: true,
      }),
    ).toBe(false);

    expect(
      shouldUseSharedChunkInput({
        totalChunks: 3,
        dataBytes: 20 * 1024 * 1024,
        sharedArrayBufferAvailable: false,
      }),
    ).toBe(false);

    expect(
      shouldUseSharedChunkInput({
        totalChunks: 3,
        dataBytes: 20 * 1024 * 1024,
        sharedArrayBufferAvailable: true,
      }),
    ).toBe(true);
  });

  it("builds chunk worker inputs from a single shared copy when available", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const sharedBuffer = createSharedChunkInputBuffer(data);

    expect(sharedBuffer).toBeInstanceOf(SharedArrayBuffer);

    const sharedInput = buildChunkWorkerInput({
      data,
      task: { start: 2, end: 5 },
      sharedInputBuffer: sharedBuffer,
    });

    expect("sharedChunkData" in sharedInput).toBe(true);
    expect(sharedInput).toEqual({
      sharedChunkData: {
        buffer: sharedBuffer,
        start: 2,
        end: 5,
      },
    });

    const fallbackInput = buildChunkWorkerInput({
      data,
      task: { start: 2, end: 5 },
      sharedInputBuffer: null,
    });

    expect("chunkData" in fallbackInput).toBe(true);
    expect(Array.from(fallbackInput.chunkData ?? [])).toEqual([3, 4, 5]);
  });
});
