import { globalHas } from "../parse/wire";
import type {
  GeneratedRaptorQPacket,
  PackedGeneratedRaptorQPackets,
} from "../wasm/airqrCoreTyped";

export interface TransferableQrWorkerPacket {
  id: number;
  data: Uint8Array;
  packetId: Uint8Array;
}

export interface PackedQrWorkerPacketRange {
  packetData: Uint8Array;
  packetOffsets: Uint32Array;
  packetIds: Uint8Array;
  packetIdOffsets: Uint32Array;
  startIndex: number;
  endIndex: number;
}

interface BaseRaptorQPacketSource {
  packetData: Uint8Array;
  packetOffsets: Uint32Array;
  packetIds: Uint8Array;
  packetIdOffsets: Uint32Array;
  totalPackets: number;
}

export interface SharedRaptorQPacketSource extends BaseRaptorQPacketSource {
  kind: "shared";
}

export interface OwnedRaptorQPacketSource extends BaseRaptorQPacketSource {
  kind: "owned";
}

export type RaptorQPacketSource =
  | SharedRaptorQPacketSource
  | OwnedRaptorQPacketSource;

function copyUint8ArrayToSharedBuffer(source: Uint8Array): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  return buffer;
}

function copyUint32ArrayToSharedBuffer(source: Uint32Array): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(source.byteLength);
  new Uint32Array(buffer).set(source);
  return buffer;
}

export function getPackedPacketByteLength(
  packetOffsets: Uint32Array,
  index: number,
): number {
  if (index < 0 || index + 1 >= packetOffsets.length) {
    throw new Error(`Packed packet index ${index} out of range`);
  }
  return packetOffsets[index + 1] - packetOffsets[index];
}

export function createSharedRaptorQPacketSource(
  packed: PackedGeneratedRaptorQPackets,
): SharedRaptorQPacketSource {
  return {
    kind: "shared",
    packetData: new Uint8Array(copyUint8ArrayToSharedBuffer(packed.packetData)),
    packetOffsets: new Uint32Array(copyUint32ArrayToSharedBuffer(packed.packetOffsets)),
    packetIds: new Uint8Array(copyUint8ArrayToSharedBuffer(packed.packetIds)),
    packetIdOffsets: new Uint32Array(copyUint32ArrayToSharedBuffer(packed.packetIdOffsets)),
    totalPackets: Math.max(0, packed.packetOffsets.length - 1),
  };
}

export function createOwnedRaptorQPacketSource(
  packed: PackedGeneratedRaptorQPackets,
): OwnedRaptorQPacketSource {
  return {
    kind: "owned",
    packetData: packed.packetData,
    packetOffsets: packed.packetOffsets,
    packetIds: packed.packetIds,
    packetIdOffsets: packed.packetIdOffsets,
    totalPackets: Math.max(0, packed.packetOffsets.length - 1),
  };
}

function rebaseOffsets(offsets: Uint32Array): Uint32Array {
  const base = offsets[0] ?? 0;
  const rebased = new Uint32Array(offsets.length);
  for (let index = 0; index < offsets.length; index += 1) {
    rebased[index] = offsets[index] - base;
  }
  return rebased;
}

export function buildPackedQrWorkerRange(
  source: RaptorQPacketSource,
  startIndex: number,
  endIndex: number,
): PackedQrWorkerPacketRange {
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex > source.totalPackets
  ) {
    throw new Error(
      `Packed packet range ${startIndex}-${endIndex} out of bounds for ${source.totalPackets} packets`,
    );
  }

  if (source.kind === "shared") {
    return {
      packetData: source.packetData,
      packetOffsets: source.packetOffsets,
      packetIds: source.packetIds,
      packetIdOffsets: source.packetIdOffsets,
      startIndex,
      endIndex,
    };
  }

  const packetDataStart = source.packetOffsets[startIndex];
  const packetDataEnd = source.packetOffsets[endIndex];
  const packetIdStart = source.packetIdOffsets[startIndex];
  const packetIdEnd = source.packetIdOffsets[endIndex];

  return {
    packetData: source.packetData.slice(packetDataStart, packetDataEnd),
    packetOffsets: rebaseOffsets(source.packetOffsets.slice(startIndex, endIndex + 1)),
    packetIds: source.packetIds.slice(packetIdStart, packetIdEnd),
    packetIdOffsets: rebaseOffsets(
      source.packetIdOffsets.slice(startIndex, endIndex + 1),
    ),
    startIndex: 0,
    endIndex: endIndex - startIndex,
  };
}

function isTransferableArrayBuffer(
  buffer: ArrayBufferLike,
): buffer is ArrayBuffer {
  return (
    buffer instanceof ArrayBuffer &&
    (!globalHas("SharedArrayBuffer") ||
      !(buffer instanceof SharedArrayBuffer))
  );
}

export function getPackedQrWorkerTransferables(
  range: PackedQrWorkerPacketRange,
): ArrayBuffer[] {
  return [
    range.packetData.buffer,
    range.packetOffsets.buffer,
    range.packetIds.buffer,
    range.packetIdOffsets.buffer,
  ].filter(isTransferableArrayBuffer);
}

export function toTransferableQrWorkerPacket(
  id: number,
  packet: GeneratedRaptorQPacket,
): TransferableQrWorkerPacket {
  return {
    id,
    data: packet.data,
    packetId: packet.packetId,
  };
}
