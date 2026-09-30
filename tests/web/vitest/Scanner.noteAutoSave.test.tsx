import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Scanner from "@web/features/scanner/Scanner";

const {
  cleanupCompletedSessionMock,
  clearResumeScanMock,
  decoderBootstrapRef,
  frameLoopHandlesRef,
  finalizeCompletedScanMock,
  historyItems,
  applyChunkCompletedProgressMock,
  applyProgressResultMock,
  emitPersistedChunkProgressMock,
  persistChunkAndMaybeAssembleMock,
  queuePacketForSyncMock,
  removeIncompleteScanMock,
  showToastMock,
  toggleTorchMock,
} = vi.hoisted(() => ({
  cleanupCompletedSessionMock: vi.fn(),
  clearResumeScanMock: vi.fn(),
  decoderBootstrapRef: {
    current: null as ((data: Uint8Array) => void) | null,
  },
  frameLoopHandlesRef: {
    current: [] as Array<(data: Uint8Array) => void>,
  },
  finalizeCompletedScanMock: vi.fn(),
  historyItems: [{ title: "note.md" }, { title: "note (2).md" }],
  applyChunkCompletedProgressMock: vi.fn(),
  applyProgressResultMock: vi.fn(),
  emitPersistedChunkProgressMock: vi.fn(),
  persistChunkAndMaybeAssembleMock: vi.fn(async () => ({
    chunksSaved: 0,
    completed: false,
  })),
  queuePacketForSyncMock: vi.fn(),
  removeIncompleteScanMock: vi.fn(),
  showToastMock: vi.fn(),
  toggleTorchMock: vi.fn(),
}));

vi.mock("@web/wasm/airqrCoreTyped", () => ({
  decode_streaming_packet: vi.fn(),
  decode_normal_packet: vi.fn(() => ({
    type: "completed",
    filename: "__airqr_note__.md",
    data: new Uint8Array([35, 32, 104, 105]),
    sessionId: "scan-1",
  })),
}));

vi.mock("@web/features/scanner/scanDecoderResult", () => ({
  normalizeDecodeResult: (value: unknown) => value,
  isCompletedDecodeResult: (value: { type?: string }) => value?.type === "completed",
  isChunkCompletedDecodeResult: (value: { type?: string }) => value?.type === "chunk_completed",
}));

vi.mock("@web/hooks/useScannerCamera", () => ({
  useScannerCamera: () => ({
    availableCameras: [],
    getCameraDisplayName: () => "Rear camera",
    hasCamera: true,
    selectCamera: vi.fn(),
    selectedCameraId: null,
  }),
}));

vi.mock("@web/hooks/useScannerCameraMenu", () => ({
  useScannerCameraMenu: () => ({
    cameraButtonRef: { current: null },
    cameraDropdownStyle: null,
    cameraSelectorRef: { current: null },
    handleSelectCamera: vi.fn(),
    setShowCameraSelector: vi.fn(),
    showCameraSelector: false,
  }),
}));

vi.mock("@web/hooks/useServerAuthState", () => ({
  useServerAuthState: () => ({
    authReady: true,
  }),
}));

vi.mock("@web/hooks/useScannerChunkProgress", () => ({
  useScannerChunkProgress: () => ({
    applyChunkCompletedProgress: applyChunkCompletedProgressMock,
    emitPersistedChunkProgress: emitPersistedChunkProgressMock,
  }),
}));

vi.mock("@web/hooks/useScannerCompletion", () => ({
  useScannerCompletion: () => ({
    cleanupCompletedSession: cleanupCompletedSessionMock,
    finalizeCompletedScan: finalizeCompletedScanMock,
    persistChunkAndMaybeAssemble: persistChunkAndMaybeAssembleMock,
  }),
}));

vi.mock("@web/hooks/useScannerDecoderBootstrap", () => ({
  useScannerDecoderBootstrap: ({
    handleDecodedData,
  }: {
    handleDecodedData: (data: Uint8Array) => void;
  }) => {
    decoderBootstrapRef.current = handleDecodedData;
  },
}));

