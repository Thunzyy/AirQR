import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import ScannerChrome from "@web/features/scanner/ScannerChrome";

type ScannerChromeProps = ComponentProps<typeof ScannerChrome>;
type ScannerChromeChunk = NonNullable<
  NonNullable<ScannerChromeProps["sessionProgress"]>["chunks"]
>[number];

function chunkStatusT(key: string, options?: Record<string, unknown>) {
  if (key === "common.fps") return "fps";
  if (key === "scanner.currentChunk")
    return `Chunk ${options?.current}/${options?.total}`;
  if (key === "scanner.sessionProgress")
    return `Session ${options?.received}/${options?.total}`;
  if (key === "scanner.scanned") return "Scanned";
  if (key === "scanner.min") return "Min";
  if (key === "scanner.max") return "Max";
  if (key === "scanner.session") return "Session";
  if (key === "scanner.local") return "Local";
  if (key === "scanner.chunk") return "Chunk";
  if (key === "scanner.chunkMissingSummary")
    return `${options?.missing} missing`;
  if (key === "scanner.chunkSelectorLabel") return "Select chunk";
  if (key === "scanner.chunkCandidates") return "Candidates";
  if (key === "scanner.chunkUnseen") return "Unseen";
  if (key === "scanner.chunkStatusComplete") return "Complete";
  if (key === "scanner.chunkStatusThreshold") return "Threshold reached";
  if (key === "scanner.chunkStatusScanning") return "Scanning";
  if (key === "scanner.chunkStatusMissing") return "Missing";
  if (key === "scanner.chunkDecodeProgress")
    return `${options?.received}/${options?.threshold} to threshold`;
  if (key === "scanner.chunkThresholdMissing")
    return `${options?.missing} more unique QR`;
  if (key === "scanner.chunkMissingPackets")
    return `${options?.count} missing`;
  if (key === "scanner.selectCamera") return "Select camera";
  if (key === "scanner.torchOn") return "Torch on";
  if (key === "scanner.torchOff") return "Torch off";
  if (key === "scanner.resetScanner") return "Reset scanner";
  if (key === "scanner.help") return "Help";
  if (key === "scanner.helpTitle") return "Help title";
  if (key === "scanner.helpTips.positioning") return "Positioning";
  if (key === "scanner.helpTips.positioningDesc") return "Positioning desc";
  if (key === "scanner.helpTips.lighting") return "Lighting";
  if (key === "scanner.helpTips.lightingDesc") return "Lighting desc";
  if (key === "scanner.helpTips.torch") return "Torch";
  if (key === "scanner.helpTips.torchDesc") return "Torch desc";
  if (key === "scanner.helpTips.speed") return "Speed";
  if (key === "scanner.helpTips.speedDesc") return "Speed desc";
  if (key === "common.close") return "Close";
  return key;
}

function makeChunk(
  chunkId: number,
  state: ScannerChromeChunk["state"]
): ScannerChromeChunk {
  return {
    chunkId,
    receivedUnique: state === "complete" ? 394 : 212,
    decodeThreshold: 394,
    totalPackets: 472,
    totalPacketsExact: true,
    state,
    missingCount: state === "complete" ? 0 : 182,
    missingRanges: state === "complete" ? [] : [[212, 393]],
    targetFrameCount: null,
    targetFrameRanges: [],
    unseenFrameCount: null,
    unseenFrameRanges: [],
  };
}

function renderChunkStatusChrome({
  activeChunk = { current: 2, total: 3 },
  chunks = [
    makeChunk(0, "complete"),
    makeChunk(1, "scanning"),
    makeChunk(2, "missing"),
  ],
}: {
  activeChunk?: ScannerChromeProps["activeChunk"];
  chunks?: ScannerChromeChunk[];
} = {}) {
  return render(
    <ScannerChrome
      activeChunk={activeChunk}
      availableCameras={[]}
      cameraButtonRef={{ current: null }}
      cameraDropdownStyle={null}
      cameraSelectorRef={{ current: null }}
      fps={18}
      getCameraDisplayName={() => ""}
      handleSelectCamera={vi.fn()}
      localDeviceName="This phone"
      progress={42}
      scanStats={{
        received: 212,
        min: 1182,
        total: 1416,
        chunkTotal: 472,
        chunkReceived: 84,
      }}
      scannerTorchEnabled={false}
      selectedCameraId={null}
      sharedSessionPending={false}
      sessionProgress={{
        received: 212,
        total: 1182,
        totalLabel: "~1182",
        totalIsEstimate: true,
        min: 1182,
        minLabel: "1182",
        max: 1416,
        maxLabel: "1416",
        percent: 42,
        decodeState: "scanning",
        fileAvailable: false,
        chunksTotal: 3,
        chunksComplete: chunks.filter((chunk) => chunk.state === "complete").length,
        chunksMissing: chunks.filter((chunk) => chunk.state !== "complete").length,
        chunks,
      }}
      diagnosticsEnabled={false}
      diagnosticsSnapshot={null}
      setShowCameraSelector={vi.fn()}
      showCameraSelector={false}
      status="Scanning"
      syncSourceName={null}
      toggleTorch={vi.fn()}
      t={chunkStatusT}
      onReset={vi.fn()}
    />
  );
}

