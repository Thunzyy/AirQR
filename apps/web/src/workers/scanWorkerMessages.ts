import {
  asUint8Array,
  asWireBoolean,
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  isWireObject,
  type WireValue,
} from "../parse/wire";

export type ScanWorkerCornerPoint = { x: number; y: number };

export type ScanWorkerLocation = {
  topLeftCorner: ScanWorkerCornerPoint;
  topRightCorner: ScanWorkerCornerPoint;
  bottomRightCorner: ScanWorkerCornerPoint;
  bottomLeftCorner: ScanWorkerCornerPoint;
};

export type ScanWorkerWarmupMessage = { type: "WARMUP" };
export type ScanWorkerTerminateMessage = { type: "TERMINATE" };
export type ScanWorkerScanMessage = {
  type: "SCAN";
  requestId?: number;
  grayscale?: Uint8Array;
  data?: Uint8ClampedArray | ArrayBuffer;
  width: number;
  height: number;
  tryHarder?: boolean;
};

export type ScanWorkerRequestMessage =
  | ScanWorkerWarmupMessage
  | ScanWorkerTerminateMessage
  | ScanWorkerScanMessage;

export type ScanWorkerRequest = ScanWorkerRequestMessage;

export type ScanWorkerReadyMessage = { type: "WORKER_READY" };
export type ScanWorkerWarmupCompleteResponse = { type: "WARMUP_COMPLETE" };
export type ScanWorkerWarmupErrorResponse = {
  type: "WARMUP_ERROR";
  error: string;
};
export type ScanWorkerScanResultMessage = {
  type: "SCAN_RESULT";
  found: boolean;
  requestId?: number;
  binaryData?: Uint8Array;
  location?: ScanWorkerLocation | null;
  data?: string;
  format?: string;
  error?: string;
};

export type ScanWorkerResponseMessage =
  | ScanWorkerReadyMessage
  | ScanWorkerWarmupCompleteResponse
  | ScanWorkerWarmupErrorResponse
  | ScanWorkerScanResultMessage;

export type ScanWorkerResponse = ScanWorkerResponseMessage;

function parseCornerPoint(value: WireValue | undefined): ScanWorkerCornerPoint | null {
  if (!isWireObject(value)) {
    return null;
  }
  const x = asWireFiniteNumber(value.x);
  const y = asWireFiniteNumber(value.y);
  if (x === undefined || y === undefined) {
    return null;
  }
  return { x, y };
}

function parseLocation(value: WireValue | undefined): ScanWorkerLocation | null {
  if (!isWireObject(value)) {
    return null;
  }
  const topLeftCorner = parseCornerPoint(value.topLeftCorner);
  const topRightCorner = parseCornerPoint(value.topRightCorner);
  const bottomRightCorner = parseCornerPoint(value.bottomRightCorner);
  const bottomLeftCorner = parseCornerPoint(value.bottomLeftCorner);
  if (!topLeftCorner || !topRightCorner || !bottomRightCorner || !bottomLeftCorner) {
    return null;
  }
  return { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner };
}

export function normalizeScanWorkerMessage(
  rawMessage: WireValue,
): ScanWorkerResponse | null {
  const message = asWireObject(rawMessage);
  const type = asWireString(message.type);

  if (type === "WORKER_READY" || type === "WARMUP_COMPLETE") {
    return { type };
  }

  if (type === "WARMUP_ERROR") {
    const error = asWireString(message.error);
    if (error === undefined) {
      return null;
    }
    return {
      type,
      error,
    };
  }

  if (type !== "SCAN_RESULT" && message.found === undefined) {
    return null;
  }

  const found = asWireBoolean(message.found);
  if (found === undefined) {
    return null;
  }

  const binaryData = asUint8Array(message.binaryData);
  if (found && !binaryData) {
    return null;
  }

  const result: ScanWorkerScanResultMessage = {
    type: "SCAN_RESULT",
    found,
    location: message.location === null ? null : parseLocation(message.location),
  };

  const requestId = asWireFiniteNumber(message.requestId);
  if (requestId !== undefined) {
    result.requestId = requestId;
  }
  if (binaryData) {
    result.binaryData = binaryData;
  }
  const data = asWireString(message.data);
  if (data !== undefined) {
    result.data = data;
  }
  const format = asWireString(message.format);
  if (format !== undefined) {
    result.format = format;
  }
  const error = asWireString(message.error);
  if (error !== undefined) {
    result.error = error;
  }
  return result;
}

export function isScanWorkerResponse(
  value: WireValue,
): value is ScanWorkerResponseMessage {
  return normalizeScanWorkerMessage(value) !== null;
}

export function hasScanWorkerResponseType<TType extends ScanWorkerResponseMessage["type"]>(
  value: WireValue,
  type: TType,
): value is Extract<ScanWorkerResponseMessage, { type: TType }> {
  const normalized = normalizeScanWorkerMessage(value);
  return normalized !== null && normalized.type === type;
}
