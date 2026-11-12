import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMultiScanDiagnostics } from "@web/hooks/useMultiScanDiagnostics";
import type { ScanStats, ScanUploadConfig } from "@web/types";

const {
  captureSnapshotMock,
  publishScannerLiveDiagnosticsMock,
  uploadScanDebugSnapshotMock,
} = vi.hoisted(() => ({
  captureSnapshotMock: vi.fn(),
  publishScannerLiveDiagnosticsMock: vi.fn(),
  uploadScanDebugSnapshotMock: vi.fn(),
}));

vi.mock("@web/services/multiScanDiagnostics", () => ({
  captureMultiScanDiagnosticsSnapshot: captureSnapshotMock,
  publishScannerLiveDiagnostics: publishScannerLiveDiagnosticsMock,
}));

vi.mock("@web/services/scanDebugTelemetry", () => ({
  hasScanDebugShortcut: (params: URLSearchParams) => params.has("Debug"),
  isScanDebugUploadEnabled: () => {
    const params = new URLSearchParams(window.location.search);
    return (
      params.has("Debug") ||
      (params.get("scanDebug") === "1" && params.get("debugUpload") === "1")
    );
  },
  uploadScanDebugSnapshot: uploadScanDebugSnapshotMock,
}));

const scanStats: ScanStats = {
  received: 0,
  total: 0,
  minRequired: 0,
  percentage: 0,
};

const uploadConfig: ScanUploadConfig = {
  enabled: true,
  url: "https://sync.example.com",
  apiKey: "",
  username: "admin",
  password: "secret",
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: true,
};

function renderDiagnostics() {
  return renderHook(() =>
    useMultiScanDiagnostics({
      activeChunk: null,
      activeSessionId: "scan-live",
      localDeviceName: "iPhone",
      progress: 0,
      scanStats,
      scannerDebugEnabled: false,
      sessionProgress: null,
      status: "Scanning",
      syncSourceName: "iPhone",
      uploadConfig,
    })
  );
}

describe("useMultiScanDiagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    captureSnapshotMock.mockReset();
    captureSnapshotMock.mockResolvedValue({
      at: "2026-06-24T12:00:00Z",
      sessionId: "scan-live",
      online: true,
      visibilityState: "visible",
      authSnapshot: {
        enabled: true,
        authorizedSnapshot: true,
        cachedAuthorized: true,
      },
      scanner: null,
      history: null,
      transport: null,
      server: null,
    });
    publishScannerLiveDiagnosticsMock.mockReset();
    uploadScanDebugSnapshotMock.mockReset();
    uploadScanDebugSnapshotMock.mockResolvedValue(true);
    window.history.replaceState(null, "", "/scanner");
  });

  it("uploads diagnostics when scanDebug and debugUpload are enabled", async () => {
    window.history.replaceState(null, "", "/scanner?scanDebug=1&debugUpload=1");

    renderDiagnostics();

    await waitFor(() => {
      expect(uploadScanDebugSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "scan-live" }),
        uploadConfig
      );
    });
  });

  it("uploads diagnostics when the Debug shortcut is enabled", async () => {
    window.history.replaceState(null, "", "/scanner?Debug");

    renderDiagnostics();

    await waitFor(() => {
      expect(uploadScanDebugSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "scan-live" }),
        uploadConfig
      );
    });
  });

  it("does not upload diagnostics for the local debug overlay alone", async () => {
    window.history.replaceState(null, "", "/scanner?scanDebug=1");

    renderDiagnostics();

    await waitFor(() => {
      expect(captureSnapshotMock).toHaveBeenCalled();
    });
    expect(uploadScanDebugSnapshotMock).not.toHaveBeenCalled();
  });
});
