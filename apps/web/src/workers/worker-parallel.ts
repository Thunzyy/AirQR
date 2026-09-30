// Parallel Encoding Worker - Coordinates worker pool for QR generation
import init, {
  generate_raptorq_packets_raw,
  generate_raptorq_packets_raw_packed,
  initThreadPoolIfAvailable,
  measureStreamingQrPacketFrameSize,
} from "../wasm/airqrCoreThreaded";
import { QRWorkerPool } from "./qr-worker-pool";
import type { QRPacketTask } from "./qrWorkerMessages";
import { GifWriter } from "omggif";
import { writeGifFrame } from "./gifWriterInterop";
import { createContiguousBatchFlusher } from "./gifAssemblyPipeline";
import {
  buildPackedQrWorkerRange,
  createOwnedRaptorQPacketSource,
  createSharedRaptorQPacketSource,
  getPackedPacketByteLength,
  toTransferableQrWorkerPacket,
} from "./raptorqPacketTransfer";
import { createWorkerLogger } from './worker-logger';
import {
  buildEncodedPayload,
  buildSingleChunkStreamingMetadata,
  buildStreamingChunkPayload,
  resolveEffectivePacketSize,
} from "../utils/encoderPayload";
import { asWireFiniteNumber, errorMessage, globalHas } from "../parse/wire";
import type {
  EncoderWorkerRequest,
  EncoderWarmupConfig,
} from "./encoderWorkerMessages";

const logger = createWorkerLogger('workers:parallel');

// Worker pool instance
let workerPool: QRWorkerPool | null = null;
let wasmInitialized = false;
let wasmThreadPoolReady = false;
let warmupDone = false;
let warmupPromise: Promise<void> | null = null;

const toErrorMessage = (error: Error | string): string => errorMessage(error);

const runWarmup = async (
  config?: EncoderWarmupConfig
) => {
  if (warmupDone) return;
  if (warmupPromise) {
    return warmupPromise;
  }
  if (!workerPool) {
    throw new Error("Worker pool not initialized");
  }

  warmupPromise = (async () => {
    const ecc = config?.ecc ?? "MEDIUM";
    let packetSize = config?.packetSize ?? 256;
    const targetSize = config?.targetSize ?? 200;
    const scale = config?.scale ?? 1;
    const raptorqOverhead = config?.raptorqOverhead ?? 1.2;

    packetSize = Math.floor(packetSize / 4) * 4;
    if (packetSize <= 0) {
      packetSize = 4;
    }

    const payloadSize = Math.min(packetSize, 256);
    const payload = new Uint8Array(payloadSize);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = i & 0xff;
    }

    const { metadata, packets: packetsArray } = generate_raptorq_packets_raw(
      payload,
      packetSize,
      raptorqOverhead
    );
    if (!packetsArray || packetsArray.length === 0) {
      throw new Error("Warmup packets unavailable");
    }

    const packet = packetsArray[0];
    const packets = [
      toTransferableQrWorkerPacket(0, packet),
    ];

    await workerPool.encodeBatch({
      batchId: -1,
      packets,
      totalSize: metadata.totalSize,
      packetSize,
      eccLevel: ecc,
      targetSize,
      scale,
      useBitmap: false,
    });

    warmupDone = true;
  })();

  try {
    await warmupPromise;
  } finally {
    warmupPromise = null;
  }
};

interface GifAssemblyState {
  writeFrame: (buffer: Uint8Array) => void;
  getWrittenFrames: () => number;
  finalize: () => Uint8Array;
}

const createGifAssemblyState = (
  frameByteLength: number,
  totalFrames: number,
  frameDelay: number,
): GifAssemblyState => {
  const imgSize = Math.sqrt(frameByteLength);
  const gifWidth = imgSize;
  const gifHeight = imgSize;
  const estimatedSize =
    1024 + totalFrames * (Math.floor((imgSize * imgSize) / 2.5) + 20);
  const buf = new Uint8Array(estimatedSize);
  const gifWriter = new GifWriter(buf, gifWidth, gifHeight, {
    palette: [0xffffff, 0x000000],
    loop: 0,
  });
  const delay = Math.floor(frameDelay / 10);
  let writtenFrames = 0;

  return {
    writeFrame(buffer) {
      writeGifFrame(gifWriter, {
        x: 0,
        y: 0,
        width: gifWidth,
        height: gifHeight,
        indexedPixels: buffer,
        delay,
        disposal: 2,
      });
      writtenFrames += 1;
    },
    getWrittenFrames() {
      return writtenFrames;
    },
    finalize() {
      return buf.slice(0, gifWriter.end());
    },
  };
};

