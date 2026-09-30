import React, { useState } from "react";

import Icon from "../../components/ui/Icon";
import type {
  MultiScanDiagnosticsSnapshot,
  ProgressDiagnosticCounter,
  ProgressDiagnosticField,
  ProgressDiagnosticTransition,
} from "../../services/multiScanDiagnostics";
import type { SessionProgressInfo } from "../../hooks/useScannerSyncProgress";
import ScannerHelpModal from "./ScannerHelpModal";

type TranslateOptions = {
  readonly [name: string]: string | number | boolean | undefined;
};
type TranslationFn = (key: string, options?: TranslateOptions) => string;
type ScannerChunkInfo = NonNullable<SessionProgressInfo["chunks"]>[number];

interface ActiveChunkInfo {
  current: number;
  total: number;
}

interface ScannerStats {
  received: number;
  min: number;
  total?: number;
  chunkTotal?: number;
  chunkReceived?: number;
}

interface ScannerChromeProps {
  activeChunk: ActiveChunkInfo | null;
  availableCameras: MediaDeviceInfo[];
  cameraButtonRef: React.RefObject<HTMLButtonElement | null>;
  cameraDropdownStyle: React.CSSProperties | null;
  cameraSelectorRef: React.RefObject<HTMLDivElement | null>;
  fps: number;
  getCameraDisplayName: (camera: MediaDeviceInfo, index: number) => string;
  handleSelectCamera: (deviceId: string) => void;
  localDeviceName: string;
  progress: number;
  scanStats: ScannerStats;
  scannerTorchEnabled: boolean;
  selectedCameraId: string | null;
  sharedSessionPending: boolean;
  sessionProgress: SessionProgressInfo | null;
  diagnosticsEnabled: boolean;
  diagnosticsSnapshot: MultiScanDiagnosticsSnapshot | null;
  setShowCameraSelector: (show: boolean) => void;
  showCameraSelector: boolean;
  status: string;
  syncSourceName: string | null;
  t: TranslationFn;
  toggleTorch: () => void;
  onReset: () => void;
}

const CHUNK_RANGE_DISPLAY_LIMIT = 6;

function buildEmptyChunk(chunkId: number): ScannerChunkInfo {
  return {
    chunkId,
    receivedUnique: 0,
    decodeThreshold: null,
    totalPackets: null,
    totalPacketsExact: false,
    state: "missing",
    missingCount: null,
    missingRanges: [],
    targetFrameCount: null,
    targetFrameRanges: [],
    unseenFrameCount: null,
    unseenFrameRanges: [],
  };
}

function buildCanonicalChunks(
  chunks: ScannerChunkInfo[],
  chunksTotal: number | null
): ScannerChunkInfo[] {
  const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const observedTotal = chunks.reduce(
    (maxChunkId, chunk) => Math.max(maxChunkId, chunk.chunkId + 1),
    0
  );
  const total =
    chunksTotal !== null && chunksTotal > 0 ? chunksTotal : observedTotal;

  if (total <= 0) {
    return [];
  }

  return Array.from({ length: total }, (_, chunkId) => {
    const chunk = byId.get(chunkId);
    if (chunk) {
      return {
        ...buildEmptyChunk(chunkId),
        ...chunk,
        missingRanges: chunk.missingRanges ?? [],
        targetFrameRanges: chunk.targetFrameRanges ?? [],
        unseenFrameRanges: chunk.unseenFrameRanges ?? [],
      };
    }

    return buildEmptyChunk(chunkId);
  });
}

function getDecodeStateLabel(
  progress: SessionProgressInfo,
  t: TranslationFn
): string | null {
  if (progress.fileAvailable || progress.decodeState === "complete") {
    return t("scanner.fileReady");
  }

  if (progress.decodeState === "assembling") {
    return t("scanner.assembling");
  }

  if (progress.decodeState === "decode_pending") {
    return t("scanner.decodePending");
  }

  return null;
}

function getChunkStatusLabel(
  state: ScannerChunkInfo["state"],
  t: TranslationFn
): string {
  if (state === "complete") {
    return t("scanner.chunkStatusComplete");
  }
  if (state === "threshold_reached") {
    return t("scanner.chunkStatusThreshold");
  }
  if (state === "scanning") {
    return t("scanner.chunkStatusScanning");
  }
  if (state === "missing") {
    return t("scanner.chunkStatusMissing");
  }
  return state;
}

function getChunkStatusClassName(state: ScannerChunkInfo["state"]): string {
  if (state === "complete") {
    return "border-[color:rgb(22_163_74/0.22)] bg-[var(--airqr-success-surface)] text-[var(--airqr-success-text)]";
  }
  if (state === "threshold_reached") {
    return "border-[color:rgb(22_163_74/0.22)] bg-[var(--airqr-success-surface)] text-[var(--airqr-success-text)]";
  }
  if (state === "scanning") {
    return "border-[color:rgb(51_76_255/0.24)] bg-[var(--airqr-accent-soft)] text-[var(--airqr-accent-text)]";
  }
  if (state === "missing") {
    return "border-[color:rgb(245_158_11/0.22)] bg-[var(--airqr-warning-surface)] text-[var(--airqr-warning-text)]";
  }
  return "border-[color:rgb(239_68_68/0.22)] bg-[var(--airqr-danger-surface)] text-[var(--airqr-danger-text)]";
}

function isCompleteChunk(chunk: ScannerChunkInfo | null | undefined): boolean {
  if (!chunk) return false;
  return getChunkMissingCount(chunk) === 0;
}

function getCompactChunkStatusClassName(
  chunk: ScannerChunkInfo | null | undefined
): string {
  return isCompleteChunk(chunk)
    ? "border-[color:rgb(22_163_74/0.22)] bg-[var(--airqr-success-surface)] text-[var(--airqr-success-text)]"
    : "border-[color:rgb(245_158_11/0.22)] bg-[var(--airqr-warning-surface)] text-[var(--airqr-warning-text)]";
}

