import {
  asUint8Array,
  asWireString,
  firstWireFiniteNumber,
  isWireObject,
  type WireValue,
} from "../../parse/wire";

interface NormalizedDecodeResultBase {
  chunkId?: number;
  chunksCompleted?: number;
  expectedPackets?: number;
  filename?: string;
  overallPercent?: number;
  packetsExpectedChunk?: number;
  packetsReceivedChunk?: number;
  percent?: number;
  receivedPackets?: number;
  sessionId?: string;
  totalChunks?: number;
  totalPackets?: number;
  totalPacketsExact: boolean;
  type: string;
}

export type NormalizedProgressDecodeResult = NormalizedDecodeResultBase & {
  type: "progress";
};

export type NormalizedChunkCompletedDecodeResult = NormalizedDecodeResultBase & {
  chunkData?: Uint8Array;
  chunkId: number;
  packetsExpectedChunk?: number;
  packetsReceivedTotal?: number;
  totalChunks: number;
  type: "chunk_completed";
};

export type NormalizedCompletedDecodeResult = NormalizedDecodeResultBase & {
  data: Uint8Array;
  filename: string;
  type: "completed";
};

export type NormalizedErrorDecodeResult = NormalizedDecodeResultBase & {
  type: "error";
};

export type NormalizedUnknownDecodeResult = NormalizedDecodeResultBase;

export type NormalizedDecodeResult =
  | NormalizedChunkCompletedDecodeResult
  | NormalizedCompletedDecodeResult
  | NormalizedErrorDecodeResult
  | NormalizedProgressDecodeResult
  | NormalizedUnknownDecodeResult;

export function isChunkCompletedDecodeResult(
  result: NormalizedDecodeResult,
): result is NormalizedChunkCompletedDecodeResult {
  return result.type === "chunk_completed";
}

export function isCompletedDecodeResult(
  result: NormalizedDecodeResult,
): result is NormalizedCompletedDecodeResult {
  return result.type === "completed";
}

export function normalizeDecodeResult(rawResult: WireValue): NormalizedDecodeResult {
  const result = isWireObject(rawResult) ? rawResult : {};
  const type = asWireString(result.type) ?? "error";
  const totalChunks = firstWireFiniteNumber(result.totalChunks);
  const packetsExpectedChunk = firstWireFiniteNumber(result.packetsExpectedChunk);
  const packetsReceivedTotal = firstWireFiniteNumber(result.packetsReceivedTotal);
  const expectedPackets =
    firstWireFiniteNumber(result.expectedPackets, result.expected_packets) ??
    (packetsExpectedChunk !== undefined && totalChunks !== undefined
      ? packetsExpectedChunk * totalChunks
      : undefined);
  const totalPackets = firstWireFiniteNumber(
    result.packetsTotalChunk,
    result.totalPackets,
    result.total_packets,
  );
  const totalPacketsExact =
    result.packetsTotalChunk !== undefined ||
    result.totalPackets !== undefined ||
    result.total_packets !== undefined;
  const normalizedResult: NormalizedDecodeResultBase = {
    chunkId: firstWireFiniteNumber(result.chunkId),
    chunksCompleted: firstWireFiniteNumber(result.chunksCompleted),
    expectedPackets,
    filename: asWireString(result.filename),
    overallPercent: firstWireFiniteNumber(result.overallPercent),
    packetsExpectedChunk,
    packetsReceivedChunk: firstWireFiniteNumber(
      result.packetsReceivedChunk,
      result.packets_received_chunk,
    ),
    percent: firstWireFiniteNumber(result.percent),
    receivedPackets:
      firstWireFiniteNumber(result.receivedPackets, result.received_packets) ??
      packetsReceivedTotal,
    sessionId: asWireString(result.sessionId),
    totalChunks,
    totalPackets,
    totalPacketsExact,
    type,
  };

  if (type === "chunk_completed") {
    return {
      ...normalizedResult,
      chunkData: asUint8Array(result.chunkData),
      chunkId: normalizedResult.chunkId ?? 0,
      packetsExpectedChunk,
      packetsReceivedTotal,
      totalChunks: normalizedResult.totalChunks ?? 0,
      type,
    };
  }

  if (type === "completed") {
    return {
      ...normalizedResult,
      data: asUint8Array(result.data) ?? new Uint8Array(),
      filename: normalizedResult.filename ?? "",
      type,
    };
  }

  return normalizedResult;
}
