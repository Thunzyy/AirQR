import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanUploadConfig } from "@web/types";

const uploadConfig: ScanUploadConfig = {
  enabled: false,
  url: "",
  apiKey: "",
  username: "",
  password: "",
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: true,
};

describe("multi scan diagnostics snapshots", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("records counter transitions when session min, max, or missing increase", async () => {
    const {
      captureMultiScanDiagnosticsSnapshot,
      publishScannerLiveDiagnostics,
    } = await import("@web/services/multiScanDiagnostics");

    publishScannerLiveDiagnostics({
      activeChunk: null,
      localDeviceName: "iPhone",
      progress: 20,
      scanStats: { received: 12, min: 52, total: undefined },
      sessionId: "scan-live",
      sessionProgress: {
        received: 12,
        total: 52,
        totalLabel: "52",
        min: 52,
        minLabel: "52",
        max: null,
        maxLabel: "?",
        percent: 20,
        chunks: [
          {
            chunkId: 0,
            receivedUnique: 12,
            decodeThreshold: 52,
            totalPackets: null,
            totalPacketsExact: false,
            state: "scanning",
            missingCount: null,
            missingRanges: [],
            targetFrameCount: null,
            targetFrameRanges: [],
            unseenFrameCount: null,
            unseenFrameRanges: [],
          },
        ],
      },
      status: "Scanning",
      syncSourceName: "iPhone",
    });

    await captureMultiScanDiagnosticsSnapshot({
      config: uploadConfig,
      sessionId: "scan-live",
    });

    publishScannerLiveDiagnostics({
      activeChunk: null,
      localDeviceName: "iPhone",
      progress: 18,
      scanStats: { received: 14, min: 60, total: 72 },
      sessionId: "scan-live",
      sessionProgress: {
        received: 14,
        total: 60,
        totalLabel: "60",
        min: 60,
        minLabel: "60",
        max: 72,
        maxLabel: "72",
        percent: 18,
        chunks: [
          {
            chunkId: 0,
            receivedUnique: 14,
            decodeThreshold: 60,
            totalPackets: 72,
            totalPacketsExact: true,
            state: "scanning",
            missingCount: null,
            missingRanges: [],
            targetFrameCount: null,
            targetFrameRanges: [],
            unseenFrameCount: null,
            unseenFrameRanges: [],
          },
        ],
      },
      status: "Scanning",
      syncSourceName: "iPhone",
    });

    const snapshot = await captureMultiScanDiagnosticsSnapshot({
      config: uploadConfig,
      sessionId: "scan-live",
    });

    expect(snapshot.progressDiagnostics.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "scanner-session",
          changed: expect.arrayContaining(["min", "max", "missingToThreshold"]),
          previous: expect.objectContaining({
            received: 12,
            min: 52,
            max: null,
            missingToThreshold: 40,
          }),
          current: expect.objectContaining({
            received: 14,
            min: 60,
            max: 72,
            missingToThreshold: 46,
          }),
          note: expect.stringContaining("missing increased"),
        }),
      ])
    );
  });
});