function getChunkStatusClassNameForChunk(chunk: ScannerChunkInfo): string {
  if (isCompleteChunk(chunk)) {
    return "border-[color:rgb(22_163_74/0.22)] bg-[var(--airqr-success-surface)] text-[var(--airqr-success-text)]";
  }
  if (chunk.state === "scanning") {
    return getChunkStatusClassName(chunk.state);
  }
  return getChunkStatusClassName("missing");
}

function getChunkStatusLabelForChunk(
  chunk: ScannerChunkInfo,
  t: TranslationFn
): string {
  if (isCompleteChunk(chunk)) {
    return t("scanner.chunkStatusComplete");
  }
  if (chunk.state === "complete" || chunk.state === "threshold_reached") {
    return t("scanner.chunkStatusMissing");
  }
  return getChunkStatusLabel(chunk.state, t);
}

function formatMissingRange([start, end]: [number, number]): string {
  return `${start}-${end}`;
}

function formatFrameTargetRange([start, end]: [number, number]): string {
  const count = Math.max(0, end - start + 1);
  return start === end ? `#${start} (${count})` : `#${start}-#${end} (${count})`;
}

function getRemainingToThreshold(chunk: ScannerChunkInfo): number | null {
  if (
    chunk.decodeThreshold === null ||
    !Number.isFinite(chunk.decodeThreshold) ||
    chunk.decodeThreshold <= 0
  ) {
    return null;
  }

  return Math.max(0, chunk.decodeThreshold - Math.max(0, chunk.receivedUnique));
}

function getChunkMissingCount(chunk: ScannerChunkInfo): number {
  if (
    chunk.state === "complete" ||
    chunk.state === "threshold_reached"
  ) {
    if (
      chunk.missingCount !== null &&
      Number.isFinite(chunk.missingCount)
    ) {
      return Math.max(0, Math.trunc(chunk.missingCount));
    }
    const completeRemainingToThreshold = getRemainingToThreshold(chunk);
    if (completeRemainingToThreshold !== null) {
      return completeRemainingToThreshold;
    }
    return getRangeCount(chunk.missingRanges);
  }
  const remainingToThreshold = getRemainingToThreshold(chunk);
  if (remainingToThreshold !== null) {
    return remainingToThreshold;
  }
  if (
    chunk.missingCount !== null &&
    Number.isFinite(chunk.missingCount)
  ) {
    return Math.max(0, Math.trunc(chunk.missingCount));
  }
  return getRangeCount(chunk.missingRanges);
}

function getRangeCount(ranges: Array<[number, number]> | null | undefined): number {
  if (!ranges) {
    return 0;
  }
  return ranges.reduce(
    (sum, [start, end]) => sum + Math.max(0, end - start + 1),
    0
  );
}

function formatDiagnosticValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "?";
  }
  if (Number.isFinite(value)) {
    return String(value);
  }
  if (value !== "") {
    return String(value);
  }
  return "?";
}

function formatActiveChunk(
  counter: ProgressDiagnosticCounter
): string {
  const chunk = counter.activeChunk;
  if (!chunk) {
    return "?";
  }
  return `${chunk.current}/${chunk.total}`;
}

function formatTransitionPart(
  transition: ProgressDiagnosticTransition,
  field: ProgressDiagnosticField,
  label: string
): string | null {
  if (!transition.changed.includes(field)) {
    return null;
  }
  const previous =
    field === "activeChunk"
      ? formatActiveChunk(transition.previous)
      : formatDiagnosticValue(transition.previous[field]);
  const current =
    field === "activeChunk"
      ? formatActiveChunk(transition.current)
      : formatDiagnosticValue(transition.current[field]);
  return `${label} ${previous}->${current}`;
}

function formatProgressTransition(
  transition: ProgressDiagnosticTransition
): string {
  const parts = [
    formatTransitionPart(transition, "received", "recv"),
    formatTransitionPart(transition, "min", "min"),
    formatTransitionPart(transition, "max", "max"),
    formatTransitionPart(transition, "missingToThreshold", "missing"),
    formatTransitionPart(transition, "activeChunk", "chunk"),
    formatTransitionPart(transition, "chunksTotal", "chunks"),
    formatTransitionPart(transition, "chunksMissing", "chunksMissing"),
    formatTransitionPart(transition, "stateVersion", "ver"),
    formatTransitionPart(transition, "decodeState", "state"),
  ].filter((part): part is string => Boolean(part));

  return `DIFF ${transition.source} ${parts.join(" ") || transition.changed.join(",")}`;
}

