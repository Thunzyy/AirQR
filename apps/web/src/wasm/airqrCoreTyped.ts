import init, {
  decode_normal_packet as rawDecodeNormalPacket,
  decode_streaming_packet as rawDecodeStreamingPacket,
  encode_to_gif as rawEncodeToGif,
  generate_raptorq_packets_raw as rawGenerateRaptorQPacketsRaw,
  generate_raptorq_packets_raw_packed as rawGenerateRaptorQPacketsRawPacked,
  measure_qr_packet_frame_size as rawMeasureQrPacketFrameSize,
  measure_streaming_qr_packet_frame_size as rawMeasureStreamingQrPacketFrameSize,
  init_normal_decoder,
  init_streaming_decoder,
  reset_normal_decoder,
  reset_streaming_decoder,
} from "@web/pkg/airqr_core";
import {
  asUint8Array,
  asUint32Array,
  asWireFiniteNumber,
  asWireObject,
  isWireArray,
  isWireObject,
  type WireValue,
} from "../parse/wire";

export interface GeneratedRaptorQMetadata {
  totalSize: number;
  totalPackets: number;
}

export interface GeneratedRaptorQPacket {
  data: Uint8Array;
  packetId: Uint8Array;
}

export interface GeneratedPacketSet {
  metadata: GeneratedRaptorQMetadata;
  packets: GeneratedRaptorQPacket[];
}

export interface PackedGeneratedRaptorQPackets {
  packetData: Uint8Array;
  packetOffsets: Uint32Array;
  packetIds: Uint8Array;
  packetIdOffsets: Uint32Array;
}

export interface GeneratedPacketSetPacked {
  metadata: GeneratedRaptorQMetadata;
  packed: PackedGeneratedRaptorQPackets;
}

export type WasmProgressCallback = (
  phase: string,
  current: number,
  total: number
) => void;

function readGeneratedRaptorQPacket(value: WireValue): GeneratedRaptorQPacket | null {
  if (!isWireObject(value)) {
    return null;
  }
  const data = asUint8Array(value.data);
  const packetId = asUint8Array(value.packetId);
  if (!data || !packetId) {
    return null;
  }
  return { data, packetId };
}

export function normalizeGeneratedPacketSet(raw: WireValue): GeneratedPacketSet {
  if (!isWireArray(raw) || raw.length < 2) {
    throw new Error("Invalid generated packet set");
  }

  const metadataRecord = asWireObject(raw[0]);
  const totalSize = asWireFiniteNumber(metadataRecord.totalSize);
  const totalPackets = asWireFiniteNumber(metadataRecord.totalPackets);
  if (totalSize === undefined || totalPackets === undefined) {
    throw new Error("Invalid RaptorQ metadata");
  }

  const packetList = raw[1];
  if (!isWireArray(packetList)) {
    throw new Error("Invalid RaptorQ packet list");
  }

  const packets: GeneratedRaptorQPacket[] = [];
  for (const packet of packetList) {
    const parsed = readGeneratedRaptorQPacket(packet);
    if (!parsed) {
      throw new Error("Invalid RaptorQ packet");
    }
    packets.push(parsed);
  }

  return {
    metadata: {
      totalSize,
      totalPackets,
    },
    packets,
  };
}

export function normalizeGeneratedPacketSetPacked(
  raw: WireValue,
): GeneratedPacketSetPacked {
  if (!isWireArray(raw) || raw.length < 2) {
    throw new Error("Invalid generated packet set");
  }

  const metadataRecord = asWireObject(raw[0]);
  const totalSize = asWireFiniteNumber(metadataRecord.totalSize);
  const totalPackets = asWireFiniteNumber(metadataRecord.totalPackets);
  if (totalSize === undefined || totalPackets === undefined) {
    throw new Error("Invalid RaptorQ metadata");
  }

  const packedRecord = asWireObject(raw[1]);
  const packetData = asUint8Array(packedRecord.packetData);
  const packetOffsets = asUint32Array(packedRecord.packetOffsets);
  const packetIds = asUint8Array(packedRecord.packetIds);
  const packetIdOffsets = asUint32Array(packedRecord.packetIdOffsets);
  if (!packetData || !packetOffsets || !packetIds || !packetIdOffsets) {
    throw new Error("Invalid packed RaptorQ packet buffers");
  }

  return {
    metadata: {
      totalSize,
      totalPackets,
    },
    packed: {
      packetData,
      packetOffsets,
      packetIds,
      packetIdOffsets,
    },
  };
}

export function generate_raptorq_packets_raw(
  rawData: Uint8Array,
  packetSize: number,
  raptorqOverhead: number
): GeneratedPacketSet {
  return normalizeGeneratedPacketSet(
    rawGenerateRaptorQPacketsRaw(rawData, packetSize, raptorqOverhead)
  );
}

export function generate_raptorq_packets_raw_packed(
  rawData: Uint8Array,
  packetSize: number,
  raptorqOverhead: number,
): GeneratedPacketSetPacked {
  return normalizeGeneratedPacketSetPacked(
    rawGenerateRaptorQPacketsRawPacked(rawData, packetSize, raptorqOverhead),
  );
}

export function decode_normal_packet(data: Uint8Array): WireValue {
  return rawDecodeNormalPacket(data);
}

export function decode_streaming_packet(data: Uint8Array): WireValue {
  return rawDecodeStreamingPacket(data);
}

export function decodeNormalPacketUnchecked(data: Uint8Array): WireValue {
  return decode_normal_packet(data);
}

export function decodeStreamingPacketUnchecked(data: Uint8Array): WireValue {
  return decode_streaming_packet(data);
}

export function measureQrPacketFrameSize(
  packetData: Uint8Array,
  totalSize: number,
  packetSize: number,
  packetId: Uint8Array,
  eccLevel: string,
  targetSize: number,
  scale: number,
): number {
  return rawMeasureQrPacketFrameSize(
    packetData,
    totalSize,
    packetSize,
    packetId,
    eccLevel,
    targetSize,
    scale,
  );
}

export function measureStreamingQrPacketFrameSize(
  packetData: Uint8Array,
  packetId: Uint8Array,
  sessionId: number,
  chunkId: number,
  totalChunks: number,
  chunkOffset: number,
  totalSize: number,
  packetSize: number,
  exactChunkPackets: number,
  eccLevel: string,
  targetSize: number,
  scale: number,
): number {
  return rawMeasureStreamingQrPacketFrameSize(
    packetData,
    packetId,
    sessionId,
    chunkId,
    totalChunks,
    chunkOffset,
    totalSize,
    packetSize,
    exactChunkPackets,
    eccLevel,
    targetSize,
    scale,
  );
}

export function encode_to_gif(
  filename: string,
  data: Uint8Array,
  compressionEnabled: boolean,
  frameDelayMs: number,
  eccLevel: string,
  packetSize: number,
  targetSize: number,
  scale: number,
  raptorqOverhead: number,
  callback: WasmProgressCallback
): Uint8Array {
  return rawEncodeToGif(
    filename,
    data,
    compressionEnabled,
    frameDelayMs,
    eccLevel,
    packetSize,
    targetSize,
    scale,
    raptorqOverhead,
    callback
  );
}

export {
  init_normal_decoder,
  init_streaming_decoder,
  reset_normal_decoder,
  reset_streaming_decoder,
};

export default init;
