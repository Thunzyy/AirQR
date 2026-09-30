import {
  asUint8Array,
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  globalHas,
  isWireArray,
  isWireBoolean,
  isWireNumber,
  isWireObject,
  isWireString,
  type WireValue,
} from "../parse/wire";
import type { PackedQrWorkerPacketRange } from "./raptorqPacketTransfer";

export interface QRPacketTask {
  batchId: number;
  packets?: Array<{
    id: number;
    data: Uint8Array;
    packetId: Uint8Array;
  }>;
  packedPackets?: PackedQrWorkerPacketRange;
  totalSize: number;
  packetSize: number;
  eccLevel: string;
  targetSize: number;
  scale: number;
  streamingMetadata?: {
    sessionId: number;
    chunkId: number;
    totalChunks: number;
    chunkOffset: number;
    exactChunkPackets: number;
  };
  sharedBuffer?: {
    buffer: SharedArrayBuffer;
    frameSize: number;
    startOffset: number;
  };
  useBitmap?: boolean;
}

export interface QRPacketFrame {
  id: number;
  buffer: Uint8Array;
  bitmap?: ImageBitmap;
}

export interface QRPacketResult {
  batchId: number;
  frames: QRPacketFrame[];
  frameCount?: number;
  frameWidth?: number;
  frameHeight?: number;
}

export type QrWorkerInitMessage = { type: "INIT" };
export type QrWorkerEncodeBatchMessage = {
  type: "ENCODE_BATCH";
  data: QRPacketTask;
};
export type QrWorkerTerminateMessage = { type: "TERMINATE" };

export type QrWorkerRequestMessage =
  | QrWorkerInitMessage
  | QrWorkerEncodeBatchMessage
  | QrWorkerTerminateMessage;

export type QrWorkerRequest = QrWorkerRequestMessage;

export type QrWorkerInitSuccessMessage = {
  type: "INIT_SUCCESS";
  hasOffscreenCanvas: boolean;
};

export type QrWorkerBatchCompleteMessage = {
  type: "BATCH_COMPLETE";
  payload: QRPacketResult;
};

export type QrWorkerErrorMessage = {
  type: "ERROR";
  payload: string;
};

export type QrWorkerResponseMessage =
  | QrWorkerInitSuccessMessage
  | QrWorkerBatchCompleteMessage
  | QrWorkerErrorMessage;

export type QrWorkerResponse = QrWorkerResponseMessage;

function isQrPacketFrame(value: WireValue): boolean {
  if (!isWireObject(value)) {
    return false;
  }

  return isWireNumber(value.id) && value.buffer instanceof Uint8Array;
}

function isQrPacketResult(value: WireValue | undefined): boolean {
  if (!isWireObject(value) || !isWireNumber(value.batchId)) {
    return false;
  }

  if (!isWireArray(value.frames) || !value.frames.every(isQrPacketFrame)) {
    return false;
  }

  return (
    (value.frameCount === undefined || isWireNumber(value.frameCount)) &&
    (value.frameWidth === undefined || isWireNumber(value.frameWidth)) &&
    (value.frameHeight === undefined || isWireNumber(value.frameHeight))
  );
}

export function isQrWorkerResponse(value: WireValue): boolean {
  if (!isWireObject(value) || !isWireString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "INIT_SUCCESS":
      return isWireBoolean(value.hasOffscreenCanvas);
    case "BATCH_COMPLETE":
      return isQrPacketResult(value.payload);
    case "ERROR":
      return isWireString(value.payload);
    default:
      return false;
  }
}

export function hasQrWorkerResponseType(
  value: WireValue,
  type: QrWorkerResponseMessage["type"],
): boolean {
  return isQrWorkerResponse(value) && asWireString(asWireObject(value).type) === type;
}

function parseQrPacketFrame(value: WireValue): QRPacketFrame | null {
  const frameRecord = asWireObject(value);
  const id = asWireFiniteNumber(frameRecord.id);
  const buffer = asUint8Array(frameRecord.buffer);
  if (id === undefined || !buffer) {
    return null;
  }

  const frame: QRPacketFrame = {
    id,
    buffer,
  };
  if (globalHas("ImageBitmap") && frameRecord.bitmap instanceof ImageBitmap) {
    frame.bitmap = frameRecord.bitmap;
  }
  return frame;
}

export function normalizeQrWorkerMessage(
  rawMessage: WireValue,
): QrWorkerResponse | null {
  const message = asWireObject(rawMessage);
  const type = message.type;

  if (type === "INIT_SUCCESS") {
    return {
      type,
      hasOffscreenCanvas: Boolean(message.hasOffscreenCanvas),
    };
  }

  if (type === "ERROR") {
    return {
      type,
      payload: asWireString(message.payload) ?? "Unknown QR worker error",
    };
  }

  if (type !== "BATCH_COMPLETE") {
    return null;
  }

  const payload = asWireObject(message.payload);
  const batchId = asWireFiniteNumber(payload.batchId);
  const frames = isWireArray(payload.frames) ? payload.frames : null;
  if (batchId === undefined || !frames) {
    return null;
  }

  const normalizedFrames: QRPacketFrame[] = [];
  for (const frame of frames) {
    const normalizedFrame = parseQrPacketFrame(frame);
    if (!normalizedFrame) {
      return null;
    }
    normalizedFrames.push(normalizedFrame);
  }

  const result: QRPacketResult = {
    batchId,
    frames: normalizedFrames,
  };
  const frameCount = asWireFiniteNumber(payload.frameCount);
  if (frameCount !== undefined) {
    result.frameCount = frameCount;
  }
  const frameWidth = asWireFiniteNumber(payload.frameWidth);
  if (frameWidth !== undefined) {
    result.frameWidth = frameWidth;
  }
  const frameHeight = asWireFiniteNumber(payload.frameHeight);
  if (frameHeight !== undefined) {
    result.frameHeight = frameHeight;
  }
  return {
    type,
    payload: result,
  };
}