const ScannerChrome: React.FC<ScannerChromeProps> = ({
  activeChunk,
  availableCameras,
  cameraButtonRef,
  cameraDropdownStyle,
  cameraSelectorRef,
  fps,
  getCameraDisplayName,
  handleSelectCamera,
  localDeviceName,
  progress,
  scanStats,
  scannerTorchEnabled,
  selectedCameraId,
  sharedSessionPending,
  sessionProgress,
  diagnosticsEnabled,
  diagnosticsSnapshot,
  setShowCameraSelector,
  showCameraSelector,
  status,
  syncSourceName,
  t,
  toggleTorch,
  onReset,
}) => {
  const [showHelp, setShowHelp] = useState(false);
  const [showChunkDetails, setShowChunkDetails] = useState(false);
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(null);
  const [showCandidateFrames, setShowCandidateFrames] = useState(false);
  const [showUnseenFrames, setShowUnseenFrames] = useState(false);
  const showScopedStatHints = Boolean(activeChunk && activeChunk.total > 1);
  const activeSessionProgress = sessionProgress;
  const hasSessionProgress = Boolean(activeSessionProgress);
  const showSharedSyncPending = sharedSessionPending && !hasSessionProgress;
  const scannedValue = hasSessionProgress
    ? String(activeSessionProgress?.received ?? 0)
    : String(scanStats.received);
  const minValue = hasSessionProgress
    ? activeSessionProgress?.minLabel ?? "-"
    : String(scanStats.min);
  const maxValue = hasSessionProgress
    ? activeSessionProgress?.maxLabel ?? "-"
    : scanStats.total !== undefined && scanStats.total > 0
      ? String(scanStats.total)
      : "-";
  const sourceChunks = activeSessionProgress?.chunks ?? [];
  const activeChunkTotal =
    activeChunk && activeChunk.total > 1 ? activeChunk.total : null;
  const chunksTotal =
    activeSessionProgress?.chunksTotal !== undefined &&
    activeSessionProgress.chunksTotal !== null &&
    activeSessionProgress.chunksTotal > 0
      ? activeSessionProgress.chunksTotal
      : activeChunkTotal;
  const canonicalChunks = buildCanonicalChunks(sourceChunks, chunksTotal);
  const hasChunkSummary = chunksTotal !== null;
  const canShowChunkDetails = canonicalChunks.length > 0;
  const currentChunkInfo =
    activeChunk && activeChunk.total > 1
      ? canonicalChunks.find((chunk) => chunk.chunkId === activeChunk.current - 1) ??
        null
      : null;
  const currentChunkIsComplete = isCompleteChunk(currentChunkInfo);
  const nextChunkTarget = canonicalChunks
    .map((chunk) => ({
      chunk,
      remaining: getRemainingToThreshold(chunk),
    }))
    .find(({ remaining }) => remaining !== null && remaining > 0);
  const chunkMissingTotal = canonicalChunks.reduce(
    (sum, chunk) => sum + getChunkMissingCount(chunk),
    0
  );
  const isChunkMissingComplete = canShowChunkDetails && chunkMissingTotal === 0;
  const sessionMissingToThreshold =
    activeSessionProgress && activeSessionProgress.received < activeSessionProgress.min
      ? activeSessionProgress.min - activeSessionProgress.received
      : null;
  const shouldShowSessionMissingToggle = canShowChunkDetails;
  const showBottomChunkSummary = false;
  const sessionProgressLabel = activeSessionProgress
    ? t("scanner.sessionProgress", {
        received: activeSessionProgress.received,
        total: activeSessionProgress.totalLabel,
      })
    : null;
  const sessionThresholdLabel = activeSessionProgress
    ? sessionMissingToThreshold === null
      ? t("scanner.sessionThreshold", {
          threshold: activeSessionProgress.min,
          delta: activeSessionProgress.received - activeSessionProgress.min,
        })
      : shouldShowSessionMissingToggle
        ? null
        : t("scanner.sessionThresholdMissing", {
            missing: sessionMissingToThreshold,
          })
    : null;
  const decodeStateLabel = activeSessionProgress
    ? getDecodeStateLabel(activeSessionProgress, t)
    : null;
  const sessionStateLabels = activeSessionProgress
    ? [
        sessionThresholdLabel ??
          (shouldShowSessionMissingToggle
            ? null
            : sessionProgressLabel),
        decodeStateLabel,
      ].filter((label): label is string => Boolean(label))
    : [];
  const selectedChunk =
    canonicalChunks.find((chunk) => chunk.chunkId === selectedChunkId) ??
    currentChunkInfo ??
    nextChunkTarget?.chunk ??
    canonicalChunks.find((chunk) => !isCompleteChunk(chunk)) ??
    canonicalChunks[0] ??
    null;
  const selectedChunkMissing = selectedChunk
    ? getChunkMissingCount(selectedChunk)
    : 0;
  const selectedChunkTargetFrameCount = selectedChunk
    ? selectedChunk.targetFrameCount !== null
      ? selectedChunk.targetFrameCount
      : getRangeCount(selectedChunk.targetFrameRanges)
    : 0;
  const selectedChunkUnseenFrameCount = selectedChunk
    ? selectedChunk.unseenFrameCount !== null
      ? selectedChunk.unseenFrameCount
      : getRangeCount(selectedChunk.unseenFrameRanges)
    : 0;
  const selectedChunkCandidatesComplete =
    selectedChunk?.state === "complete" &&
    selectedChunkMissing === 0 &&
    selectedChunkTargetFrameCount === 0;
  const selectedTargetRanges = selectedChunk?.targetFrameRanges ?? [];
  const selectedUnseenRanges = selectedChunk?.unseenFrameRanges ?? [];
  const selectedMissingRanges = selectedChunk?.missingRanges ?? [];
  const selectedFrameGapCount = getRangeCount(selectedMissingRanges);
  const displayedTargetRanges = selectedTargetRanges.slice(
    0,
    CHUNK_RANGE_DISPLAY_LIMIT
  );
  const displayedUnseenRanges = selectedUnseenRanges.slice(
    0,
    CHUNK_RANGE_DISPLAY_LIMIT
  );
  const displayedMissingRanges = selectedMissingRanges.slice(
    0,
    CHUNK_RANGE_DISPLAY_LIMIT
  );
  const hiddenTargetRangeCount =
    selectedTargetRanges.length - displayedTargetRanges.length;
  const hiddenUnseenRangeCount =
    selectedUnseenRanges.length - displayedUnseenRanges.length;
  const hiddenMissingRangeCount =
    selectedMissingRanges.length - displayedMissingRanges.length;
  const transportConnectionId = diagnosticsSnapshot?.transport?.currentConnectionId;
  const shortTransportConnectionId = transportConnectionId
    ? transportConnectionId.slice(-12)
    : null;
  const diagnosticLines = diagnosticsSnapshot
    ? [
        diagnosticsSnapshot.sessionId
          ? `ID ${diagnosticsSnapshot.sessionId}`
          : "ID -",
        `LOCAL ${scanStats.received}/${scanStats.total !== undefined && scanStats.total > 0 ? scanStats.total : "-"} chunk ${scanStats.min}/${scanStats.chunkTotal !== undefined && scanStats.chunkTotal > 0 ? scanStats.chunkTotal : "-"}`,
        diagnosticsSnapshot.history
          ? `HISTORY ${diagnosticsSnapshot.history.received}/${diagnosticsSnapshot.history.total} ${diagnosticsSnapshot.history.source || "local"}`
          : "HISTORY -",
        diagnosticsSnapshot.transport
          ? `WS ${diagnosticsSnapshot.transport.state} q${diagnosticsSnapshot.transport.queuedPackets} b${diagnosticsSnapshot.transport.bufferedPackets} rt${diagnosticsSnapshot.transport.resumeTimeouts}${shortTransportConnectionId ? ` conn${shortTransportConnectionId}` : ""}`
          : "WS -",
        diagnosticsSnapshot.transport
          ? `SOCKET o${diagnosticsSnapshot.transport.socketOpens} e${diagnosticsSnapshot.transport.socketErrors} c${diagnosticsSnapshot.transport.socketCloses}${diagnosticsSnapshot.transport.lastMessageType ? ` msg${diagnosticsSnapshot.transport.lastMessageType}` : ""}${diagnosticsSnapshot.transport.lastCloseCode !== null ? ` close${diagnosticsSnapshot.transport.lastCloseCode}` : ""}`
          : "WS -",
        diagnosticsSnapshot.server
          ? `SERVER ${diagnosticsSnapshot.server.receivedCount ?? diagnosticsSnapshot.server.receivedPackets ?? diagnosticsSnapshot.server.packetCount ?? 0}/${diagnosticsSnapshot.server.expectedPackets ?? diagnosticsSnapshot.server.totalPackets ?? "-"} ${diagnosticsSnapshot.server.status || "active"}`
          : "SERVER -",
        ...(diagnosticsSnapshot.progressDiagnostics?.transitions ?? [])
          .slice(-3)
          .map(formatProgressTransition),
      ]
    : [];
  const helpTips = [
    {
      icon: "qr_code_scanner",
      title: t("scanner.helpTips.positioning"),
      description: t("scanner.helpTips.positioningDesc"),
    },
    {
      icon: "light_mode",
      title: t("scanner.helpTips.lighting"),
      description: t("scanner.helpTips.lightingDesc"),
    },
    {
      icon: "flashlight_on",
      title: t("scanner.helpTips.torch"),
      description: t("scanner.helpTips.torchDesc"),
    },
    {
      icon: "speed",
      title: t("scanner.helpTips.speed"),
      description: t("scanner.helpTips.speedDesc"),
    },
  ];
  const chunkDetailsPanel =
    showChunkDetails && canShowChunkDetails && selectedChunk ? (
      <div
        id="scanner-chunk-details"
        data-testid="scanner-chunk-details"
        className="max-h-52 overflow-y-auto rounded-lg border border-amber-300/20 bg-black/65 p-2 text-[10px] font-mono text-white/75 shadow-xl backdrop-blur-md"
        style={{ width: "min(24rem, calc(100vw - 2rem))" }}
      >
        {canonicalChunks.length > 1 ? (
          <div className="mb-2 min-w-0">
            <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-white/45">
              {t("scanner.chunkSelectorLabel")}
            </div>
            <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
              {canonicalChunks.map((chunk) => {
                const chunkMissing = getChunkMissingCount(chunk);
                const isSelected = chunk.chunkId === selectedChunk.chunkId;
                return (
                  <button
                    key={chunk.chunkId}
                    type="button"
                    data-testid={`scanner-chunk-selector-item-${chunk.chunkId}`}
                    onClick={() => {
                      setSelectedChunkId(chunk.chunkId);
                      setShowCandidateFrames(false);
                      setShowUnseenFrames(false);
                    }}
                    className={`shrink-0 rounded-lg border px-2 py-1 text-left transition-colors ${getCompactChunkStatusClassName(
                      chunk
                    )} ${
                      isSelected
                        ? "ring-1 ring-white/30"
                        : "opacity-75 hover:opacity-100"
                    }`}
                  >
                    <span className="block">
                      {t("scanner.chunk")} {chunk.chunkId + 1}
                    </span>
                    <span className="block text-[9px] text-white/45">
                      {t("scanner.chunkMissingSummary", {
                        missing: chunkMissing,
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="min-w-0 rounded-[18px] bg-white/[0.04] px-2 py-1.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-white/85">
              {t("scanner.chunk")} {selectedChunk.chunkId + 1}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 ${getChunkStatusClassNameForChunk(
                selectedChunk
              )}`}
            >
              {getChunkStatusLabelForChunk(selectedChunk, t)}
            </span>
          </div>

          {selectedChunk.decodeThreshold !== null &&
          selectedChunk.decodeThreshold > 0 ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-cyan-100">
              <span className="rounded bg-black/35 px-1.5 py-0.5">
                {t("scanner.chunkDecodeProgress", {
                  received: selectedChunk.receivedUnique,
                  threshold: selectedChunk.decodeThreshold ?? 0,
                })}
              </span>
              {selectedChunkMissing > 0 ? (
                <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-100">
                  {t("scanner.chunkThresholdMissing", {
                    missing: selectedChunkMissing,
                  })}
                </span>
              ) : null}
            </div>
          ) : selectedChunkMissing > 0 ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-amber-100">
              <span className="shrink-0">
                {t("scanner.chunkMissingPackets", {
                  count: selectedChunkMissing,
                })}
              </span>
            </div>
          ) : null}

          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              aria-expanded={showCandidateFrames}
              onClick={() => setShowCandidateFrames((current) => !current)}
              className={`rounded-lg border px-2 py-1 text-left transition-colors ${
                selectedChunkCandidatesComplete
                  ? "border-emerald-300/15 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
                  : "border-amber-300/15 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15"
              }`}
            >
              <span className="block text-white/75">
                {t("scanner.chunkCandidates")}
              </span>
              <span
                className={`block ${
                  selectedChunkCandidatesComplete
                    ? "text-emerald-50"
                    : "text-amber-50"
                }`}
              >
                {selectedChunkTargetFrameCount}
              </span>
            </button>
            <button
              type="button"
              aria-expanded={showUnseenFrames}
              onClick={() => setShowUnseenFrames((current) => !current)}
                className="rounded-[14px] border border-white/10 bg-white/[0.04] px-2 py-1 text-left text-white/70 transition-colors hover:bg-white/[0.08]"
            >
              <span className="block text-white/55">{t("scanner.chunkUnseen")}</span>
              <span className="block text-white/85">
                {selectedChunkUnseenFrameCount}
              </span>
            </button>
          </div>

          {showCandidateFrames && selectedChunkTargetFrameCount > 0 ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-lime-100">
              <span className="shrink-0 text-lime-100/80">
                {t("scanner.chunkTargetFrameRanges")}
              </span>
              <span className="shrink-0 rounded bg-lime-500/15 px-1.5 py-0.5 text-lime-50">
                {t("scanner.chunkTargetFrameCount", {
                  count: selectedChunkTargetFrameCount,
                })}
              </span>
              {selectedChunkUnseenFrameCount > selectedChunkTargetFrameCount ? (
                <span className="shrink-0 rounded bg-black/35 px-1.5 py-0.5 text-lime-100/70">
                  {t("scanner.chunkUnseenFramePool", {
                    count: selectedChunkUnseenFrameCount,
                  })}
                </span>
              ) : null}
              {displayedTargetRanges.map((range) => (
                <span
                  key={`${selectedChunk.chunkId}-target-${range[0]}-${range[1]}`}
                  className="max-w-full break-all rounded bg-black/35 px-1.5 py-0.5 text-lime-50"
                >
                  {formatFrameTargetRange(range)}
                </span>
              ))}
              {hiddenTargetRangeCount > 0 ? (
                <span className="rounded bg-black/35 px-1.5 py-0.5 text-lime-100/60">
                  +{hiddenTargetRangeCount}
                </span>
              ) : null}
            </div>
          ) : null}

          {showUnseenFrames && selectedChunkUnseenFrameCount > 0 ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-white/65">
              <span className="shrink-0 text-white/55">
                {t("scanner.chunkUnseenFrameRanges")}
              </span>
              <span className="shrink-0 rounded bg-black/35 px-1.5 py-0.5 text-white/70">
                {t("scanner.chunkUnseenFrameCount", {
                  count: selectedChunkUnseenFrameCount,
                })}
              </span>
              {displayedUnseenRanges.map((range) => (
                <span
                  key={`${selectedChunk.chunkId}-unseen-${range[0]}-${range[1]}`}
                  className="max-w-full break-all rounded bg-black/35 px-1.5 py-0.5 text-white/75"
                >
                  {formatFrameTargetRange(range)}
                </span>
              ))}
              {hiddenUnseenRangeCount > 0 ? (
                <span className="rounded bg-black/35 px-1.5 py-0.5 text-white/50">
                  +{hiddenUnseenRangeCount}
                </span>
              ) : null}
            </div>
          ) : null}

          {diagnosticsEnabled && selectedFrameGapCount > 0 ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-white/45">
              <span className="shrink-0">{t("scanner.chunkUnseenFrameRanges")}</span>
              <span className="shrink-0 rounded bg-black/35 px-1.5 py-0.5">
                {t("scanner.chunkUnseenFrameCount", {
                  count: selectedFrameGapCount,
                })}
              </span>
              {displayedMissingRanges.map((range) => (
                <span
                  key={`${selectedChunk.chunkId}-missing-${range[0]}-${range[1]}`}
                  className="max-w-full break-all rounded bg-black/35 px-1.5 py-0.5"
                >
                  {formatMissingRange(range)}
                </span>
              ))}
              {hiddenMissingRangeCount > 0 ? (
                <span className="rounded bg-black/35 px-1.5 py-0.5">
                  +{hiddenMissingRangeCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    ) : null;

  return (
    <>
      <div className="relative z-10 flex flex-col h-full justify-between">
        <div
          data-testid="scanner-top-overlay"
          className="flex items-start justify-between gap-3 p-4 pb-2 bg-gradient-to-b from-black/80 to-transparent"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
        >
          <div className="relative flex min-w-0 flex-1 flex-col items-start gap-2">
            <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
              <span className="text-xs font-mono font-bold text-green-400">
                {fps} <span className="text-white/45">{t("common.fps").toUpperCase()}</span>
              </span>
            </div>
            {syncSourceName ? (
              <div
                data-testid="scanner-sync-source"
                className="text-[11px] font-mono bg-black/45 backdrop-blur-md px-3 py-1 rounded-full border border-cyan-400/20"
              >
                <span data-testid="scanner-sync-label" className="text-white">
                  {t("scanner.syncSource", { device: "" }).trim()}
                </span>{" "}
                <span data-testid="scanner-sync-device" className="text-cyan-300">
                  {syncSourceName}
                </span>
              </div>
            ) : null}
            {activeChunk && activeChunk.total > 1 ? (
              canShowChunkDetails ? (
                <button
                  type="button"
                  data-testid="scanner-current-chunk"
                  aria-controls="scanner-chunk-details"
                  aria-expanded={showChunkDetails}
                  onClick={() => setShowChunkDetails((current) => !current)}
                  className={`text-[11px] font-mono bg-black/45 backdrop-blur-md px-3 py-1 rounded-full border transition-colors hover:bg-black/60 ${
                    currentChunkIsComplete
                      ? "text-emerald-200 border-emerald-300/20"
                      : "text-amber-200 border-amber-300/20"
                  }`}
                >
                  {t("scanner.currentChunk", {
                    current: activeChunk.current,
                    total: activeChunk.total,
                  })}
                </button>
              ) : (
                <div
                  data-testid="scanner-current-chunk"
                  className="text-[11px] font-mono text-amber-200 bg-black/45 backdrop-blur-md px-3 py-1 rounded-full border border-amber-300/20"
                >
                  {t("scanner.currentChunk", {
                    current: activeChunk.current,
                    total: activeChunk.total,
                  })}
                </div>
              )
            ) : null}
            {sessionProgress ? (
              <div
                data-testid="scanner-session-progress"
                className="text-[11px] font-mono text-lime-200 bg-black/45 backdrop-blur-md px-3 py-1 rounded-full border border-lime-300/20"
              >
                {sessionProgressLabel}
              </div>
            ) : null}
            {shouldShowSessionMissingToggle ? (
              <button
                type="button"
                data-testid="scanner-session-missing-toggle"
                aria-controls="scanner-chunk-details"
                aria-expanded={showChunkDetails}
                onClick={() => setShowChunkDetails((current) => !current)}
                className={`text-[11px] font-mono bg-black/45 backdrop-blur-md px-3 py-1 rounded-full border transition-colors hover:bg-black/60 ${
                  isChunkMissingComplete
                    ? "text-emerald-200 border-emerald-300/20"
                    : "text-amber-200 border-amber-300/20"
                }`}
              >
                {t("scanner.chunkMissingSummary", {
                  missing: chunkMissingTotal,
                })}
              </button>
            ) : null}
            {chunkDetailsPanel ? (
              <div
                data-testid="scanner-chunk-details-anchor"
                className="absolute left-0 top-full z-30 mt-1"
              >
                {chunkDetailsPanel}
              </div>
            ) : null}
          </div>

          <div
            data-testid="scanner-top-controls"
            className="flex shrink-0 self-start items-start gap-2 sm:gap-3"
          >
            <div className="relative" ref={cameraSelectorRef}>
              <button
                ref={cameraButtonRef}
                onClick={() => setShowCameraSelector(!showCameraSelector)}
                className="airqr-action-button flex size-10 items-center justify-center rounded-full backdrop-blur-md transition-colors"
                title={t("scanner.selectCamera")}
              >
                <Icon name="videocam" className="text-[20px]" />
              </button>

              {showCameraSelector && availableCameras.length > 0 ? (
                <div
                  style={cameraDropdownStyle ?? undefined}
                  className="airqr-card animate-fade-in overflow-hidden rounded-[20px] shadow-2xl"
                >
                  <div className="border-b border-[var(--airqr-divider)] p-2">
                    <span className="px-2 text-xs text-[var(--airqr-text-muted)]">
                      {t("scanner.selectCamera")}
                    </span>
                  </div>
                  <div className="overflow-y-auto max-h-full">
                    {availableCameras.map((camera, index) => (
                      <button
                        key={camera.deviceId}
                        onClick={() => handleSelectCamera(camera.deviceId)}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--airqr-action-hover)] ${
                          selectedCameraId === camera.deviceId ? "bg-[var(--airqr-accent-soft)]" : ""
                        }`}
                      >
                        <Icon
                          name={
                            camera.label?.toLowerCase().includes("front") ||
                            camera.label?.toLowerCase().includes("avant")
                              ? "photo_camera_front"
                              : "photo_camera_back"
                          }
                          className="text-[18px] text-[var(--airqr-text-primary)]"
                        />
                        <span className="flex-1 truncate text-sm text-[var(--airqr-text-primary)]">
                          {getCameraDisplayName(camera, index)}
                        </span>
                        {selectedCameraId === camera.deviceId ? (
                          <Icon name="check" className="text-[18px] text-[var(--airqr-accent-text)]" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <button
              onClick={toggleTorch}
              className={`flex size-10 items-center justify-center rounded-full backdrop-blur-md transition-colors ${
                scannerTorchEnabled
                  ? "bg-[var(--airqr-warning)] text-[var(--airqr-primary-button-text)] hover:brightness-95"
                  : "airqr-action-button"
              }`}
              title={scannerTorchEnabled ? t("scanner.torchOff") : t("scanner.torchOn")}
            >
              <Icon
                name={scannerTorchEnabled ? "flashlight_on" : "flashlight_off"}
                className="text-[20px]"
              />
            </button>

            <button
              onClick={onReset}
              className="airqr-action-button airqr-action-button-danger flex size-10 items-center justify-center rounded-full backdrop-blur-md transition-colors"
              title={t("scanner.resetScanner")}
            >
              <Icon name="restart_alt" className="text-[20px]" />
            </button>

            <button
              onClick={() => setShowHelp(true)}
              className="airqr-action-button flex size-10 items-center justify-center rounded-full backdrop-blur-md transition-colors"
              title={t("scanner.help")}
            >
              <Icon name="help" className="text-[24px]" />
            </button>
          </div>
        </div>

        <div className="flex-1" />

        <div
          data-testid="scanner-bottom-overlay"
          className="pb-[calc(env(safe-area-inset-bottom,0px)+7rem)] pt-4 px-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col items-center justify-center gap-4"
        >
          <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-black/60 backdrop-blur-md shadow-xl px-4 py-3">
            <div className="grid grid-cols-3 gap-2 text-xs font-mono font-bold text-white/90">
              <div className="flex flex-col items-center rounded-[18px] bg-white/5 px-2 py-2">
                <span className="flex flex-col items-center text-white/45">
                  <span className="text-[10px] uppercase">{t("scanner.scanned")}</span>
                  {hasSessionProgress ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.session")}
                    </span>
                  ) : showSharedSyncPending ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.local")}
                    </span>
                  ) : showScopedStatHints ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.session")}
                    </span>
                  ) : null}
                </span>
                <span data-testid="scanner-stat-scanned" className="text-blue-400 text-sm">
                  {scannedValue}
                </span>
              </div>
              <div className="flex flex-col items-center rounded-[18px] bg-white/5 px-2 py-2">
                <span className="flex flex-col items-center text-white/45">
                  <span className="text-[10px] uppercase">{t("scanner.min")}</span>
                  {hasSessionProgress ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.session")}
                    </span>
                  ) : showSharedSyncPending ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.local")}
                    </span>
                  ) : showScopedStatHints ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.chunk")}
                    </span>
                  ) : null}
                </span>
                <span data-testid="scanner-stat-min" className="text-yellow-400 text-sm">
                  {minValue}
                </span>
              </div>
              <div className="flex flex-col items-center rounded-[18px] bg-white/5 px-2 py-2">
                <span className="flex flex-col items-center text-white/45">
                  <span className="text-[10px] uppercase">{t("scanner.max")}</span>
                  {hasSessionProgress ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.session")}
                    </span>
                  ) : showSharedSyncPending ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.local")}
                    </span>
                  ) : showScopedStatHints ? (
                    <span className="text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {t("scanner.session")}
                    </span>
                  ) : null}
                </span>
                <span data-testid="scanner-stat-max" className="text-emerald-400 text-sm">
                  {maxValue}
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {sessionStateLabels.length > 0 ? (
                <div
                  data-testid="scanner-session-state-summary"
                  className="flex flex-wrap items-center gap-1.5 rounded-xl border border-lime-300/20 bg-lime-500/10 px-3 py-2 text-[11px] font-mono text-lime-100"
                >
                  {sessionStateLabels.map((label) => (
                    <span
                      key={label}
                      className="min-w-0 rounded-full bg-black/25 px-2 py-0.5 break-words"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}

              {showBottomChunkSummary && hasChunkSummary ? (
                <div
                  data-testid="scanner-chunk-summary"
                  className="rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-[11px] font-mono text-amber-50"
                >
                  <div
                    className={`flex items-center gap-2 ${
                      shouldShowSessionMissingToggle ? "justify-end" : "justify-between"
                    }`}
                  >
                    {shouldShowSessionMissingToggle ? null : (
                      <div
                        data-testid="scanner-chunk-missing-summary"
                        className="min-w-0 rounded-full bg-black/25 px-2 py-0.5 text-amber-50"
                      >
                        {t("scanner.chunkMissingSummary", {
                          missing: chunkMissingTotal,
                        })}
                      </div>
                    )}

                    {canShowChunkDetails ? (
                      <button
                        type="button"
                        aria-controls="scanner-chunk-details"
                        aria-expanded={showChunkDetails}
                        onClick={() => setShowChunkDetails((current) => !current)}
                        className="shrink-0 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/80 transition-colors hover:bg-white/15"
                      >
                        {showChunkDetails
                          ? t("scanner.hideChunkDetails")
                          : t("scanner.chunkDetails")}
                      </button>
                    ) : null}
                  </div>

                  {showChunkDetails && canShowChunkDetails && selectedChunk ? (
                    <div
                      id="scanner-chunk-details"
                      data-testid="scanner-chunk-details"
                      className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/25 p-2 text-[10px] text-white/75"
                    >
                      {canonicalChunks.length > 1 ? (
                        <div className="mb-2 min-w-0">
                          <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-white/45">
                            {t("scanner.chunkSelectorLabel")}
                          </div>
                          <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
                            {canonicalChunks.map((chunk) => {
                              const chunkMissing = getChunkMissingCount(chunk);
                              const isSelected =
                                chunk.chunkId === selectedChunk.chunkId;
                              return (
                                <button
                                  key={chunk.chunkId}
                                  type="button"
                                  onClick={() => {
                                    setSelectedChunkId(chunk.chunkId);
                                    setShowCandidateFrames(false);
                                    setShowUnseenFrames(false);
                                  }}
                                  className={`shrink-0 rounded-lg border px-2 py-1 text-left transition-colors ${getCompactChunkStatusClassName(
                                    chunk
                                  )} ${
                                    isSelected
                                      ? "ring-1 ring-white/30"
                                      : "opacity-75 hover:opacity-100"
                                  }`}
                                >
                                  <span className="block">
                                    {t("scanner.chunk")} {chunk.chunkId + 1}
                                  </span>
                                  <span className="block text-[9px] text-white/45">
                                    {t("scanner.chunkMissingSummary", {
                                      missing: chunkMissing,
                                    })}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="min-w-0 rounded-[18px] bg-white/[0.04] px-2 py-1.5">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-white/85">
                            {t("scanner.chunk")} {selectedChunk.chunkId + 1}
                          </span>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 ${getChunkStatusClassNameForChunk(
                              selectedChunk
                            )}`}
                          >
                            {getChunkStatusLabelForChunk(selectedChunk, t)}
                          </span>
                        </div>

                        {selectedChunk.decodeThreshold !== null &&
                        selectedChunk.decodeThreshold > 0 ? (
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-cyan-100">
                            <span className="rounded bg-black/35 px-1.5 py-0.5">
                              {t("scanner.chunkDecodeProgress", {
                                received: selectedChunk.receivedUnique,
                                threshold: selectedChunk.decodeThreshold ?? 0,
                              })}
                            </span>
                            {selectedChunkMissing > 0 ? (
                              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-100">
                                {t("scanner.chunkThresholdMissing", {
                                  missing: selectedChunkMissing,
                                })}
                              </span>
                            ) : null}
                          </div>
                        ) : selectedChunkMissing > 0 ? (
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-amber-100">
                            <span className="shrink-0">
                              {t("scanner.chunkMissingPackets", {
                                count: selectedChunkMissing,
                              })}
                            </span>
                          </div>
                        ) : null}

                        <div className="mt-1 grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            aria-expanded={showCandidateFrames}
                            onClick={() =>
                              setShowCandidateFrames((current) => !current)
                            }
                            className={`rounded-lg border px-2 py-1 text-left transition-colors ${
                              selectedChunkCandidatesComplete
                                ? "border-emerald-300/15 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
                                : "border-amber-300/15 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15"
                            }`}
                          >
                            <span className="block text-white/75">
                              {t("scanner.chunkCandidates")}
                            </span>
                            <span
                              className={`block ${
                                selectedChunkCandidatesComplete
                                  ? "text-emerald-50"
                                  : "text-amber-50"
                              }`}
                            >
                              {selectedChunkTargetFrameCount}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-expanded={showUnseenFrames}
                            onClick={() =>
                              setShowUnseenFrames((current) => !current)
                            }
                            className="rounded-[14px] border border-white/10 bg-white/[0.04] px-2 py-1 text-left text-white/70 transition-colors hover:bg-white/[0.08]"
                          >
                            <span className="block text-white/55">
                              {t("scanner.chunkUnseen")}
                            </span>
                            <span className="block text-white/85">
                              {selectedChunkUnseenFrameCount}
                            </span>
                          </button>
                        </div>

                        {showCandidateFrames &&
                        selectedChunkTargetFrameCount > 0 ? (
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-lime-100">
                            <span className="shrink-0 text-lime-100/80">
                              {t("scanner.chunkTargetFrameRanges")}
                            </span>
                            <span className="shrink-0 rounded bg-lime-500/15 px-1.5 py-0.5 text-lime-50">
                              {t("scanner.chunkTargetFrameCount", {
                                count: selectedChunkTargetFrameCount,
                              })}
                            </span>
                            {selectedChunkUnseenFrameCount >
                            selectedChunkTargetFrameCount ? (
                              <span className="shrink-0 rounded bg-black/35 px-1.5 py-0.5 text-lime-100/70">
                                {t("scanner.chunkUnseenFramePool", {
                                  count: selectedChunkUnseenFrameCount,
                                })}
                              </span>
                            ) : null}
                            {displayedTargetRanges.map((range) => (
                              <span
                                key={`${selectedChunk.chunkId}-target-${range[0]}-${range[1]}`}
                                className="max-w-full break-all rounded bg-black/35 px-1.5 py-0.5 text-lime-50"
                              >
                                {formatFrameTargetRange(range)}
                              </span>
                            ))}
                            {hiddenTargetRangeCount > 0 ? (
                              <span className="rounded bg-black/35 px-1.5 py-0.5 text-lime-100/60">
                                +{hiddenTargetRangeCount}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {showUnseenFrames &&
                        selectedChunkUnseenFrameCount > 0 ? (
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-white/65">
                            <span className="shrink-0 text-white/55">
                              {t("scanner.chunkUnseenFrameRanges")}
                            </span>
                            <span className="shrink-0 rounded bg-black/35 px-1.5 py-0.5 text-white/70">
                              {t("scanner.chunkUnseenFrameCount", {
                                count: selectedChunkUnseenFrameCount,
                              })}
                            </span>
                            {displayedUnseenRanges.map((range) => (
                              <span
                                key={`${selectedChunk.chunkId}-unseen-${range[0]}-${range[1]}`}
                                className="max-w-full break-all rounded bg-black/35 px-1.5 py-0.5 text-white/75"
                              >
                                {formatFrameTargetRange(range)}
                              </span>
                            ))}
                            {hiddenUnseenRangeCount > 0 ? (
                              <span className="rounded bg-black/35 px-1.5 py-0.5 text-white/50">
                                +{hiddenUnseenRangeCount}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {diagnosticsEnabled && selectedFrameGapCount > 0 ? (
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-white/45">
                            <span className="shrink-0">
                              {t("scanner.chunkUnseenFrameRanges")}
                            </span>
                            <span className="shrink-0 rounded bg-black/35 px-1.5 py-0.5">
                              {t("scanner.chunkUnseenFrameCount", {
                                count: selectedFrameGapCount,
                              })}
                            </span>
                            {displayedMissingRanges.map((range) => (
                              <span
                                key={`${selectedChunk.chunkId}-missing-${range[0]}-${range[1]}`}
                                className="max-w-full break-all rounded bg-black/35 px-1.5 py-0.5"
                              >
                                {formatMissingRange(range)}
                              </span>
                            ))}
                            {hiddenMissingRangeCount > 0 ? (
                              <span className="rounded bg-black/35 px-1.5 py-0.5">
                                +{hiddenMissingRangeCount}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {diagnosticsEnabled ? (
                <div
                  data-testid="scanner-sync-diagnostics"
                  className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-[10px] font-mono text-cyan-100"
                >
                  {diagnosticLines.length > 0 ? (
                    diagnosticLines.map((line) => (
                      <div key={line} className="truncate">
                        {line}
                      </div>
                    ))
                  ) : (
                    <div>DIAG pending...</div>
                  )}
                </div>
              ) : null}

              {showSharedSyncPending ? (
                <div
                  data-testid="scanner-sync-pending"
                  className="rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-[11px] font-mono text-amber-100"
                >
                  {t("scanner.sharedSyncPending")}
                </div>
              ) : null}

              {hasSessionProgress ? (
                <div
                  data-testid="scanner-local-progress-summary"
                  className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-[11px] font-mono text-white/70"
                >
                  <span className="truncate pr-2 text-[var(--airqr-text-primary)]">{localDeviceName}</span>
                  <span>{scanStats.chunkReceived ?? 0}</span>
                  <span className="text-white/40">•</span>
                  <span>{t("scanner.chunk")}</span>
                  <span>
                    {activeChunk ? `${activeChunk.current}/${activeChunk.total}` : "-/-"}
                  </span>
                </div>
              ) : null}

              {progress > 0 ? (
                <div className="airqr-progress-track h-2 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      progress >= 100 ? "bg-[var(--airqr-success)]" : "airqr-progress-fill"
                    }`}
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              ) : null}

              <div
                data-testid="scanner-status-badge"
                className={`rounded-xl border px-4 py-2 text-center shadow-sm transition-colors duration-300 ${
                  progress >= 100
                    ? "airqr-status-success"
                    : "border-[var(--airqr-control-border)] bg-[var(--airqr-control-surface)] text-[var(--airqr-text-primary)]"
                }`}
              >
                <p className="text-xs font-medium tracking-wide">{status}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ScannerHelpModal
        closeLabel={t("common.close")}
        helpTips={helpTips}
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        title={t("scanner.helpTitle")}
      />
    </>
  );
};

export default ScannerChrome;
