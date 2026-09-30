import { describe, expect, it } from "vitest";

import {
  buildPackedQrWorkerRange,
  createOwnedRaptorQPacketSource,
  createSharedRaptorQPacketSource,
  getPackedPacketByteLength,
  getPackedQrWorkerTransferables,
  toTransferableQrWorkerPacket,
} from "@web/workers/raptorqPacketTransfer";

describe("raptorq packet transfer", () => {
  it("reuses generated packet buffers instead of cloning them before worker transfer", () => {
    const data = new Uint8Array([1, 2, 3]);
    const packetId = new Uint8Array([4, 5, 6, 7]);

    const packet = toTransferableQrWorkerPacket(9, {
      data,
      packetId,
    });

    expect(packet).toEqual({
      id: 9,
      data,
      packetId,
    });
    expect(packet.data).toBe(data);
    expect(packet.packetId).toBe(packetId);
  });

  it("copies packed packet buffers into shared memory once for worker reuse", () => {
    const packetData = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const packetOffsets = new Uint32Array([0, 3, 6]);
    const packetIds = new Uint8Array([7, 8, 9, 10, 11, 12, 13, 14]);
    const packetIdOffsets = new Uint32Array([0, 4, 8]);

    const sharedSource = createSharedRaptorQPacketSource({
      packetData,
      packetOffsets,
      packetIds,
      packetIdOffsets,
    });

    expect(sharedSource.totalPackets).toBe(2);
    expect(sharedSource.kind).toBe("shared");
    expect(sharedSource.packetData.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(sharedSource.packetOffsets.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(sharedSource.packetIds.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(sharedSource.packetIdOffsets.buffer).toBeInstanceOf(SharedArrayBuffer);

    expect(Array.from(sharedSource.packetData)).toEqual(Array.from(packetData));
    expect(Array.from(sharedSource.packetOffsets)).toEqual(Array.from(packetOffsets));
    expect(Array.from(sharedSource.packetIds)).toEqual(Array.from(packetIds));
    expect(Array.from(sharedSource.packetIdOffsets)).toEqual(Array.from(packetIdOffsets));
    expect(getPackedPacketByteLength(packetOffsets, 0)).toBe(3);
    expect(getPackedPacketByteLength(packetOffsets, 1)).toBe(3);
  });

  it("builds shared ranges without copying and owned ranges with rebased offsets", () => {
    const packetData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const packetOffsets = new Uint32Array([0, 3, 5, 8]);
    const packetIds = new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const packetIdOffsets = new Uint32Array([0, 4, 8, 12]);

    const sharedSource = createSharedRaptorQPacketSource({
      packetData,
      packetOffsets,
      packetIds,
      packetIdOffsets,
    });
    const sharedRange = buildPackedQrWorkerRange(sharedSource, 1, 3);

    expect(sharedRange.packetData).toBe(sharedSource.packetData);
    expect(sharedRange.packetOffsets).toBe(sharedSource.packetOffsets);
    expect(sharedRange.startIndex).toBe(1);
    expect(sharedRange.endIndex).toBe(3);
    expect(getPackedQrWorkerTransferables(sharedRange)).toEqual([]);

    const ownedSource = createOwnedRaptorQPacketSource({
      packetData,
      packetOffsets,
      packetIds,
      packetIdOffsets,
    });
    const ownedRange = buildPackedQrWorkerRange(ownedSource, 1, 3);

    expect(ownedRange.startIndex).toBe(0);
    expect(ownedRange.endIndex).toBe(2);
    expect(Array.from(ownedRange.packetData)).toEqual([4, 5, 6, 7, 8]);
    expect(Array.from(ownedRange.packetOffsets)).toEqual([0, 2, 5]);
    expect(Array.from(ownedRange.packetIds)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(Array.from(ownedRange.packetIdOffsets)).toEqual([0, 4, 8]);
    expect(getPackedQrWorkerTransferables(ownedRange)).toHaveLength(4);
  });
});
