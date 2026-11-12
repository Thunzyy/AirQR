import { describe, expect, it } from "vitest";

import {
  extractScanPacketTransportIdentity,
  normalizeIncompleteProgress,
  resolveScanProgressTotals,
} from "@web/utils/scanProgress";

describe("normalizeIncompleteProgress", () => {
  it("normalizes estimated totals so received never renders above total", () => {
    const normalized = normalizeIncompleteProgress(9, 6, {
      totalIsEstimate: true,
      progressPercent: 150,
    });

    expect(normalized.received).toBe(9);
    expect(normalized.total).toBe(9);
    expect(normalized.totalIsEstimate).toBe(true);
    expect(normalized.totalLabel).toBe("9");
    expect(normalized.progressPercent).toBe(99);
  });

  it("preserves exact totals when counts are coherent", () => {
    const normalized = normalizeIncompleteProgress(3, 6, {
      totalIsEstimate: false,
      progressPercent: 50,
    });

    expect(normalized.total).toBe(6);
    expect(normalized.totalIsEstimate).toBe(false);
    expect(normalized.totalLabel).toBe("6");
    expect(normalized.progressPercent).toBe(50);
  });
});

describe("resolveScanProgressTotals", () => {
  it("prefers the decode threshold over the exact transmitted total for UI progress", () => {
    expect(resolveScanProgressTotals(6, 9)).toEqual({
      uiTotal: 6,
      totalIsEstimate: false,
      exactTransmittedTotal: 9,
      hasDecodeThreshold: true,
    });
  });

  it("falls back to the transmitted total only when the decode threshold is absent", () => {
    expect(resolveScanProgressTotals(undefined, 9)).toEqual({
      uiTotal: 9,
      totalIsEstimate: true,
      exactTransmittedTotal: 9,
      hasDecodeThreshold: false,
    });
  });
});

describe("extractScanPacketTransportIdentity", () => {
  it("extracts streaming packet identity from the raw QR payload", () => {
    const packet = new Uint8Array(31);
    const view = new DataView(packet.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, 12345, false);
    view.setUint32(5, 7, false);
    view.setUint32(27, 42, false);

    expect(extractScanPacketTransportIdentity(packet)).toEqual({
      isStreaming: true,
      sessionId: "12345",
      chunkId: 7,
      packetIndex: 42,
    });
  });

  it("extracts exact-count streaming packet identity from the raw QR payload", () => {
    const packet = new Uint8Array(35);
    const view = new DataView(packet.buffer);
    view.setUint8(0, 2);
    view.setUint32(1, 54321, false);
    view.setUint32(5, 3, false);
    view.setUint32(27, 12, false);
    view.setUint32(31, 77, false);

    expect(extractScanPacketTransportIdentity(packet)).toEqual({
      isStreaming: true,
      sessionId: "54321",
      chunkId: 3,
      packetIndex: 77,
    });
  });

  it("extracts normal-mode packet identity from the raw QR payload", () => {
    const packet = new Uint8Array(10);
    const view = new DataView(packet.buffer);
    view.setUint32(6, 99, false);

    expect(extractScanPacketTransportIdentity(packet)).toEqual({
      isStreaming: false,
      chunkId: 0,
      packetIndex: 99,
    });
  });
});
