import type { ECCLevel } from "../types";
import {
  asUint8Array,
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  isWireNumber,
  isWireObject,
  isWireString,
  type WireValue,
} from "../parse/wire";

export interface EncoderWarmupConfig {
  ecc?: ECCLevel;
  packetSize?: number;
  targetSize?: number;
  scale?: number;
  raptorqOverhead?: number;
}

export interface EncoderWorkerInitPayload {
  qrPoolSize?: number;
  wasmThreadCount?: number;
}

export interface EncoderWorkerConfig {
  fps: number;
  ecc: ECCLevel;
  packetSize: number;
  targetSize: number;
  raptorqOverhead: number;
  compressionEnabled: boolean;
}

export interface EncoderParallelEncodePayload {
  filename: string;
  data: Uint8Array;
  sessionId: number;
  frameDelay: number;
  ecc: ECCLevel;
  packetSize: number;
  targetSize: number;
  scale: number;
  raptorqOverhead: number;
  compressionEnabled: boolean;
  batchSize?: number;
}

export interface EncoderSharedChunkInputPayload {
  buffer: SharedArrayBuffer;
  start: number;
  end: number;
}

export interface EncoderStreamingChunkEncodePayload {
  filename: string;
  chunkData?: Uint8Array;
  sharedChunkData?: EncoderSharedChunkInputPayload;
  chunkId: number;
  totalChunks: number;
  sessionId: number;
  chunkSizeMB: number;
  compressionEnabled: boolean;
  frameDelay: number;
  ecc: ECCLevel;
  packetSize: number;
  targetSize: number;
  scale: number;
  raptorqOverhead: number;
}

export interface EncoderWorkerProgressPayload {
  phase: string;
  percent: number;
  current?: number;
  total?: number;
}

export interface EncoderWorkerMetadataPayload {
  minFrames: number;
  totalFrames: number;
  packetSize?: number;
  effectivePacketSize?: number;
  encodedPayloadBytes?: number;
  chunkId?: number;
}

export type EncoderWorkerBinaryPayload = Uint8Array | ArrayBuffer;

export type EncoderWorkerInitMessage = {
  type: "INIT";
  payload?: EncoderWorkerInitPayload;
};
export type EncoderWorkerWarmupMessage = {
  type: "WARMUP";
  payload?: EncoderWarmupConfig;
};
export type EncoderWorkerEncodeParallelMessage = {
  type: "ENCODE_PARALLEL";
  payload: EncoderParallelEncodePayload;
};
export type EncoderWorkerEncodeStreamingChunkMessage = {
  type: "ENCODE_STREAMING_CHUNK";
  payload: EncoderStreamingChunkEncodePayload;
};
export type EncoderWorkerTerminateMessage = { type: "TERMINATE" };

export type EncoderWorkerRequestMessage =
  | EncoderWorkerInitMessage
  | EncoderWorkerWarmupMessage
  | EncoderWorkerEncodeParallelMessage
  | EncoderWorkerEncodeStreamingChunkMessage
  | EncoderWorkerTerminateMessage;

export type EncoderWorkerRequest = EncoderWorkerRequestMessage;

export type EncoderWorkerInitSuccessMessage = {
  type: "INIT_SUCCESS";
  payload: { poolSize: number };
};
export type EncoderWorkerWarmupCompleteMessage = { type: "WARMUP_COMPLETE" };
export type EncoderWorkerWarmupErrorMessage = {
  type: "WARMUP_ERROR";
  payload: string;
};
export type EncoderWorkerProgressMessage = {
  type: "PROGRESS";
  payload: EncoderWorkerProgressPayload;
};
export type EncoderWorkerMetadataMessage = {
  type: "METADATA";
  payload: EncoderWorkerMetadataPayload;
};
export type EncoderWorkerCompleteMessage = {
  type: "COMPLETE";
  payload: EncoderWorkerBinaryPayload;
};
export type EncoderWorkerErrorMessage = {
  type: "ERROR";
  payload: string;
};

export type EncoderWorkerResponseMessage =
  | EncoderWorkerInitSuccessMessage
  | EncoderWorkerWarmupCompleteMessage
  | EncoderWorkerWarmupErrorMessage
  | EncoderWorkerProgressMessage
  | EncoderWorkerMetadataMessage
  | EncoderWorkerCompleteMessage
  | EncoderWorkerErrorMessage;

export type NormalizedEncoderWorkerCompleteMessage = {
  type: "COMPLETE";
  payload: Uint8Array;
};

export type EncoderWorkerResponse =
  | EncoderWorkerInitSuccessMessage
  | EncoderWorkerWarmupCompleteMessage
  | EncoderWorkerWarmupErrorMessage
  | EncoderWorkerProgressMessage
  | EncoderWorkerMetadataMessage
  | NormalizedEncoderWorkerCompleteMessage
  | EncoderWorkerErrorMessage;

const ENCODER_PROGRESS_PHASE_RANGES: Array<{
  match: string;
  start: number;
  end: number;
}> = [
  { match: "Generating packets", start: 0, end: 5 },
  { match: "Encoding QR codes (parallel)", start: 5, end: 90 },
  { match: "Assembling GIF", start: 90, end: 100 },
];

