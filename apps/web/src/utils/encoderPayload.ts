import { deflateSync } from 'fflate';

import type {
  EncoderParallelEncodePayload,
  EncoderWorkerConfig,
} from '../workers/encoderWorkerMessages';

const NO_COMPRESSION_FLAG = 0;
const DEFLATE_COMPRESSION_FLAG = 2;
const LARGE_PAYLOAD_THRESHOLD_BYTES = 500_000;
const COMPRESSION_PROBE_THRESHOLD_BYTES = 128 * 1024;
const COMPRESSION_PROBE_WINDOW_BYTES = 16 * 1024;
const COMPRESSION_PROBE_KEEP_RATIO = 0.98;

interface BuildParallelEncodePayloadOptions {
  filename: string;
  data: Uint8Array;
  sessionId: number;
  config: EncoderWorkerConfig;
}

interface BuildEncodedPayloadOptions {
  filename: string;
  data: Uint8Array;
  compressionEnabled: boolean;
}

interface BuildStreamingChunkPayloadOptions {
  filename: string;
  chunkData: Uint8Array;
  requestedPacketSize: number;
  compressionEnabled: boolean;
}

interface ResolveEffectivePacketSizeOptions {
  requestedPacketSize: number;
  encodedPayloadBytes: number;
}

interface BuildSingleChunkStreamingMetadataOptions {
  sessionId: number;
  totalFrames: number;
}

function buildNamedPayload(filename: string, data: Uint8Array): Uint8Array {
  const filenameBytes = new TextEncoder().encode(filename);
  const payload = new Uint8Array(4 + filenameBytes.length + data.length);
  const view = new DataView(payload.buffer);

  view.setUint32(0, filenameBytes.length, false);
  payload.set(filenameBytes, 4);
  payload.set(data, 4 + filenameBytes.length);

  return payload;
}

function buildCompressionProbeSample(payload: Uint8Array): Uint8Array {
  if (
    payload.byteLength <= COMPRESSION_PROBE_THRESHOLD_BYTES ||
    payload.byteLength <= COMPRESSION_PROBE_WINDOW_BYTES * 3
  ) {
    return payload;
  }

  const sample = new Uint8Array(COMPRESSION_PROBE_WINDOW_BYTES * 3);
  const middleStart = Math.max(
    COMPRESSION_PROBE_WINDOW_BYTES,
    Math.floor(payload.byteLength / 2 - COMPRESSION_PROBE_WINDOW_BYTES / 2),
  );
  const endStart = payload.byteLength - COMPRESSION_PROBE_WINDOW_BYTES;

  sample.set(payload.subarray(0, COMPRESSION_PROBE_WINDOW_BYTES), 0);
  sample.set(
    payload.subarray(
      middleStart,
      middleStart + COMPRESSION_PROBE_WINDOW_BYTES,
    ),
    COMPRESSION_PROBE_WINDOW_BYTES,
  );
  sample.set(
    payload.subarray(endStart, endStart + COMPRESSION_PROBE_WINDOW_BYTES),
    COMPRESSION_PROBE_WINDOW_BYTES * 2,
  );

  return sample;
}

export function shouldAttemptDeflateCompression(payload: Uint8Array): boolean {
  if (payload.byteLength <= COMPRESSION_PROBE_THRESHOLD_BYTES) {
    return true;
  }

  try {
    const probe = buildCompressionProbeSample(payload);
    const probeCompressed = deflateSync(probe, { level: 1 });
    return probeCompressed.byteLength < probe.byteLength * COMPRESSION_PROBE_KEEP_RATIO;
  } catch {
    // Keep the current fallback behavior on unexpected probe failures.
    return true;
  }
}

export function buildEncodedPayload({
  filename,
  data,
  compressionEnabled,
}: BuildEncodedPayloadOptions): Uint8Array {
  const payload = buildNamedPayload(filename, data);

  if (!compressionEnabled || payload.length <= 1024) {
    const rawPayload = new Uint8Array(1 + payload.length);
    rawPayload[0] = NO_COMPRESSION_FLAG;
    rawPayload.set(payload, 1);
    return rawPayload;
  }

  if (!shouldAttemptDeflateCompression(payload)) {
    const rawPayload = new Uint8Array(1 + payload.length);
    rawPayload[0] = NO_COMPRESSION_FLAG;
    rawPayload.set(payload, 1);
    return rawPayload;
  }

  try {
    const compressedPayload = deflateSync(payload, { level: 6 });
    if (compressedPayload.length < payload.length * 0.9) {
      const finalPayload = new Uint8Array(1 + compressedPayload.length);
      finalPayload[0] = DEFLATE_COMPRESSION_FLAG;
      finalPayload.set(compressedPayload, 1);
      return finalPayload;
    }
  } catch {
    // Fall back to raw payload when compression fails.
  }

  const rawPayload = new Uint8Array(1 + payload.length);
  rawPayload[0] = NO_COMPRESSION_FLAG;
  rawPayload.set(payload, 1);
  return rawPayload;
}

export function resolveEffectivePacketSize({
  requestedPacketSize,
  encodedPayloadBytes,
}: ResolveEffectivePacketSizeOptions): number {
  let packetSize = requestedPacketSize;

  if (
    encodedPayloadBytes > LARGE_PAYLOAD_THRESHOLD_BYTES &&
    packetSize === 250
  ) {
    packetSize = Math.max(
      250,
      Math.min(1500, Math.floor(encodedPayloadBytes / 2000))
    );
  }

  const alignedDown = Math.floor(packetSize / 4) * 4;
  const alignedUp = Math.ceil(packetSize / 4) * 4;
  packetSize =
    packetSize - alignedDown < alignedUp - packetSize ? alignedDown : alignedUp;
  if (packetSize <= 0) {
    return 4;
  }

  return packetSize;
}

export function buildParallelEncodePayload({
  filename,
  data,
  sessionId,
  config,
}: BuildParallelEncodePayloadOptions): EncoderParallelEncodePayload {
  return {
    filename,
    data,
    sessionId,
    frameDelay: Math.round(1000 / config.fps),
    ecc: config.ecc,
    packetSize: config.packetSize,
    targetSize: config.targetSize,
    scale: 1,
    raptorqOverhead: config.raptorqOverhead,
    compressionEnabled: config.compressionEnabled,
  };
}

export function buildSingleChunkStreamingMetadata({
  sessionId,
  totalFrames,
}: BuildSingleChunkStreamingMetadataOptions) {
  return {
    sessionId: Math.max(1, Math.trunc(sessionId)),
    chunkId: 0,
    totalChunks: 1,
    chunkOffset: 0,
    exactChunkPackets: Math.max(1, Math.trunc(totalFrames)),
  };
}

export function buildStreamingChunkPayload({
  filename,
  chunkData,
  requestedPacketSize,
  compressionEnabled,
}: BuildStreamingChunkPayloadOptions) {
  const encodedPayload = buildEncodedPayload({
    filename,
    data: chunkData,
    compressionEnabled,
  });

  return {
    encodedPayload,
    effectivePacketSize: resolveEffectivePacketSize({
      requestedPacketSize,
      encodedPayloadBytes: encodedPayload.length,
    }),
  };
}