self.onmessage = async (e: MessageEvent<EncoderWorkerRequest>) => {
  const message = e.data;
  const { type } = message;

  if (type === "INIT") {
    try {
      const requestedPoolSizeValue = asWireFiniteNumber(message.payload?.qrPoolSize);
      const requestedPoolSize =
        requestedPoolSizeValue !== undefined && requestedPoolSizeValue > 0
          ? Math.floor(requestedPoolSizeValue)
          : undefined;
      const requestedWasmThreadCountValue = asWireFiniteNumber(
        message.payload?.wasmThreadCount,
      );
      const navigatorThreadCount =
        globalHas("navigator") &&
        Number.isFinite(navigator.hardwareConcurrency) &&
        navigator.hardwareConcurrency > 0
          ? Math.floor(navigator.hardwareConcurrency)
          : 1;
      const requestedWasmThreadCount =
        requestedWasmThreadCountValue !== undefined && requestedWasmThreadCountValue > 0
          ? Math.floor(requestedWasmThreadCountValue)
          : navigatorThreadCount;

      // Initialize main WASM
      await init();
      wasmInitialized = true;
      wasmThreadPoolReady = await initThreadPoolIfAvailable(
        requestedWasmThreadCount,
      );

      // Deflate compression enabled via fflate
      logger.info("Deflate compression enabled (fflate)");
      logger.info(
        wasmThreadPoolReady
          ? `WASM thread pool ready (${requestedWasmThreadCount} threads)`
          : "WASM thread pool unavailable, using single-threaded coordinator",
      );

      // Initialize worker pool
      workerPool = new QRWorkerPool(requestedPoolSize);
      await workerPool.init();

      self.postMessage({
        type: "INIT_SUCCESS",
        payload: {
          poolSize: workerPool.getPoolSize(),
        },
      });
    } catch (err) {
      self.postMessage({
        type: "ERROR",
        payload: `Failed to initialize: ${err}`,
      });
    }
  } else if (type === "WARMUP") {
    if (!wasmInitialized || !workerPool) {
      self.postMessage({
        type: "WARMUP_ERROR",
        payload: "Worker not initialized",
      });
      return;
    }

    try {
      await runWarmup(message.payload);
      self.postMessage({ type: "WARMUP_COMPLETE" });
    } catch (err) {
      self.postMessage({
        type: "WARMUP_ERROR",
        payload: toErrorMessage(err instanceof Error ? err : String(err)),
      });
    }
    return;
  } else if (type === "TERMINATE") {
    try {
      await workerPool?.terminate();
    } catch {
      // Ignore termination errors.
    }
    workerPool = null;
    wasmInitialized = false;
    wasmThreadPoolReady = false;
    warmupDone = false;
    warmupPromise = null;
    self.close();
    return;
  } else if (
    type === "ENCODE_STREAMING_CHUNK" &&
    wasmInitialized &&
    workerPool
  ) {
    const {
      filename,
      chunkData,
      sharedChunkData,
      chunkId,
      totalChunks,
      sessionId,
      chunkSizeMB,
      compressionEnabled,
      frameDelay,
      ecc,
      packetSize,
      targetSize,
      scale,
      raptorqOverhead,
    } = message.payload;

    try {
      const resolvedChunkData =
        chunkData ??
        (sharedChunkData
          ? new Uint8Array(
              sharedChunkData.buffer,
              sharedChunkData.start,
              sharedChunkData.end - sharedChunkData.start,
            )
          : null);

      if (!resolvedChunkData) {
        throw new Error("Streaming chunk payload missing chunk data");
      }

      const startTime = performance.now();
      logger.debug(`Encoding streaming chunk ${chunkId + 1}/${totalChunks}`);
      logger.debug(`Chunk size: ${resolvedChunkData.length} bytes`);
      logger.debug(
        `Session ID: ${sessionId}, Chunk ID: ${chunkId}, Total: ${totalChunks}`
      );

      // === Parallel Streaming Implementation ===
      const { encodedPayload, effectivePacketSize } = buildStreamingChunkPayload({
        filename,
        chunkData: resolvedChunkData,
        requestedPacketSize: packetSize,
        compressionEnabled,
      });

      logger.debug(
        `Streaming Config: DataLen=${encodedPayload.length}, PacketSize=${effectivePacketSize}`
      );

      // 3. Generate RaptorQ Packets (WASM)
      self.postMessage({
        type: "PROGRESS",
        payload: { phase: "Generating packets", percent: 0 },
      });

      const packedPacketSet = generate_raptorq_packets_raw_packed(
        encodedPayload,
        effectivePacketSize,
        raptorqOverhead
      );
      const metadata = packedPacketSet.metadata;
      const packedPacketSource =
        globalHas("SharedArrayBuffer")
          ? createSharedRaptorQPacketSource(packedPacketSet.packed)
          : createOwnedRaptorQPacketSource(packedPacketSet.packed);
      const totalFrames = metadata.totalPackets;

      const totalSize = metadata.totalSize;
      // Keep min-required aligned with decoder logic: ceil(total_size / header packet_size).
      // Header packet_size is the actual payload size written in each QR frame.
      const firstPacketPayloadSize =
        getPackedPacketByteLength(packedPacketSet.packed.packetOffsets, 0);
      const minPackets = Math.ceil(totalSize / Math.max(1, firstPacketPayloadSize));

      // 4. Trace Chunk Offset
      const chunkSizeBytes = chunkSizeMB * 1024 * 1024;
      const chunkOffset = chunkId * chunkSizeBytes;

      self.postMessage({
        type: "METADATA",
        payload: {
          minFrames: minPackets,
          totalFrames,
          chunkId,
          packetSize: firstPacketPayloadSize,
          effectivePacketSize,
          encodedPayloadBytes: encodedPayload.length,
        },
      });

      // 5. Encoded Parallel with SharedArrayBuffer
      logger.info(`Distributed Streaming: ${totalFrames} frames`);

      const poolSize = workerPool.getPoolSize();
      const batchSize = Math.max(64, Math.ceil(totalFrames / (poolSize * 3)));

      let sharedBuffer: SharedArrayBuffer | null = null;
      let actualFrameSize = 0;

      self.postMessage({
        type: "PROGRESS",
        payload: { phase: "Encoding QR codes (parallel)", percent: 0 },
      });

      // Step 1: Measure the frame size directly from WASM so workers can start immediately.
      const firstPacketData = packedPacketSet.packed.packetData.subarray(
        packedPacketSet.packed.packetOffsets[0],
        packedPacketSet.packed.packetOffsets[1],
      );
      const firstPacketId = packedPacketSet.packed.packetIds.subarray(
        packedPacketSet.packed.packetIdOffsets[0],
        packedPacketSet.packed.packetIdOffsets[1],
      );
      actualFrameSize = measureStreamingQrPacketFrameSize(
        firstPacketData,
        firstPacketId,
        sessionId,
        chunkId,
        totalChunks,
        chunkOffset,
        totalSize,
        effectivePacketSize,
        totalFrames,
        ecc,
        targetSize,
        scale,
      );

      logger.debug(
        `Streaming frame size: ${Math.sqrt(actualFrameSize)}x${Math.sqrt(
          actualFrameSize
        )} = ${actualFrameSize} bytes`
      );

      const gifAssembly = createGifAssemblyState(
        actualFrameSize,
        totalFrames,
        frameDelay
      );

      // Step 2: Try to allocate SharedArrayBuffer
      if (globalHas("SharedArrayBuffer") && totalFrames > 1) {
        try {
          const totalBufferSize = totalFrames * actualFrameSize;
          sharedBuffer = new SharedArrayBuffer(totalBufferSize);
          logger.debug(
            `Streaming SharedArrayBuffer: ${(
              totalBufferSize /
              1024 /
              1024
            ).toFixed(2)}MB`
          );
        } catch (e) {
          logger.warn("SharedArrayBuffer allocation failed:", { error: String(e) });
          sharedBuffer = null;
        }
      }

      // Step 3: Process all packets
      if (totalFrames > 0) {
        const batchCount = Math.ceil(totalFrames / batchSize);
        const sharedView = sharedBuffer ? new Uint8Array(sharedBuffer) : null;
        const sharedBatchFlusher = sharedView
          ? createContiguousBatchFlusher<{ count: number }>({
              initialStart: 0,
              getBatchLength: (batch) => batch.count,
              onFlushBatch: (start, batch) => {
                for (let frameId = start; frameId < start + batch.count; frameId++) {
                  const offset = frameId * actualFrameSize;
                  gifAssembly.writeFrame(
                    sharedView.subarray(offset, offset + actualFrameSize),
                  );
                }
              },
            })
          : null;
        const bufferedBatchFlusher = !sharedView
          ? createContiguousBatchFlusher<Array<{ id: number; buffer: Uint8Array }>>({
              initialStart: 0,
              getBatchLength: (batch) => batch.length,
              onFlushBatch: (_start, batch) => {
                batch.forEach((frame) => {
                  gifAssembly.writeFrame(frame.buffer);
                });
              },
            })
          : null;
        const batchPromises = [];

        for (let i = 0; i < batchCount; i++) {
          const start = i * batchSize;
          const end = Math.min(start + batchSize, totalFrames);

          const task: QRPacketTask = {
            batchId: i,
            totalSize,
            packetSize: effectivePacketSize,
            eccLevel: ecc,
            targetSize,
            scale,
            streamingMetadata: {
              sessionId,
              chunkId,
              totalChunks,
              chunkOffset,
              exactChunkPackets: totalFrames,
            },
          };
          task.packedPackets = buildPackedQrWorkerRange(
            packedPacketSource,
            start,
            end,
          );

          if (sharedBuffer) {
            task.sharedBuffer = {
              buffer: sharedBuffer,
              frameSize: actualFrameSize,
              startOffset: start * actualFrameSize,
            };
          }

          batchPromises.push(
            workerPool.encodeBatch(task).then((res) => {
              if (sharedBatchFlusher) {
                sharedBatchFlusher.add(start, { count: end - start });
              } else if (bufferedBatchFlusher) {
                bufferedBatchFlusher.add(start, res.frames);
              }
              if (i % 5 === 0 || i === batchCount - 1) {
                const percent = Math.floor(((i + 1) / batchCount) * 100);
                self.postMessage({
                  type: "PROGRESS",
                  payload: { phase: "Encoding QR codes (parallel)", percent },
                });
              }
              return res;
            })
          );
        }

        await Promise.all(batchPromises);
      }

      if (gifAssembly.getWrittenFrames() !== totalFrames) {
        throw new Error(
          `Streaming GIF assembly pipeline stalled before completion (${gifAssembly.getWrittenFrames()}/${totalFrames})`,
        );
      }

      self.postMessage({
        type: "PROGRESS",
        payload: { phase: "Assembling GIF", percent: 100 },
      });

      const gifData = gifAssembly.finalize();
      const totalTime = performance.now() - startTime;

      logger.info(
        `Chunk GIF created: ${gifData.length} bytes in ${totalTime.toFixed(
          0
        )}ms`
      );
      const completeBuffer = gifData.buffer;
      if (completeBuffer instanceof ArrayBuffer) {
        self.postMessage(
          { type: "COMPLETE", payload: gifData },
          { transfer: [completeBuffer] },
        );
      } else {
        self.postMessage({ type: "COMPLETE", payload: gifData });
      }

      //   const gifData = encode_streaming_from_bytes(
      //     chunkData,           // Chunk data (not full file!)
      //     filename,            // Original filename
      //     chunkId,             // Current chunk number
      //     totalChunks,         // Total number of chunks
      //     sessionId,           // Session identifier
      //     chunkSizeMB,         // Chunk size in MB
      //     compressionEnabled,  // Compression (disabled for WASM)
      //     frameDelay,          // Frame delay in ms
      //     ecc,                 // ECC level
      //     packetSize,          // Packet size in bytes
      //     raptorqOverhead,     // RaptorQ overhead
      //     (phase: string, current: number, total: number) => {
      //       // Progress callback
      //       const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
      //       self.postMessage({
      //         type: "PROGRESS",
      //         payload: { phase, percent },
      //       });
      //     }
      //   );
    } catch (err) {
      logger.error("Streaming chunk encoding error:", { error: String(err) });
      self.postMessage({ type: "ERROR", payload: `Encoding failed: ${err}` });
    }
  } else if (type === "ENCODE_PARALLEL" && wasmInitialized && workerPool) {
    const {
      filename,
      data,
      sessionId,
      frameDelay,
      ecc,
      packetSize,
      targetSize,
      scale,
      raptorqOverhead,
      compressionEnabled,
      batchSize,
    } = message.payload;

    try {
      const startTime = performance.now();
      logger.info("Using PARALLEL encoding with worker pool");
      logger.debug(`Pool size: ${workerPool.getPoolSize()} workers`);
      logger.debug("Parameters:", {
        filename,
        dataSize: data.length,
        batchSize,
        packetSize,
      });

      // Size validation: WASM has ~2GB memory limit, be conservative
      const MAX_SIZE = 50 * 1024 * 1024; // 50MB limit before compression
      if (data.length > MAX_SIZE) {
        throw new Error(
          `File too large: ${(data.length / 1024 / 1024).toFixed(1)}MB. ` +
            `Maximum supported: ${MAX_SIZE / 1024 / 1024}MB. ` +
            `Enable compression or use chunked encoding for larger files.`
        );
      }

      const finalPayload = buildEncodedPayload({
        filename,
        data,
        compressionEnabled,
      });
      const effectivePacketSize = resolveEffectivePacketSize({
        requestedPacketSize: packetSize,
        encodedPayloadBytes: finalPayload.length,
      });

      // === Phase 2: RaptorQ Encoding (sequential) ===
      self.postMessage({
        type: "PROGRESS",
        payload: { phase: "Generating packets", percent: 0 },
      });

      // Use WASM to generate RaptorQ packets (with pre-compressed payload)
      const packedPacketSet = generate_raptorq_packets_raw_packed(
        finalPayload,
        effectivePacketSize,
        raptorqOverhead
      );
      const metadata = packedPacketSet.metadata;
      const packedPacketSource =
        globalHas("SharedArrayBuffer")
          ? createSharedRaptorQPacketSource(packedPacketSet.packed)
          : createOwnedRaptorQPacketSource(packedPacketSet.packed);

      const totalSize = metadata.totalSize;
      const totalFrames = metadata.totalPackets;
      const streamingMetadata = buildSingleChunkStreamingMetadata({
        sessionId,
        totalFrames,
      });
      // Keep min-required aligned with decoder logic: ceil(total_size / header packet_size).
      // Header packet_size is the actual payload size written in each QR frame.
      const firstPacketPayloadSize =
        getPackedPacketByteLength(packedPacketSet.packed.packetOffsets, 0);
      const minPackets = Math.ceil(totalSize / Math.max(1, firstPacketPayloadSize));

      logger.info(
        `Got ${totalFrames} packets (min required: ${minPackets}, header packet size: ${firstPacketPayloadSize})`
      );

      self.postMessage({
        type: "METADATA",
        payload: {
          minFrames: minPackets,
          totalFrames,
          packetSize: firstPacketPayloadSize,
          effectivePacketSize,
          encodedPayloadBytes: finalPayload.length,
        },
      });

      // Adaptive batch sizing: aim for ~3 batches per worker for optimal distribution
      const poolSize = workerPool.getPoolSize();
      const adaptiveBatchSize = Math.max(
        64,
        Math.ceil(totalFrames / (poolSize * 3))
      );
      const finalBatchSize =
        batchSize !== undefined ? batchSize : adaptiveBatchSize;

      logger.debug(
        `Batch config: ${finalBatchSize} packets/batch (pool: ${poolSize} workers)`
      );

      // === Phase 3: Parallel QR Encoding with SharedArrayBuffer ===
      self.postMessage({
        type: "PROGRESS",
        payload: { phase: "Encoding QR codes (parallel)", percent: 0 },
      });

      let sharedBuffer: SharedArrayBuffer | null = null;
      const firstPacketData = packedPacketSet.packed.packetData.subarray(
        packedPacketSet.packed.packetOffsets[0],
        packedPacketSet.packed.packetOffsets[1],
      );
      const firstPacketId = packedPacketSet.packed.packetIds.subarray(
        packedPacketSet.packed.packetIdOffsets[0],
        packedPacketSet.packed.packetIdOffsets[1],
      );
      const detectedFrameSize = measureStreamingQrPacketFrameSize(
        firstPacketData,
        firstPacketId,
        streamingMetadata.sessionId,
        streamingMetadata.chunkId,
        streamingMetadata.totalChunks,
        streamingMetadata.chunkOffset,
        totalSize,
        effectivePacketSize,
        streamingMetadata.exactChunkPackets,
        ecc,
        targetSize,
        scale,
      );

      logger.debug(
        `Actual frame size: ${Math.sqrt(detectedFrameSize)}x${Math.sqrt(
          detectedFrameSize
        )} = ${detectedFrameSize} bytes`
      );

      const gifAssembly = createGifAssemblyState(
        detectedFrameSize,
        totalFrames,
        frameDelay
      );

      // Step 2: Try to allocate SharedArrayBuffer with actual size
      if (globalHas("SharedArrayBuffer") && totalFrames > 1) {
        try {
          const totalBufferSize = totalFrames * detectedFrameSize;
          sharedBuffer = new SharedArrayBuffer(totalBufferSize);
          logger.debug(
            `SharedArrayBuffer: ${(totalBufferSize / 1024 / 1024).toFixed(
              2
            )}MB for ${totalFrames} frames`
          );
        } catch (e) {
          logger.warn("SharedArrayBuffer allocation failed:", { error: String(e) });
          sharedBuffer = null;
        }
      }

      // Step 3: Process all packets
      if (totalFrames > 0) {
        const batchCount = Math.ceil(totalFrames / finalBatchSize);
        logger.info(
          `Distributing ${totalFrames} packets across ${batchCount} batches`
        );

        const sharedView = sharedBuffer ? new Uint8Array(sharedBuffer) : null;
        const sharedBatchFlusher = sharedView
          ? createContiguousBatchFlusher<{ count: number }>({
              initialStart: 0,
              getBatchLength: (batch) => batch.count,
              onFlushBatch: (start, batch) => {
                for (let frameId = start; frameId < start + batch.count; frameId++) {
                  const offset = frameId * detectedFrameSize;
                  gifAssembly.writeFrame(
                    sharedView.subarray(offset, offset + detectedFrameSize),
                  );
                }
              },
            })
          : null;
        const bufferedBatchFlusher = !sharedView
          ? createContiguousBatchFlusher<Array<{ id: number; buffer: Uint8Array }>>({
              initialStart: 0,
              getBatchLength: (batch) => batch.length,
              onFlushBatch: (_start, batch) => {
                batch.forEach((frame) => {
                  gifAssembly.writeFrame(frame.buffer);
                });
              },
            })
          : null;
        const batchPromises = [];

        for (let i = 0; i < batchCount; i++) {
          const start = i * finalBatchSize;
          const end = Math.min(start + finalBatchSize, totalFrames);

          const task: QRPacketTask = {
            batchId: i,
            totalSize,
            packetSize: effectivePacketSize,
            eccLevel: ecc,
            targetSize,
            scale,
            streamingMetadata,
            useBitmap: false,
          };
          task.packedPackets = buildPackedQrWorkerRange(
            packedPacketSource,
            start,
            end,
          );

          if (sharedBuffer) {
            task.sharedBuffer = {
              buffer: sharedBuffer,
              frameSize: detectedFrameSize,
              startOffset: start * detectedFrameSize,
            };
          }

          batchPromises.push(
            workerPool.encodeBatch(task).then((result) => {
              if (sharedBatchFlusher) {
                sharedBatchFlusher.add(start, { count: end - start });
              } else if (bufferedBatchFlusher) {
                bufferedBatchFlusher.add(start, result.frames);
              }
              if (i % 10 === 0 || i === batchCount - 1) {
                const progress = Math.floor(((i + 1) / batchCount) * 100);
                self.postMessage({
                  type: "PROGRESS",
                  payload: {
                    phase: "Encoding QR codes (parallel)",
                    percent: progress,
                    current: end,
                    total: totalFrames,
                  },
                });
              }
              return result;
            })
          );
        }

        await Promise.all(batchPromises);
      }

      logger.info(`Encoded ${totalFrames} QR codes in parallel`);

      const qrEncodingTime = performance.now() - startTime;
      logger.debug(`QR encoding time: ${qrEncodingTime.toFixed(0)}ms`);

      if (gifAssembly.getWrittenFrames() !== totalFrames) {
        throw new Error(
          `GIF assembly pipeline stalled before completion (${gifAssembly.getWrittenFrames()}/${totalFrames})`,
        );
      }

      self.postMessage({
        type: "PROGRESS",
        payload: { phase: "Assembling GIF", percent: 100 },
      });

      const gifData = gifAssembly.finalize();
      const totalTime = performance.now() - startTime;

      logger.info(`GIF created: ${gifData.length} bytes`);
      logger.debug(`Total time: ${totalTime.toFixed(0)}ms`);
      logger.debug(
        `Speedup estimate: ${((totalFrames * 20) / totalTime).toFixed(
          1
        )}x faster than sequential`
      );

      const completeBuffer = gifData.buffer;
      if (completeBuffer instanceof ArrayBuffer) {
        self.postMessage(
          { type: "COMPLETE", payload: gifData },
          { transfer: [completeBuffer] },
        );
      } else {
        self.postMessage({ type: "COMPLETE", payload: gifData });
      }
    } catch (err) {
      logger.error("Encoding error:", { error: String(err) });
      self.postMessage({ type: "ERROR", payload: `Encoding failed: ${err}` });
    }
  }
};
