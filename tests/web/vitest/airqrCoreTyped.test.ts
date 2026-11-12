import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rawDecodeNormalPacketMock,
  rawDecodeStreamingPacketMock,
  rawMeasureQrPacketFrameSizeMock,
  rawMeasureStreamingQrPacketFrameSizeMock,
} = vi.hoisted(() => ({
  rawDecodeNormalPacketMock: vi.fn(),
  rawDecodeStreamingPacketMock: vi.fn(),
  rawMeasureQrPacketFrameSizeMock: vi.fn(),
  rawMeasureStreamingQrPacketFrameSizeMock: vi.fn(),
}));

vi.mock("@web/pkg/airqr_core", () => ({
  default: vi.fn(),
  decode_normal_packet: rawDecodeNormalPacketMock,
  decode_streaming_packet: rawDecodeStreamingPacketMock,
  measure_qr_packet_frame_size: rawMeasureQrPacketFrameSizeMock,
  measure_streaming_qr_packet_frame_size: rawMeasureStreamingQrPacketFrameSizeMock,
  encode_to_gif: vi.fn(),
  generate_raptorq_packets_raw: vi.fn(),
  generate_raptorq_packets_raw_packed: vi.fn(),
  init_normal_decoder: vi.fn(),
  init_streaming_decoder: vi.fn(),
  reset_normal_decoder: vi.fn(),
  reset_streaming_decoder: vi.fn(),
}));

import {
  decodeNormalPacketUnchecked,
  decodeStreamingPacketUnchecked,
  measureQrPacketFrameSize,
  measureStreamingQrPacketFrameSize,
  normalizeGeneratedPacketSet,
  normalizeGeneratedPacketSetPacked,
} from "@web/wasm/airqrCoreTyped";

describe("airqrCoreTyped", () => {
  beforeEach(() => {
    rawDecodeNormalPacketMock.mockReset();
    rawDecodeStreamingPacketMock.mockReset();
    rawMeasureQrPacketFrameSizeMock.mockReset();
    rawMeasureStreamingQrPacketFrameSizeMock.mockReset();
  });

  it("normalizes generated RaptorQ metadata and packet arrays from the wasm module", () => {
    const packets = [
      {
        data: new Uint8Array([1, 2, 3]),
        packetId: new Uint8Array([4, 5]),
      },
    ];
    const normalized = normalizeGeneratedPacketSet([
      {
        totalSize: 512,
        totalPackets: 8,
      },
      packets,
    ]);

    expect(normalized).toEqual({
      metadata: {
        totalSize: 512,
        totalPackets: 8,
      },
      packets,
    });
    expect(normalized.packets[0]?.data).toBe(packets[0]?.data);
    expect(normalized.packets[0]?.packetId).toBe(packets[0]?.packetId);
  });

  it("rejects malformed generated packet payloads", () => {
    expect(() =>
      normalizeGeneratedPacketSet([
        { totalSize: "bad", totalPackets: 2 },
        [],
      ])
    ).toThrow("Invalid RaptorQ metadata");

    expect(() =>
      normalizeGeneratedPacketSet([
        { totalSize: 4, totalPackets: 1 },
        [{ data: new Uint8Array([1]) }],
      ])
    ).toThrow("Invalid RaptorQ packet");
  });

  it("normalizes packed generated RaptorQ buffers from the wasm module", () => {
    const packetData = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const packetOffsets = new Uint32Array([0, 3, 6]);
    const packetIds = new Uint8Array([7, 8, 9, 10, 11, 12, 13, 14]);
    const packetIdOffsets = new Uint32Array([0, 4, 8]);

    const normalized = normalizeGeneratedPacketSetPacked([
      {
        totalSize: 2048,
        totalPackets: 2,
      },
      {
        packetData,
        packetOffsets,
        packetIds,
        packetIdOffsets,
      },
    ]);

    expect(normalized).toEqual({
      metadata: {
        totalSize: 2048,
        totalPackets: 2,
      },
      packed: {
        packetData,
        packetOffsets,
        packetIds,
        packetIdOffsets,
      },
    });
    expect(normalized.packed.packetData).toBe(packetData);
    expect(normalized.packed.packetOffsets).toBe(packetOffsets);
    expect(normalized.packed.packetIds).toBe(packetIds);
    expect(normalized.packed.packetIdOffsets).toBe(packetIdOffsets);
  });

  it("keeps decode results as unknown instead of leaking wasm any", () => {
    rawDecodeNormalPacketMock.mockReturnValue(undefined);
    rawDecodeStreamingPacketMock.mockReturnValue(undefined);

    const normalResult = decodeNormalPacketUnchecked(new Uint8Array([1]));
    const streamingResult = decodeStreamingPacketUnchecked(new Uint8Array([2]));

    expect(normalResult).toBeUndefined();
    expect(streamingResult).toBeUndefined();
  });

  it("exposes typed frame-size measurements for normal and streaming QR packets", () => {
    rawMeasureQrPacketFrameSizeMock.mockReturnValue(31329);
    rawMeasureStreamingQrPacketFrameSizeMock.mockReturnValue(40000);

    expect(
      measureQrPacketFrameSize(
        new Uint8Array([1, 2, 3]),
        42,
        12,
        new Uint8Array([4, 5, 6, 7]),
        "MEDIUM",
        177,
        1,
      ),
    ).toBe(31329);

    expect(
      measureStreamingQrPacketFrameSize(
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6, 7]),
        123,
        1,
        4,
        1024,
        42,
        12,
        17,
        "LOW",
        177,
        1,
      ),
    ).toBe(40000);
  });
});