vi.mock("@web/hooks/useScannerFrameLoop", () => ({
  useScannerFrameLoop: ({
    handleDecodedData,
  }: {
    handleDecodedData: (data: Uint8Array) => void;
  }) => {
    frameLoopHandlesRef.current.push(handleDecodedData);
  },
}));

vi.mock("@web/hooks/useScannerLocalProgress", () => ({
  useScannerLocalProgress: () => ({
    applyProgressResult: applyProgressResultMock,
    queuePacketForSync: queuePacketForSyncMock,
  }),
}));

vi.mock("@web/hooks/useMultiScanDiagnostics", () => ({
  useMultiScanDiagnostics: () => ({
    diagnosticsEnabled: false,
    diagnosticsSnapshot: null,
  }),
}));

vi.mock("@web/hooks/useScannerSyncProgress", () => ({
  useScannerSyncProgress: vi.fn(),
}));

vi.mock("@web/features/scanner/ScannerChrome", () => ({
  default: () => <div data-testid="scanner-chrome" />,
}));

vi.mock("@web/utils/deviceId", () => ({
  getDeviceInfo: () => ({
    deviceName: "This device",
  }),
}));

vi.mock("@web/store", () => ({
  useHistoryStore: () => ({
    clearResumeScan: clearResumeScanMock,
    items: historyItems,
    removeIncompleteScan: removeIncompleteScanMock,
  }),
  useScannerStore: () => ({
    config: {
      enableTorch: false,
      showDebugInfo: false,
    },
    toggleTorch: toggleTorchMock,
  }),
  useSettingsStore: () => ({
    uploadConfig: {
      enabled: false,
      url: "",
    },
    defaultCameraId: null,
  }),
  useToastStore: (
    selector: (state: { show: typeof showToastMock }) => unknown
  ) => selector({ show: showToastMock }),
}));

describe("Scanner note auto-save", () => {
  beforeEach(() => {
    cleanupCompletedSessionMock.mockReset();
    clearResumeScanMock.mockReset();
    decoderBootstrapRef.current = null;
    frameLoopHandlesRef.current = [];
    finalizeCompletedScanMock.mockReset();
    persistChunkAndMaybeAssembleMock.mockClear();
    removeIncompleteScanMock.mockReset();
    showToastMock.mockReset();
    toggleTorchMock.mockReset();
  });

  it("keeps the decoded-data callback stable across parent rerenders", () => {
    const view = render(<Scanner />);
    const initialHandle = frameLoopHandlesRef.current.at(-1);

    expect(initialHandle).toBeTypeOf("function");

    view.rerender(<Scanner />);

    expect(frameLoopHandlesRef.current.at(-1)).toBe(initialHandle);
  });

  it("auto-saves scanned notes with a versioned history title and no save action", async () => {
    const onScanComplete = vi.fn();

    render(<Scanner onScanComplete={onScanComplete} />);

    expect(decoderBootstrapRef.current).not.toBeNull();

    act(() => {
      decoderBootstrapRef.current?.(new Uint8Array([99]));
    });

    await waitFor(() => {
      expect(onScanComplete).toHaveBeenCalledTimes(1);
    });

    expect(onScanComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "scanned",
        type: "text",
        title: "note (3).md",
        mimeType: "text/plain",
      })
    );
    expect(cleanupCompletedSessionMock).toHaveBeenCalledWith("scan-1");
    expect(removeIncompleteScanMock).toHaveBeenCalledWith("scan-1");
    expect(clearResumeScanMock).toHaveBeenCalledTimes(1);
    expect(finalizeCompletedScanMock).not.toHaveBeenCalled();

    expect(screen.getByText("note (3).md")).toBeInTheDocument();
    expect(screen.getByText("# hi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy to Clipboard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