describe("ScannerChrome", () => {
  it("does not invent a session max from local stats when server progress does not know max yet", () => {
    render(
      <ScannerChrome
        activeChunk={null}
        availableCameras={[]}
        cameraButtonRef={{ current: null }}
        cameraDropdownStyle={null}
        cameraSelectorRef={{ current: null }}
        fps={0}
        getCameraDisplayName={() => ""}
        handleSelectCamera={vi.fn()}
        localDeviceName="This phone"
        progress={23}
        scanStats={{ received: 12, min: 52, total: 64, chunkTotal: 64 }}
        scannerTorchEnabled={false}
        selectedCameraId={null}
        sharedSessionPending={false}
        sessionProgress={{
          received: 12,
          total: 52,
          totalLabel: "52",
          totalIsEstimate: true,
          min: 52,
          minLabel: "52",
          max: null,
          maxLabel: "-",
          percent: 23,
        }}
        diagnosticsEnabled={false}
        diagnosticsSnapshot={null}
        setShowCameraSelector={vi.fn()}
        showCameraSelector={false}
        status="Scanning"
        syncSourceName="This phone"
        toggleTorch={vi.fn()}
        t={(key, options) => {
          if (key === "common.fps") return "fps";
          if (key === "scanner.syncSource")
            return `Sync ${options?.device}`;
          if (key === "scanner.sessionProgress")
            return `Session ${options?.received}/${options?.total}`;
          if (key === "scanner.scanned") return "Scanned";
          if (key === "scanner.min") return "Min";
          if (key === "scanner.max") return "Max";
          if (key === "scanner.session") return "Session";
          if (key === "scanner.local") return "Local";
          if (key === "scanner.chunk") return "Chunk";
          if (key === "scanner.selectCamera") return "Select camera";
          if (key === "scanner.torchOn") return "Torch on";
          if (key === "scanner.torchOff") return "Torch off";
          if (key === "scanner.resetScanner") return "Reset scanner";
          if (key === "scanner.help") return "Help";
          if (key === "scanner.sessionThresholdMissing")
            return `${options?.missing} missing`;
          if (key === "scanner.decodeState.scanning") return "Scanning";
          return key;
        }}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByTestId("scanner-session-progress")).toHaveTextContent("Session 12/52");
    expect(screen.getByTestId("scanner-stat-min")).toHaveTextContent("52");
    expect(screen.getByTestId("scanner-stat-max")).toHaveTextContent("-");
  });

  it("renders scanner overlay stats, badges and progress", () => {
    const setShowCameraSelector = vi.fn();

    render(
      <ScannerChrome
        activeChunk={{ current: 2, total: 3 }}
        availableCameras={[
          { deviceId: "rear-camera", kind: "videoinput", label: "Back Camera" } as MediaDeviceInfo,
          { deviceId: "front-camera", kind: "videoinput", label: "Front Camera" } as MediaDeviceInfo,
        ]}
        cameraButtonRef={{ current: null }}
        cameraDropdownStyle={null}
        cameraSelectorRef={{ current: null }}
        fps={24}
        getCameraDisplayName={() => "Back Camera"}
        handleSelectCamera={vi.fn()}
        localDeviceName="This phone"
        progress={42}
        scanStats={{
          received: 12,
          min: 1182,
          total: 1393,
          chunkTotal: 472,
          chunkReceived: 84,
        }}
        scannerTorchEnabled={false}
        selectedCameraId="rear-camera"
        sharedSessionPending={false}
        sessionProgress={{
          received: 500,
          total: 1182,
          totalLabel: "~1182",
          totalIsEstimate: true,
          min: 1182,
          minLabel: "1182",
          max: 1416,
          maxLabel: "1416",
          percent: 42,
        }}
        diagnosticsEnabled={true}
        diagnosticsSnapshot={{
          at: "2026-04-04T00:00:00.000Z",
          sessionId: "1775220640",
          online: true,
          visibilityState: "visible",
          authSnapshot: {
            enabled: true,
            authorizedSnapshot: true,
            cachedAuthorized: true,
          },
          scanner: null,
          history: {
            sessionId: "1775220640",
            filename: "archive.bin",
            received: 69,
            total: 1393,
            source: "local",
            date: "00:00",
          },
          transport: {
            sessionId: "1775220640",
            state: "ready",
            currentConnectionId: "device-1-1775220640-7-connection",
            queuedPackets: 0,
            bufferedPackets: 69,
            sentPackets: 64,
            sentSinceResume: 0,
            resumeRequests: 2,
            resumeAcks: 1,
            resumeTimeouts: 1,
            checkpointRequests: 1,
            reconnectAttempts: 0,
            reconnectsScheduled: 0,
            serverReceivedCount: 69,
            socketCloses: 1,
            socketErrors: 2,
            socketOpens: 3,
            windowSize: 32,
            pendingComplete: false,
            lastCloseAt: "2026-04-04T00:00:01.000Z",
            lastCloseCode: 1011,
            lastCloseReason: "server reset",
            lastCloseWasClean: false,
            lastConnectUrl: "wss://sync.example.com/api/v1/ws/scan/1775220640?connectionId=device-1-1775220640-7-connection",
            lastErrorMessage: "ECONNRESET",
            lastMessageAt: "2026-04-04T00:00:02.000Z",
            lastMessageType: "resumeState",
            lastOpenAt: "2026-04-04T00:00:00.000Z",
            recentEvents: [],
          },
          server: {
            sessionId: "1775220640",
            receivedCount: 69,
            expectedPackets: 1162,
            status: "active",
          },
          progressDiagnostics: {
            current: [],
            transitions: [
              {
                at: "2026-04-04T00:00:03.000Z",
                sessionId: "1775220640",
                source: "scanner-session",
                changed: ["min", "max", "missingToThreshold"],
                previous: {
                  source: "scanner-session",
                  sessionId: "1775220640",
                  received: 500,
                  min: 1182,
                  max: null,
                  missingToThreshold: 682,
                },
                current: {
                  source: "scanner-session",
                  sessionId: "1775220640",
                  received: 520,
                  min: 1200,
                  max: 1416,
                  missingToThreshold: 680,
                },
                note: "max became known",
              },
            ],
          },
        }}
        setShowCameraSelector={setShowCameraSelector}
        showCameraSelector={false}
        status="Scanning"
        syncSourceName="This phone"
        toggleTorch={vi.fn()}
        t={(key, options) => {
          if (key === "common.fps") return "fps";
          if (key === "scanner.syncSource")
            return `Sync ${options?.device}`;
          if (key === "scanner.currentChunk")
            return `Chunk ${options?.current}/${options?.total}`;
          if (key === "scanner.sessionProgress")
            return `Session ${options?.received}/${options?.total}`;
          if (key === "scanner.scanned") return "Scanned";
          if (key === "scanner.min") return "Min";
          if (key === "scanner.max") return "Max";
          if (key === "scanner.session") return "Session";
          if (key === "scanner.local") return "Local";
          if (key === "scanner.chunk") return "Chunk";
          if (key === "scanner.sharedSyncPending") return "Syncing shared session...";
          if (key === "scanner.selectCamera") return "Select camera";
          if (key === "scanner.torchOn") return "Torch on";
          if (key === "scanner.torchOff") return "Torch off";
          if (key === "scanner.resetScanner") return "Reset scanner";
          if (key === "scanner.help") return "Help";
          if (key === "scanner.helpTitle") return "Help title";
          if (key === "scanner.helpTips.positioning") return "Positioning";
          if (key === "scanner.helpTips.positioningDesc") return "Positioning desc";
          if (key === "scanner.helpTips.lighting") return "Lighting";
          if (key === "scanner.helpTips.lightingDesc") return "Lighting desc";
          if (key === "scanner.helpTips.torch") return "Torch";
          if (key === "scanner.helpTips.torchDesc") return "Torch desc";
          if (key === "scanner.helpTips.speed") return "Speed";
          if (key === "scanner.helpTips.speedDesc") return "Speed desc";
          if (key === "common.close") return "Close";
          return key;
        }}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByText("FPS").closest("div")).toHaveTextContent("24 FPS");
    expect(screen.getByTestId("scanner-sync-source")).toHaveTextContent("Sync This phone");
    expect(screen.getByTestId("scanner-sync-label")).toHaveClass("text-white");
    expect(screen.getByTestId("scanner-sync-device")).toHaveClass("text-cyan-300");
    expect(screen.getByTestId("scanner-current-chunk")).toHaveTextContent("Chunk 2/3");
    expect(screen.getByTestId("scanner-session-progress")).toHaveTextContent("Session 500/~1182");
    expect(screen.getByTestId("scanner-stat-scanned")).toHaveTextContent("500");
    expect(screen.getByTestId("scanner-stat-min")).toHaveTextContent("1182");
    expect(screen.getByTestId("scanner-stat-max")).toHaveTextContent("1416");
    expect(screen.getByTestId("scanner-local-progress-summary")).toHaveTextContent("This phone");
    expect(screen.getByTestId("scanner-local-progress-summary")).toHaveTextContent("84");
    expect(screen.getByTestId("scanner-local-progress-summary")).toHaveTextContent("Chunk");
    expect(screen.getByTestId("scanner-local-progress-summary")).toHaveTextContent("2/3");
    expect(screen.getByTestId("scanner-local-progress-summary")).not.toHaveTextContent("394/472");
    expect(screen.getByTestId("scanner-bottom-overlay")).toHaveClass(
      "pt-4",
      "px-4",
      "pb-[calc(env(safe-area-inset-bottom,0px)+7rem)]"
    );
    expect(within(screen.getByTestId("scanner-bottom-overlay")).getAllByText("Session")).toHaveLength(3);
    expect(within(screen.getByTestId("scanner-bottom-overlay")).getByText("Chunk")).toBeInTheDocument();
    expect(screen.getByTestId("scanner-sync-diagnostics")).toHaveTextContent("ID 1775220640");
    expect(screen.getByTestId("scanner-sync-diagnostics")).toHaveTextContent("HISTORY 69/1393 local");
    expect(screen.getByTestId("scanner-sync-diagnostics")).toHaveTextContent("WS ready q0 b69 rt1 conn7-connection");
    expect(screen.getByTestId("scanner-sync-diagnostics")).toHaveTextContent("SOCKET o3 e2 c1 msgresumeState close1011");
    expect(screen.getByTestId("scanner-sync-diagnostics")).toHaveTextContent("SERVER 69/1162 active");
    expect(screen.getByTestId("scanner-sync-diagnostics")).toHaveTextContent(
      "DIFF scanner-session min 1182->1200 max ?->1416 missing 682->680"
    );
    const statusBadge = within(screen.getByTestId("scanner-bottom-overlay")).getByTestId(
      "scanner-status-badge"
    );
    expect(statusBadge).toHaveTextContent("Scanning");
    expect(statusBadge.previousElementSibling).not.toBeNull();

    fireEvent.click(screen.getByTitle("Select camera"));
    expect(setShowCameraSelector).toHaveBeenCalledWith(true);
    expect(screen.getByTitle("Select camera").querySelector("span")).toBeNull();
  });

  it("opens chunk details from the current chunk badge and colors compact chunk statuses", () => {
    renderChunkStatusChrome();

    const currentChunk = screen.getByTestId("scanner-current-chunk");
    expect(currentChunk).toHaveTextContent("Chunk 2/3");
    expect(currentChunk).toHaveClass("text-amber-200");

    fireEvent.click(currentChunk);

    expect(screen.getByTestId("scanner-chunk-details")).toHaveTextContent(
      "Select chunk"
    );
    expect(screen.getByTestId("scanner-chunk-selector-item-0")).toHaveClass(
      "bg-[var(--airqr-success-surface)]",
      "text-[var(--airqr-success-text)]"
    );
    expect(screen.getByTestId("scanner-chunk-selector-item-1")).toHaveClass(
      "bg-[var(--airqr-warning-surface)]",
      "text-[var(--airqr-warning-text)]"
    );
  });

  it("marks the current chunk badge green when the active chunk is complete", () => {
    renderChunkStatusChrome({
      chunks: [
        makeChunk(0, "scanning"),
        makeChunk(1, "complete"),
        makeChunk(2, "missing"),
      ],
    });

    expect(screen.getByTestId("scanner-current-chunk")).toHaveTextContent(
      "Chunk 2/3"
    );
    expect(screen.getByTestId("scanner-current-chunk")).toHaveClass(
      "text-emerald-200",
      "border-emerald-300/20"
    );
  });

  it("colors zero-missing chunks green even before the server marks them complete", () => {
    renderChunkStatusChrome({
      chunks: [
        makeChunk(0, "missing"),
        {
          ...makeChunk(1, "missing"),
          receivedUnique: 394,
          missingCount: 0,
          missingRanges: [],
        },
        makeChunk(2, "missing"),
      ],
    });

    const currentChunk = screen.getByTestId("scanner-current-chunk");
    expect(currentChunk).toHaveTextContent("Chunk 2/3");
    expect(currentChunk).toHaveClass(
      "text-emerald-200",
      "border-emerald-300/20"
    );

    fireEvent.click(currentChunk);

    expect(screen.getByTestId("scanner-chunk-selector-item-1")).toHaveClass(
      "bg-[var(--airqr-success-surface)]",
      "text-[var(--airqr-success-text)]"
    );
    expect(screen.getByTestId("scanner-chunk-details")).toHaveTextContent(
      "Complete"
    );
  });

  it("colors chunk cards by displayed missing count, not server state", () => {
    renderChunkStatusChrome({
      chunks: [
        makeChunk(0, "missing"),
        {
          ...makeChunk(1, "complete"),
          receivedUnique: 116,
          missingCount: 278,
          missingRanges: [[116, 393]],
        },
        {
          ...makeChunk(2, "missing"),
          receivedUnique: 394,
          missingCount: 0,
          missingRanges: [],
        },
      ],
    });

    const currentChunk = screen.getByTestId("scanner-current-chunk");
    fireEvent.click(currentChunk);

    const contradictoryCompleteChunk = screen.getByTestId(
      "scanner-chunk-selector-item-1"
    );
    expect(contradictoryCompleteChunk).toHaveTextContent("278 missing");
    expect(contradictoryCompleteChunk).not.toHaveClass(
      "bg-[var(--airqr-success-surface)]",
      "text-[var(--airqr-success-text)]"
    );

    const zeroMissingChunk = screen.getByTestId("scanner-chunk-selector-item-2");
    expect(zeroMissingChunk).toHaveTextContent("0 missing");
    expect(zeroMissingChunk).toHaveClass(
      "bg-[var(--airqr-success-surface)]",
      "text-[var(--airqr-success-text)]"
    );
  });

  it("shows zero missing as a green complete chip when every chunk is complete", () => {
    renderChunkStatusChrome({
      activeChunk: { current: 1, total: 2 },
      chunks: [makeChunk(0, "complete"), makeChunk(1, "complete")],
    });

    const missingToggle = screen.getByTestId("scanner-session-missing-toggle");
    expect(missingToggle).toHaveTextContent("0 missing");
    expect(missingToggle).toHaveClass(
      "text-emerald-200",
      "border-emerald-300/20"
    );

    fireEvent.click(missingToggle);
    expect(screen.getByRole("button", { name: /Candidates/ })).toHaveClass(
      "border-emerald-300/15",
      "bg-emerald-500/10"
    );
  });

  it("opens and closes the help modal from the overlay", () => {
    render(
      <ScannerChrome
        activeChunk={null}
        availableCameras={[]}
        cameraButtonRef={{ current: null }}
        cameraDropdownStyle={null}
        cameraSelectorRef={{ current: null }}
        fps={0}
        getCameraDisplayName={() => ""}
        handleSelectCamera={vi.fn()}
        localDeviceName="This phone"
        progress={0}
        scanStats={{ received: 0, min: 0, total: 0, chunkTotal: 0 }}
        scannerTorchEnabled={false}
        selectedCameraId={null}
        sharedSessionPending={false}
        sessionProgress={null}
        diagnosticsEnabled={false}
        diagnosticsSnapshot={null}
        setShowCameraSelector={vi.fn()}
        showCameraSelector={false}
        status="Ready"
        syncSourceName={null}
        toggleTorch={vi.fn()}
        t={(key) => {
          if (key === "common.fps") return "fps";
          if (key === "scanner.scanned") return "Scanned";
          if (key === "scanner.min") return "Min";
          if (key === "scanner.max") return "Max";
          if (key === "scanner.session") return "Session";
          if (key === "scanner.local") return "Local";
          if (key === "scanner.chunk") return "Chunk";
          if (key === "scanner.sharedSyncPending") return "Syncing shared session...";
          if (key === "scanner.selectCamera") return "Select camera";
          if (key === "scanner.torchOn") return "Torch on";
          if (key === "scanner.torchOff") return "Torch off";
          if (key === "scanner.resetScanner") return "Reset scanner";
          if (key === "scanner.help") return "Help";
          if (key === "scanner.helpTitle") return "Help title";
          if (key === "scanner.helpTips.positioning") return "Positioning";
          if (key === "scanner.helpTips.positioningDesc") return "Positioning desc";
          if (key === "scanner.helpTips.lighting") return "Lighting";
          if (key === "scanner.helpTips.lightingDesc") return "Lighting desc";
          if (key === "scanner.helpTips.torch") return "Torch";
          if (key === "scanner.helpTips.torchDesc") return "Torch desc";
          if (key === "scanner.helpTips.speed") return "Speed";
          if (key === "scanner.helpTips.speedDesc") return "Speed desc";
          if (key === "common.close") return "Close";
          return key;
        }}
        onReset={vi.fn()}
      />
    );

    expect(screen.queryByText("Help title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Help"));
    expect(screen.getByText("Help title")).toBeInTheDocument();
    expect(screen.getByText("Positioning")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Help title")).not.toBeInTheDocument();
  });

  it("marks local stats as pending until shared session progress catches up", () => {
    render(
      <ScannerChrome
        activeChunk={{ current: 1, total: 3 }}
        availableCameras={[]}
        cameraButtonRef={{ current: null }}
        cameraDropdownStyle={null}
        cameraSelectorRef={{ current: null }}
        fps={12}
        getCameraDisplayName={() => ""}
        handleSelectCamera={vi.fn()}
        localDeviceName="This phone"
        progress={18}
        scanStats={{ received: 212, min: 394, total: undefined, chunkTotal: 472 }}
        scannerTorchEnabled={false}
        selectedCameraId={null}
        sharedSessionPending={true}
        sessionProgress={null}
        diagnosticsEnabled={false}
        diagnosticsSnapshot={null}
        setShowCameraSelector={vi.fn()}
        showCameraSelector={false}
        status="Progress: 18.0% (212/1182)"
        syncSourceName="This phone"
        toggleTorch={vi.fn()}
        t={(key) => {
          if (key === "common.fps") return "fps";
          if (key === "scanner.scanned") return "Scanned";
          if (key === "scanner.min") return "Min";
          if (key === "scanner.max") return "Max";
          if (key === "scanner.session") return "Session";
          if (key === "scanner.local") return "Local";
          if (key === "scanner.chunk") return "Chunk";
          if (key === "scanner.sharedSyncPending") return "Syncing shared session...";
          if (key === "scanner.selectCamera") return "Select camera";
          if (key === "scanner.torchOn") return "Torch on";
          if (key === "scanner.torchOff") return "Torch off";
          if (key === "scanner.resetScanner") return "Reset scanner";
          if (key === "scanner.help") return "Help";
          if (key === "scanner.helpTitle") return "Help title";
          if (key === "scanner.helpTips.positioning") return "Positioning";
          if (key === "scanner.helpTips.positioningDesc") return "Positioning desc";
          if (key === "scanner.helpTips.lighting") return "Lighting";
          if (key === "scanner.helpTips.lightingDesc") return "Lighting desc";
          if (key === "scanner.helpTips.torch") return "Torch";
          if (key === "scanner.helpTips.torchDesc") return "Torch desc";
          if (key === "scanner.helpTips.speed") return "Speed";
          if (key === "scanner.helpTips.speedDesc") return "Speed desc";
          if (key === "common.close") return "Close";
          return key;
        }}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByTestId("scanner-stat-scanned")).toHaveTextContent("212");
    expect(screen.getByTestId("scanner-stat-max")).toHaveTextContent("-");
    expect(screen.getByTestId("scanner-sync-pending")).toHaveTextContent(
      "Syncing shared session..."
    );
    expect(within(screen.getByTestId("scanner-bottom-overlay")).getAllByText("Local")).toHaveLength(3);
  });

  it("shows canonical session and chunk details from shared progress", () => {
    render(
      <ScannerChrome
        activeChunk={null}
        availableCameras={[]}
        cameraButtonRef={{ current: null }}
        cameraDropdownStyle={null}
        cameraSelectorRef={{ current: null }}
        fps={18}
        getCameraDisplayName={() => ""}
        handleSelectCamera={vi.fn()}
        localDeviceName="This phone"
        progress={99}
        scanStats={{ received: 8982, min: 8954, total: 9000, chunkTotal: 3983 }}
        scannerTorchEnabled={false}
        selectedCameraId={null}
        sharedSessionPending={false}
        sessionProgress={{
          received: 8982,
          total: 9000,
          totalLabel: "9000",
          totalIsEstimate: false,
          min: 8954,
          minLabel: "8954",
          max: 10744,
          maxLabel: "10744",
          percent: 99,
          decodeState: "decode_pending",
          fileAvailable: false,
          chunksTotal: 3,
          chunksComplete: 1,
          chunksMissing: 2,
          chunks: [
            {
              chunkId: 0,
              receivedUnique: 3983,
              decodeThreshold: 3983,
              totalPackets: 3983,
              totalPacketsExact: true,
              state: "complete",
              missingCount: 0,
              missingRanges: [],
            },
            {
              chunkId: 1,
              receivedUnique: 3983,
              decodeThreshold: 3983,
              totalPackets: 3983,
              totalPacketsExact: true,
              state: "threshold_reached",
              missingCount: 0,
              missingRanges: [],
            },
            {
              chunkId: 2,
              receivedUnique: 0,
              decodeThreshold: 3983,
              totalPackets: 3983,
              totalPacketsExact: true,
              state: "missing",
              missingCount: 3983,
              missingRanges: [[0, 3982]],
              targetFrameCount: 3983,
              targetFrameRanges: [[0, 3982]],
              unseenFrameCount: 3983,
              unseenFrameRanges: [[0, 3982]],
            },
          ],
        }}
        diagnosticsEnabled={false}
        diagnosticsSnapshot={null}
        setShowCameraSelector={vi.fn()}
        showCameraSelector={false}
        status="Session progress: 99.0% (8982/9000)"
        syncSourceName="Server"
        toggleTorch={vi.fn()}
        t={(key, options) => {
          if (key === "common.fps") return "fps";
          if (key === "scanner.syncSource")
            return `Sync ${options?.device}`;
          if (key === "scanner.sessionProgress")
            return `Session ${options?.received}/${options?.total}`;
          if (key === "scanner.scanned") return "Scanned";
          if (key === "scanner.min") return "Min";
          if (key === "scanner.max") return "Max";
          if (key === "scanner.session") return "Session";
          if (key === "scanner.local") return "Local";
          if (key === "scanner.chunk") return "Chunk";
          if (key === "scanner.sharedSyncPending") return "Syncing shared session...";
          if (key === "scanner.sessionThreshold")
            return `Threshold ${options?.threshold} reached +${options?.delta}`;
          if (key === "scanner.sessionThresholdMissing")
            return `Missing ${options?.missing}`;
          if (key === "scanner.decodePending") return "Decode pending";
          if (key === "scanner.assembling") return "Assembling";
          if (key === "scanner.fileReady") return "File ready";
          if (key === "scanner.chunksComplete")
            return `Chunks complete ${options?.complete}/${options?.total}`;
          if (key === "scanner.chunksMissing")
            return `Missing chunks ${options?.missing}`;
          if (key === "scanner.nextChunkTarget")
            return `Scan chunk ${options?.chunk}: ${options?.missing} more unique QR (${options?.received}/${options?.threshold})`;
          if (key === "scanner.chunkMissingSummary")
            return `${options?.missing} missing`;
          if (key === "scanner.chunkDetails") return "Chunk details";
          if (key === "scanner.hideChunkDetails") return "Hide chunk details";
          if (key === "scanner.chunkSelectorLabel") return "Select chunk";
          if (key === "scanner.chunkCandidates") return "Candidates";
          if (key === "scanner.chunkUnseen") return "Unseen";
          if (key === "scanner.chunkStatusComplete") return "Complete";
          if (key === "scanner.chunkStatusThreshold") return "Threshold reached";
          if (key === "scanner.chunkStatusScanning") return "Scanning";
          if (key === "scanner.chunkStatusMissing") return "Missing";
          if (key === "scanner.chunkDecodeProgress")
            return `${options?.received}/${options?.threshold} to threshold`;
          if (key === "scanner.chunkThresholdMissing")
            return `${options?.missing} more unique QR`;
          if (key === "scanner.chunkUnseenFrameRanges") return "Frames not seen";
          if (key === "scanner.chunkUnseenFrameCount")
            return `${options?.count} frame gaps`;
          if (key === "scanner.chunkTargetFrameRanges") return "Minimum proposed target";
          if (key === "scanner.chunkTargetFrameCount")
            return `${options?.count} candidate frames`;
          if (key === "scanner.chunkUnseenFramePool")
            return `${options?.count} unseen available`;
          if (key === "scanner.chunkMissingPackets")
            return `${options?.count} missing`;
          if (key === "scanner.selectCamera") return "Select camera";
          if (key === "scanner.torchOn") return "Torch on";
          if (key === "scanner.torchOff") return "Torch off";
          if (key === "scanner.resetScanner") return "Reset scanner";
          if (key === "scanner.help") return "Help";
          if (key === "scanner.helpTitle") return "Help title";
          if (key === "scanner.helpTips.positioning") return "Positioning";
          if (key === "scanner.helpTips.positioningDesc") return "Positioning desc";
          if (key === "scanner.helpTips.lighting") return "Lighting";
          if (key === "scanner.helpTips.lightingDesc") return "Lighting desc";
          if (key === "scanner.helpTips.torch") return "Torch";
          if (key === "scanner.helpTips.torchDesc") return "Torch desc";
          if (key === "scanner.helpTips.speed") return "Speed";
          if (key === "scanner.helpTips.speedDesc") return "Speed desc";
          if (key === "common.close") return "Close";
          return key;
        }}
        onReset={vi.fn()}
      />
    );

    const sessionSummary = screen.getByTestId("scanner-session-state-summary");
    expect(sessionSummary).toHaveTextContent("Threshold 8954 reached +28");
    expect(sessionSummary).toHaveTextContent("Decode pending");

    expect(screen.getByTestId("scanner-session-progress")).toHaveTextContent(
      "Session 8982/9000"
    );
    const missingToggle = screen.getByTestId("scanner-session-missing-toggle");
    expect(missingToggle).toHaveTextContent("3983 missing");
    expect(screen.queryByTestId("scanner-chunk-summary")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chunk details" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("scanner-next-chunk-target")).not.toBeInTheDocument();

    fireEvent.click(missingToggle);

    const details = screen.getByTestId("scanner-chunk-details");
    expect(details).toHaveTextContent("Select chunk");
    expect(details).toHaveTextContent("Chunk 3");
    expect(details).toHaveTextContent("Missing");
    expect(details).toHaveTextContent("3983 more unique QR");
    expect(details).not.toHaveTextContent("3983 candidate frames");
    expect(screen.getByRole("button", { name: /Candidates/ })).toHaveClass(
      "border-amber-300/15",
      "bg-amber-500/10"
    );

    fireEvent.click(screen.getByRole("button", { name: /Candidates/ }));

    expect(details).toHaveTextContent("Minimum proposed target");
    expect(details).toHaveTextContent("3983 candidate frames");
    expect(details).toHaveTextContent("#0-#3982 (3983)");
    expect(details).not.toHaveTextContent("Frames not seen");
  });

  it("prioritizes QR still needed for threshold over contiguous frame gaps", () => {
    render(
      <ScannerChrome
        activeChunk={null}
        availableCameras={[]}
        cameraButtonRef={{ current: null }}
        cameraDropdownStyle={null}
        cameraSelectorRef={{ current: null }}
        fps={18}
        getCameraDisplayName={() => ""}
        handleSelectCamera={vi.fn()}
        localDeviceName="This phone"
        progress={10}
        scanStats={{ received: 5, min: 52, total: 64, chunkTotal: 64 }}
        scannerTorchEnabled={false}
        selectedCameraId={null}
        sharedSessionPending={false}
        sessionProgress={{
          received: 5,
          total: 52,
          totalLabel: "52",
          totalIsEstimate: true,
          min: 52,
          minLabel: "52",
          max: 64,
          maxLabel: "64",
          percent: 10,
          decodeState: "scanning",
          fileAvailable: false,
          chunksTotal: 1,
          chunksComplete: 0,
          chunksMissing: 1,
          chunks: [
            {
              chunkId: 0,
              receivedUnique: 5,
              decodeThreshold: 52,
              totalPackets: 64,
              totalPacketsExact: true,
              state: "scanning",
              missingCount: 20,
              missingRanges: [[0, 19]],
              targetFrameCount: 47,
              targetFrameRanges: [[0, 6], [20, 22], [24, 60]],
              unseenFrameCount: 59,
              unseenFrameRanges: [[0, 6], [20, 63], [80, 87]],
            },
          ],
        }}
        diagnosticsEnabled={false}
        diagnosticsSnapshot={null}
        setShowCameraSelector={vi.fn()}
        showCameraSelector={false}
        status="Session progress: 10.0% (5/52)"
        syncSourceName="Server"
        toggleTorch={vi.fn()}
        t={(key, options) => {
          if (key === "common.fps") return "fps";
          if (key === "scanner.syncSource")
            return `Sync ${options?.device}`;
          if (key === "scanner.sessionProgress")
            return `Session ${options?.received}/${options?.total}`;
          if (key === "scanner.scanned") return "Scanned";
          if (key === "scanner.min") return "Min";
          if (key === "scanner.max") return "Max";
          if (key === "scanner.session") return "Session";
          if (key === "scanner.local") return "Local";
          if (key === "scanner.chunk") return "Chunk";
          if (key === "scanner.sessionThresholdMissing")
            return `Missing ${options?.missing}`;
          if (key === "scanner.chunksComplete")
            return `Chunks complete ${options?.complete}/${options?.total}`;
          if (key === "scanner.chunksMissing")
            return `Missing chunks ${options?.missing}`;
          if (key === "scanner.nextChunkTarget")
            return `Scan chunk ${options?.chunk}: ${options?.missing} more unique QR (${options?.received}/${options?.threshold})`;
          if (key === "scanner.chunkMissingSummary")
            return `${options?.missing} missing`;
          if (key === "scanner.chunkDetails") return "Chunk details";
          if (key === "scanner.hideChunkDetails") return "Hide chunk details";
          if (key === "scanner.chunkSelectorLabel") return "Select chunk";
          if (key === "scanner.chunkCandidates") return "Candidates";
          if (key === "scanner.chunkUnseen") return "Unseen";
          if (key === "scanner.chunkStatusComplete") return "Complete";
          if (key === "scanner.chunkStatusThreshold") return "Threshold reached";
          if (key === "scanner.chunkStatusScanning") return "Scanning";
          if (key === "scanner.chunkStatusMissing") return "Missing";
          if (key === "scanner.chunkDecodeProgress")
            return `${options?.received}/${options?.threshold} to threshold`;
          if (key === "scanner.chunkThresholdMissing")
            return `${options?.missing} more unique QR`;
          if (key === "scanner.chunkUnseenFrameRanges") return "Frames not seen";
          if (key === "scanner.chunkUnseenFrameCount")
            return `${options?.count} frame gaps`;
          if (key === "scanner.chunkTargetFrameRanges") return "Minimum proposed target";
          if (key === "scanner.chunkTargetFrameCount")
            return `${options?.count} candidate frames`;
          if (key === "scanner.chunkUnseenFramePool")
            return `${options?.count} unseen available`;
          if (key === "scanner.chunkMissingPackets")
            return `${options?.count} missing`;
          if (key === "scanner.selectCamera") return "Select camera";
          if (key === "scanner.torchOn") return "Torch on";
          if (key === "scanner.torchOff") return "Torch off";
          if (key === "scanner.resetScanner") return "Reset scanner";
          if (key === "scanner.help") return "Help";
          if (key === "scanner.helpTitle") return "Help title";
          if (key === "scanner.helpTips.positioning") return "Positioning";
          if (key === "scanner.helpTips.positioningDesc") return "Positioning desc";
          if (key === "scanner.helpTips.lighting") return "Lighting";
          if (key === "scanner.helpTips.lightingDesc") return "Lighting desc";
          if (key === "scanner.helpTips.torch") return "Torch";
          if (key === "scanner.helpTips.torchDesc") return "Torch desc";
          if (key === "scanner.helpTips.speed") return "Speed";
          if (key === "scanner.helpTips.speedDesc") return "Speed desc";
          if (key === "common.close") return "Close";
          return key;
        }}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByTestId("scanner-session-progress")).toHaveTextContent(
      "Session 5/52"
    );
    const missingToggle = screen.getByTestId("scanner-session-missing-toggle");
    expect(missingToggle).toHaveTextContent("47 missing");
    expect(screen.queryByTestId("scanner-chunk-missing-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scanner-chunk-summary")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("scanner-session-state-summary")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("scanner-next-chunk-target")).not.toBeInTheDocument();

    fireEvent.click(missingToggle);

    expect(screen.getByTestId("scanner-top-overlay")).toHaveClass(
      "items-start"
    );
    expect(screen.getByTestId("scanner-top-controls")).toHaveClass(
      "self-start",
      "shrink-0"
    );
    expect(screen.getByTestId("scanner-chunk-details-anchor")).toHaveClass(
      "absolute",
      "left-0",
      "top-full",
      "mt-1"
    );

    const details = screen.getByTestId("scanner-chunk-details");
    expect(details).toHaveTextContent("5/52 to threshold");
    expect(details).toHaveTextContent("47 more unique QR");
    expect(details).not.toHaveTextContent("Minimum proposed target");
    expect(details).not.toHaveTextContent("47 candidate frames");

    fireEvent.click(screen.getByRole("button", { name: /Candidates/ }));

    expect(details).toHaveTextContent("Minimum proposed target");
    expect(details).toHaveTextContent("47 candidate frames");
    expect(details).toHaveTextContent("59 unseen available");
    expect(details).toHaveTextContent("#0-#6 (7)");
    expect(details).toHaveTextContent("#20-#22 (3)");
    expect(details).toHaveTextContent("#24-#60 (37)");
    expect(details).not.toHaveTextContent("Frames not seen");
    expect(details).not.toHaveTextContent("20 frame gaps");
    expect(details).not.toHaveTextContent("20 missing");
  });

  it("shows inclusive counts for target frame ranges", () => {
    render(
      <ScannerChrome
        activeChunk={null}
        availableCameras={[]}
        cameraButtonRef={{ current: null }}
        cameraDropdownStyle={null}
        cameraSelectorRef={{ current: null }}
        fps={18}
        getCameraDisplayName={() => ""}
        handleSelectCamera={vi.fn()}
        localDeviceName="This phone"
        progress={55}
        scanStats={{ received: 29, min: 52, total: 62, chunkTotal: 62 }}
        scannerTorchEnabled={false}
        selectedCameraId={null}
        sharedSessionPending={false}
        sessionProgress={{
          received: 29,
          total: 52,
          totalLabel: "52",
          totalIsEstimate: false,
          min: 52,
          minLabel: "52",
          max: 62,
          maxLabel: "62",
          percent: 55,
          decodeState: "scanning",
          fileAvailable: false,
          chunksTotal: 1,
          chunksComplete: 0,
          chunksMissing: 1,
          chunks: [
            {
              chunkId: 0,
              receivedUnique: 29,
              decodeThreshold: 52,
              totalPackets: 62,
              totalPacketsExact: true,
              state: "scanning",
              missingCount: 28,
              missingRanges: [
                [0, 13],
                [21, 30],
                [39, 41],
                [43, 43],
              ],
              targetFrameCount: 23,
              targetFrameRanges: [
                [0, 13],
                [21, 29],
              ],
              unseenFrameCount: 33,
              unseenFrameRanges: [
                [0, 13],
                [21, 30],
                [39, 41],
                [43, 43],
                [57, 61],
              ],
            },
          ],
        }}
        diagnosticsEnabled={false}
        diagnosticsSnapshot={null}
        setShowCameraSelector={vi.fn()}
        showCameraSelector={false}
        status="Session progress: 55.0% (29/52)"
        syncSourceName="Server"
        toggleTorch={vi.fn()}
        t={(key, options) => {
          if (key === "common.fps") return "fps";
          if (key === "scanner.syncSource")
            return `Sync ${options?.device}`;
          if (key === "scanner.sessionProgress")
            return `Session ${options?.received}/${options?.total}`;
          if (key === "scanner.scanned") return "Scanned";
          if (key === "scanner.min") return "Min";
          if (key === "scanner.max") return "Max";
          if (key === "scanner.session") return "Session";
          if (key === "scanner.local") return "Local";
          if (key === "scanner.chunk") return "Chunk";
          if (key === "scanner.sessionThresholdMissing")
            return `Missing ${options?.missing}`;
          if (key === "scanner.chunksComplete")
            return `Chunks complete ${options?.complete}/${options?.total}`;
          if (key === "scanner.chunksMissing")
            return `Missing chunks ${options?.missing}`;
          if (key === "scanner.nextChunkTarget")
            return `Scan chunk ${options?.chunk}: ${options?.missing} more unique QR (${options?.received}/${options?.threshold})`;
          if (key === "scanner.chunkMissingSummary")
            return `${options?.missing} missing`;
          if (key === "scanner.chunkDetails") return "Chunk details";
          if (key === "scanner.hideChunkDetails") return "Hide chunk details";
          if (key === "scanner.chunkSelectorLabel") return "Select chunk";
          if (key === "scanner.chunkCandidates") return "Candidates";
          if (key === "scanner.chunkUnseen") return "Unseen";
          if (key === "scanner.chunkStatusComplete") return "Complete";
          if (key === "scanner.chunkStatusThreshold") return "Threshold reached";
          if (key === "scanner.chunkStatusScanning") return "Scanning";
          if (key === "scanner.chunkStatusMissing") return "Missing";
          if (key === "scanner.chunkDecodeProgress")
            return `${options?.received}/${options?.threshold} to threshold`;
          if (key === "scanner.chunkThresholdMissing")
            return `${options?.missing} more unique QR`;
          if (key === "scanner.chunkTargetFrameRanges") return "Minimum proposed target";
          if (key === "scanner.chunkTargetFrameCount")
            return `${options?.count} candidate frames`;
          if (key === "scanner.chunkUnseenFramePool")
            return `${options?.count} unseen available`;
          if (key === "scanner.chunkUnseenFrameRanges") return "Frames not seen";
          if (key === "scanner.chunkUnseenFrameCount")
            return `${options?.count} unseen frames`;
          if (key === "scanner.chunkMissingPackets")
            return `${options?.count} missing`;
          if (key === "scanner.selectCamera") return "Select camera";
          if (key === "scanner.torchOn") return "Torch on";
          if (key === "scanner.torchOff") return "Torch off";
          if (key === "scanner.resetScanner") return "Reset scanner";
          if (key === "scanner.help") return "Help";
          if (key === "scanner.helpTitle") return "Help title";
          if (key === "scanner.helpTips.positioning") return "Positioning";
          if (key === "scanner.helpTips.positioningDesc") return "Positioning desc";
          if (key === "scanner.helpTips.lighting") return "Lighting";
          if (key === "scanner.helpTips.lightingDesc") return "Lighting desc";
          if (key === "scanner.helpTips.torch") return "Torch";
          if (key === "scanner.helpTips.torchDesc") return "Torch desc";
          if (key === "scanner.helpTips.speed") return "Speed";
          if (key === "scanner.helpTips.speedDesc") return "Speed desc";
          if (key === "common.close") return "Close";
          return key;
        }}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByTestId("scanner-session-progress")).toHaveTextContent(
      "Session 29/52"
    );
    const missingToggle = screen.getByTestId("scanner-session-missing-toggle");
    expect(missingToggle).toHaveTextContent("23 missing");
    expect(screen.queryByTestId("scanner-chunk-missing-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scanner-chunk-summary")).not.toBeInTheDocument();

    fireEvent.click(missingToggle);

    const details = screen.getByTestId("scanner-chunk-details");
    expect(details).not.toHaveTextContent("#0-#13 (14)");

    fireEvent.click(screen.getByRole("button", { name: /Candidates/ }));

    expect(details).toHaveTextContent("23 candidate frames");
    expect(details).toHaveTextContent("33 unseen available");
    expect(details).toHaveTextContent("#0-#13 (14)");
    expect(details).toHaveTextContent("#21-#29 (9)");

    fireEvent.click(screen.getByRole("button", { name: /Unseen/ }));

    expect(details).toHaveTextContent("Frames not seen");
    expect(details).toHaveTextContent("33 unseen frames");
    expect(details).toHaveTextContent("#21-#30 (10)");
    expect(details).toHaveTextContent("#57-#61 (5)");
  });
});
