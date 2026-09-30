import {
  asUint8Array,
  asWireBoolean,
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  isWireBoolean,
  isWireNumber,
  isWireObject,
  isWireString,
  type WireValue,
} from "../parse/wire";

export interface GifDecoderFrameTask {
  frameId: number;
  imageData: ImageData;
}

export interface GifDecoderFrameResult {
  frameId: number;
  found: boolean;
  binaryData?: Uint8Array;
  error?: string;
  decodeTimeMs: number;
}

export type GifDecoderWorkerDecodeFrameMessage = {
  type: "DECODE_FRAME";
  payload: GifDecoderFrameTask;
};

export type GifDecoderWorkerRequestMessage = GifDecoderWorkerDecodeFrameMessage;
export type GifDecoderWorkerRequest = GifDecoderWorkerRequestMessage;

export type GifDecoderWorkerFrameResultMessage = {
  type: "DECODE_FRAME_RESULT";
  payload: GifDecoderFrameResult;
};

export type GifDecoderWorkerResponseMessage =
  GifDecoderWorkerFrameResultMessage;
export type GifDecoderWorkerResponse = GifDecoderWorkerResponseMessage;

function isGifDecoderFrameResult(value: WireValue | undefined): boolean {
  if (!isWireObject(value)) {
    return false;
  }

  if (
    !isWireNumber(value.frameId) ||
    !isWireBoolean(value.found) ||
    !isWireNumber(value.decodeTimeMs)
  ) {
    return false;
  }

  if (value.found && !(value.binaryData instanceof Uint8Array)) {
    return false;
  }

  return value.error === undefined || isWireString(value.error);
}

export function isGifDecoderWorkerResponse(value: WireValue): boolean {
  if (!isWireObject(value) || value.type !== "DECODE_FRAME_RESULT") {
    return false;
  }

  return isGifDecoderFrameResult(value.payload);
}

export function hasGifDecoderWorkerResponseType(
  value: WireValue,
  type: GifDecoderWorkerResponseMessage["type"],
): boolean {
  return isGifDecoderWorkerResponse(value) && asWireString(asWireObject(value).type) === type;
}

export function normalizeGifDecoderWorkerMessage(
  rawMessage: WireValue,
): GifDecoderWorkerResponse | null {
  const message = asWireObject(rawMessage);
  if (message.type !== "DECODE_FRAME_RESULT") {
    return null;
  }

  const payload = asWireObject(message.payload);
  const frameId = asWireFiniteNumber(payload.frameId);
  const decodeTimeMs = asWireFiniteNumber(payload.decodeTimeMs);
  const found = asWireBoolean(payload.found);

  if (frameId === undefined || decodeTimeMs === undefined || found === undefined) {
    return null;
  }

  const binaryData = asUint8Array(payload.binaryData);
  if (found && !binaryData) {
    return null;
  }

  if (payload.error !== undefined && !isWireString(payload.error)) {
    return null;
  }

  const result: GifDecoderFrameResult = {
    frameId,
    found,
    decodeTimeMs,
  };
  if (binaryData) {
    result.binaryData = binaryData;
  }
  const error = asWireString(payload.error);
  if (error !== undefined) {
    result.error = error;
  }
  return {
    type: "DECODE_FRAME_RESULT",
    payload: result,
  };
}