function isBinaryPayload(value: WireValue | undefined): boolean {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function isProgressPayload(value: WireValue | undefined): boolean {
  if (!isWireObject(value) || !isWireString(value.phase) || !isWireNumber(value.percent)) {
    return false;
  }

  return (
    (value.current === undefined || isWireNumber(value.current)) &&
    (value.total === undefined || isWireNumber(value.total))
  );
}

function isMetadataPayload(value: WireValue | undefined): boolean {
  if (
    !isWireObject(value) ||
    !isWireNumber(value.minFrames) ||
    !isWireNumber(value.totalFrames)
  ) {
    return false;
  }

  return (
    (value.packetSize === undefined || isWireNumber(value.packetSize)) &&
    (value.effectivePacketSize === undefined || isWireNumber(value.effectivePacketSize)) &&
    (value.encodedPayloadBytes === undefined || isWireNumber(value.encodedPayloadBytes)) &&
    (value.chunkId === undefined || isWireNumber(value.chunkId))
  );
}

export function isEncoderWorkerResponse(value: WireValue): boolean {
  if (!isWireObject(value) || !isWireString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "INIT_SUCCESS":
      return isWireObject(value.payload) && isWireNumber(value.payload.poolSize);
    case "WARMUP_COMPLETE":
      return true;
    case "WARMUP_ERROR":
    case "ERROR":
      return isWireString(value.payload);
    case "PROGRESS":
      return isProgressPayload(value.payload);
    case "METADATA":
      return isMetadataPayload(value.payload);
    case "COMPLETE":
      return isBinaryPayload(value.payload);
    default:
      return false;
  }
}

export function hasEncoderWorkerResponseType(
  value: WireValue,
  type: EncoderWorkerResponseMessage["type"],
): boolean {
  return isEncoderWorkerResponse(value) && asWireString(asWireObject(value).type) === type;
}

export function toOverallEncoderProgress(
  payload: EncoderWorkerProgressPayload,
): number {
  const normalizedPercent = Math.max(0, Math.min(100, payload.percent));
  const phaseRange = ENCODER_PROGRESS_PHASE_RANGES.find(
    ({ match }) => payload.phase === match,
  );

  if (!phaseRange) {
    return normalizedPercent;
  }

  const phaseSpan = phaseRange.end - phaseRange.start;
  return Math.floor(phaseRange.start + (normalizedPercent / 100) * phaseSpan);
}

export function advanceOverallEncoderProgress(
  previousProgress: number,
  payload: EncoderWorkerProgressPayload,
): number {
  return Math.max(previousProgress, toOverallEncoderProgress(payload));
}

export function normalizeEncoderWorkerMessage(
  rawMessage: WireValue,
): EncoderWorkerResponse | null {
  const message = asWireObject(rawMessage);
  const type = asWireString(message.type);
  const payload = message.payload;
  const payloadRecord = asWireObject(payload);

  switch (type) {
    case "INIT_SUCCESS":
      return {
        type,
        payload: {
          poolSize: asWireFiniteNumber(payloadRecord.poolSize) ?? 0,
        },
      };
    case "WARMUP_COMPLETE":
      return { type };
    case "WARMUP_ERROR":
    case "ERROR":
      return {
        type,
        payload: asWireString(payload) ?? "Unknown worker error",
      };
    case "PROGRESS": {
      const percent = asWireFiniteNumber(payloadRecord.percent);
      const phase = asWireString(payloadRecord.phase);
      if (percent === undefined || phase === undefined) {
        return null;
      }

      const progressPayload: EncoderWorkerProgressPayload = {
        phase,
        percent,
      };
      const current = asWireFiniteNumber(payloadRecord.current);
      if (current !== undefined) {
        progressPayload.current = current;
      }
      const total = asWireFiniteNumber(payloadRecord.total);
      if (total !== undefined) {
        progressPayload.total = total;
      }
      return {
        type,
        payload: progressPayload,
      };
    }
    case "METADATA": {
      const minFrames = asWireFiniteNumber(payloadRecord.minFrames);
      const totalFrames = asWireFiniteNumber(payloadRecord.totalFrames);
      if (minFrames === undefined || totalFrames === undefined) {
        return null;
      }

      const metadataPayload: EncoderWorkerMetadataPayload = {
        minFrames,
        totalFrames,
      };
      const packetSize = asWireFiniteNumber(payloadRecord.packetSize);
      if (packetSize !== undefined) {
        metadataPayload.packetSize = packetSize;
      }
      const effectivePacketSize = asWireFiniteNumber(payloadRecord.effectivePacketSize);
      if (effectivePacketSize !== undefined) {
        metadataPayload.effectivePacketSize = effectivePacketSize;
      }
      const encodedPayloadBytes = asWireFiniteNumber(payloadRecord.encodedPayloadBytes);
      if (encodedPayloadBytes !== undefined) {
        metadataPayload.encodedPayloadBytes = encodedPayloadBytes;
      }
      const chunkId = asWireFiniteNumber(payloadRecord.chunkId);
      if (chunkId !== undefined) {
        metadataPayload.chunkId = chunkId;
      }
      return {
        type,
        payload: metadataPayload,
      };
    }
    case "COMPLETE": {
      const completePayload = asUint8Array(payload);
      if (!completePayload) {
        return null;
      }

      return {
        type,
        payload: completePayload,
      };
    }
    default:
      return null;
  }
}
