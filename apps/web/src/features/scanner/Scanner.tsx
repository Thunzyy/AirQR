import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  decode_streaming_packet,
  decode_normal_packet,
} from "../../wasm/airqrCoreTyped";
import ScanResult from "./ScanResult";
import { downloadScannerResult } from "./downloadScannerResult";
import type { HistoryItem, ResumeAuthority } from "../../types";
import { useScannerCamera } from "../../hooks/useScannerCamera";
import { useScannerCameraMenu } from "../../hooks/useScannerCameraMenu";
import { useServerAuthState } from "../../hooks/useServerAuthState";
import {
  useHistoryStore,
  useScannerStore,
  useSettingsStore,
  useToastStore,
} from "../../store";
import { isWireString, type WireValue } from "../../parse/wire";
import { createLogger } from "../../utils/logger";
import { normalizeScanFilename } from "../../utils/format";
import { getDeviceInfo } from "../../utils/deviceId";
import { useScannerChunkProgress } from "../../hooks/useScannerChunkProgress";
import { useScannerCompletion } from "../../hooks/useScannerCompletion";
import { useScannerDecoderBootstrap } from "../../hooks/useScannerDecoderBootstrap";
import { useScannerFrameLoop } from "../../hooks/useScannerFrameLoop";
import { useScannerLocalProgress } from "../../hooks/useScannerLocalProgress";
import { useMultiScanDiagnostics } from "../../hooks/useMultiScanDiagnostics";
import { useScannerSessionState } from "../../hooks/useScannerSessionState";
import { useScreenWakeLock } from "../../hooks/useScreenWakeLock";
import {
  useScannerSyncProgress,
  type SessionProgressInfo,
} from "../../hooks/useScannerSyncProgress";
import { extractScanPacketTransportIdentity } from "../../utils/scanProgress";
import {
  getBinaryDataSize,
  type BinaryData,
} from "../../utils/binaryData";
import { copyTextToClipboard } from "../../utils/linksite";
import {
  createHistoryItem,
  getVersionedHistoryTitle,
} from "../../utils/history";
import {
  decodeNoteContent,
  isNoteFilename,
} from "../../utils/noteDetection";
import {
  isChunkCompletedDecodeResult,
  isCompletedDecodeResult,
  normalizeDecodeResult,
} from "./scanDecoderResult";
import type { BarcodeDetectorLike } from "./barcodeDetector";
import ScannerChrome from "./ScannerChrome";
const logger = createLogger('scanner:decoder');
const SERVER_RESUME_PACKET_QUEUE_LIMIT = 32;

interface ScannerProps {
  onClose?: () => void;
  onScanComplete?: (item: HistoryItem) => void;
  onScanProgress?: (stats: {
    sessionId: string;
    filename: string;
    received: number;
    total: number;
    totalIsEstimate?: boolean;
    progressPercent?: number;
    deviceName?: string;
    source?: 'local' | 'server';
    packetStartIndex?: number;
    packetDelta?: Uint8Array[];
    chunksCompleted?: number;
    totalChunks?: number;
    chunksSaved?: number;
  }) => void;
  resumeMode?: boolean;
  resumeAuthority?: ResumeAuthority;
  storedPackets?: Uint8Array[]; // Packets from previous session to restore
  resumeSessionId?: string; // Session ID from another device to continue
  resumeStats?: {
    received: number;
    total: number;
    filename?: string;
  }; // Stats from incomplete scan to pre-populate
  autoContinue?: boolean; // Auto-reset after decode (for benchmark mode)
}

interface ActiveChunkInfo {
  current: number;
  total: number;
}

type ScannerResultData =
  {
    kind: 'file' | 'note';
    filename: string;
    data: BinaryData;
    duration: number;
    mimeType?: string;
    internalFilename?: string;
    noteContent?: string;
    sessionId?: string;
  };

function extractSessionIdFromPacket(data: Uint8Array): string | undefined {
  // Streaming packet: byte[0] == 1 or 2, sessionId is uint32 at offset 1 (big-endian).
  // We only need 5 bytes to read this metadata (version + uint32 sessionId).
  if (data.length < 5 || (data[0] !== 1 && data[0] !== 2)) return undefined;
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const sessionId = view.getUint32(1, false);
    if (!Number.isFinite(sessionId) || sessionId <= 0) return undefined;
    return String(sessionId);
  } catch {
    return undefined;
  }
}

function getRawPacketQueueKey(data: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${data.length}:${hash >>> 0}`;
}

function isMissingLocalDecodeContextError(error: Error | string): boolean {
  const message =
    error instanceof Error
      ? error.message
      : error;
  const normalized = message.toLowerCase();
  return [
    /^internal decoder state missing for chunk\s+\S+$/,
    /^missing chunk\s+\S+$/,
    /\bmissing\s+(?:local\s+)?(?:decode\s+)?(?:context|dependency)\b/,
    /\bmissing\s+(?:chunk|session)\s+(?:context|dependency)\b/,
    /\b(?:chunk|session)\s+(?:context|dependency)\s+(?:missing|unavailable|required)\b/,
    /\b(?:decode\s+)?(?:context|dependency)\s+(?:missing|unavailable|not found|required)\b/,
    /\bout of order\b.*\b(?:chunk|packet|stream|session)\b/,
    /\b(?:chunk|packet|stream|session)\b.*\bout of order\b/,
    /\brequires?\s+(?:a\s+)?(?:previous|prior|earlier|existing)\s+(?:chunk|packet|session|decode context|context)\b/,
  ].some((pattern) => pattern.test(normalized));
}

const Scanner: React.FC<ScannerProps> = ({
  onClose,
  onScanComplete,
  onScanProgress,
  resumeMode = false,
  resumeAuthority,
  storedPackets = [],
  resumeSessionId,
  resumeStats,
  autoContinue = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const { config: scannerConfig, toggleTorch } = useScannerStore();
  const { uploadConfig, defaultCameraId: settingsDefaultCameraId } = useSettingsStore();
  const { clearResumeScan, items: historyItems, removeIncompleteScan } = useHistoryStore();
  const showToast = useToastStore((state) => state.show);
  const { authReady: serverAuthReady } = useServerAuthState(uploadConfig);
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>(t('scanner.initCamera'));
  const [activeChunk, setActiveChunk] = useState<ActiveChunkInfo | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    resumeSessionId || null
  );
  const [sessionProgress, setSessionProgress] = useState<SessionProgressInfo | null>(null);
  const [queuedServerResumeRetryVersion, setQueuedServerResumeRetryVersion] = useState(0);
  const [progress, setProgress] = useState<number>(() => {
    if (resumeAuthority !== 'server' && resumeStats && resumeStats.total > 0) {
      return Math.min(100, Math.max(0, (resumeStats.received / resumeStats.total) * 100));
    }
    return 0;
  });
  // Initialize scanStats with resumeStats if resuming, otherwise default to zeros
  const [scanStats, setScanStats] = useState<{
    received: number;
    min: number;
    total?: number;
    chunkTotal?: number;
    chunkReceived?: number;
  }>(() => {
    if (resumeAuthority !== 'server' && resumeStats) {
      return {
        received: resumeStats.received,
        min: resumeStats.total,
      };
    }
    return { received: 0, min: 0 };
  });
  const scanStatsRef = useRef(scanStats);
  const chunkExactTotalsRef = useRef<Map<number, number>>(new Map());
  // FPS tracking
  const [fps, setFps] = useState<number>(0);
  const fpsFrameCountRef = useRef<number>(0);
  const fpsLastTimeRef = useRef<number>(performance.now());
  const [isScanning, setIsScanning] = useState(true);
  useScreenWakeLock(isScanning);
  const [resultData, setResultData] = useState<ScannerResultData | null>(null);
  const resultDataRef = useRef<typeof resultData>(null);
  resultDataRef.current = resultData;
  const requestRef = useRef<number>(0);
  const [decoderInitialized, setDecoderInitialized] = useState(false);
  const startTimeRef = useRef<number>(0);
  const chunksSavedRef = useRef<number>(0);
  const packetIndexRef = useRef<number>(0);
  const lastScanAtRef = useRef<number>(0);
  const uploadConfigRef = useRef(uploadConfig);
  // Initialize sessionIdRef with resumeSessionId if resuming from another device
  const localDeviceInfoRef = useRef(getDeviceInfo());
  const sessionIdRef = useRef<string | null>(resumeSessionId || null);
  const localDeviceNameRef = useRef<string>(localDeviceInfoRef.current.deviceName);
  const filenameRef = useRef<string | null>(null);
  const serverProgressSeenRef = useRef<boolean>(false);
  const serverSnapshotInFlightRef = useRef<boolean>(false);
  const ignoredSessionAfterResetRef = useRef<string | null>(null);
  const suppressResetSessionRealtimeRef = useRef<boolean>(false);
  const queuedServerResumePacketsRef = useRef<Map<string, Uint8Array>>(new Map());
  const retryingQueuedServerResumePacketRef = useRef<boolean>(false);
  const [syncSourceName, setSyncSourceName] = useState<string | null>(
    localDeviceNameRef.current
  );
  const remoteCompleteHandledRef = useRef<string | null>(null);

  const getScanDurationSeconds = useCallback(() => {
    const startedAt = startTimeRef.current;
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      return 0;
    }
    return Math.max(0, (Date.now() - startedAt) / 1000);
  }, []);

  const onScanProgressRef = useRef(onScanProgress);

  const updateActiveChunk = useCallback((chunkIdRaw: WireValue | undefined, totalChunksRaw: WireValue | undefined) => {
    const chunkId = Number(chunkIdRaw);
    const totalChunks = Number(totalChunksRaw);

    if (
      !Number.isFinite(chunkId) ||
      chunkId < 0 ||
      !Number.isFinite(totalChunks) ||
      totalChunks <= 0
    ) {
      setActiveChunk(null);
      return;
    }

    setActiveChunk({
      current: Math.trunc(chunkId) + 1,
      total: Math.trunc(totalChunks),
    });
  }, []);

  useEffect(() => {
    if (resumeSessionId) {
      sessionIdRef.current = resumeSessionId;
      setActiveSessionId(resumeSessionId);
      return;
    }
    setActiveSessionId(null);
  }, [resumeSessionId]);

  useEffect(() => {
    onScanProgressRef.current = onScanProgress;
  }, [onScanProgress]);

  useEffect(() => {
    scanStatsRef.current = scanStats;
  }, [scanStats]);

  const {
    availableCameras,
    getCameraDisplayName,
    hasCamera,
    selectCamera,
    selectedCameraId,
  } = useScannerCamera({
    resultData,
    scannerConfig,
    settingsDefaultCameraId,
    setStatus,
    t,
    videoRef,
  });

  const {
    cameraButtonRef,
    cameraDropdownStyle,
    cameraSelectorRef,
    handleSelectCamera,
    setShowCameraSelector,
    showCameraSelector,
  } = useScannerCameraMenu({
    selectCamera,
  });

  const { diagnosticsEnabled, diagnosticsSnapshot } = useMultiScanDiagnostics({
    activeChunk,
    activeSessionId,
    localDeviceName: localDeviceNameRef.current,
    progress,
    scanStats,
    scannerDebugEnabled: scannerConfig.showDebugInfo,
    sessionProgress,
    status,
    syncSourceName,
    uploadConfig,
  });

  useScannerSyncProgress({
    activeSessionId,
    uploadConfig,
    serverAuthReady,
    resumeAuthority,
    resumeSessionId,
    onScanComplete,
    onScanProgressRef,
    t,
    getScanDurationSeconds,
    localDeviceName: localDeviceNameRef.current,
    chunksSavedRef,
    filenameRef,
    ignoredSessionAfterResetRef,
    remoteCompleteHandledRef,
    resultDataRef,
    serverProgressSeenRef,
    serverSnapshotInFlightRef,
    sessionIdRef,
    suppressResetSessionRealtimeRef,
    setIsScanning,
    setProgress,
    setResultData,
    setSessionProgress,
    setStatus,
    setSyncSourceName,
  });

  const {
    cleanupCompletedSession,
    finalizeCompletedScan,
    persistChunkAndMaybeAssemble,
  } =
    useScannerCompletion({
      getScanDurationSeconds,
      onScanComplete,
      packetIndexRef,
      remoteCompleteHandledRef,
      resumeAuthority,
      setIsScanning,
      setResultData,
    });

  const { applyChunkCompletedProgress, emitPersistedChunkProgress } =
    useScannerChunkProgress({
      chunkExactTotalsRef,
      chunksSavedRef,
      localDeviceName: localDeviceNameRef.current,
      onScanProgressRef,
      resumeAuthority,
      serverProgressSeenRef,
      setProgress,
      setScanStats,
      setStatus,
      t,
      updateActiveChunk,
    });

  const { applyProgressResult, queuePacketForSync } = useScannerLocalProgress({
    chunkExactTotalsRef,
    chunksSavedRef,
    localDeviceName: localDeviceNameRef.current,
    onScanProgressRef,
    resumeAuthority,
    resumeMode,
    scanStatsRef,
    serverProgressSeenRef,
    setProgress,
    setScanStats,
    setStatus,
    setSyncSourceName,
    t,
    updateActiveChunk,
    uploadConfigRef,
  });

  // Worker for QR detection to keep UI thread free (fallback for iOS)
  const scanWorkerRef = useRef<Worker | null>(null);
  const isProcessingFrame = useRef<boolean>(false);
  const resetGenerationRef = useRef<number>(0);
  const scanRequestIdRef = useRef<number>(0);

  // Native BarcodeDetector only exposes text-oriented results.
  // AirQR relies on raw binary QR payloads, so keep it disabled until browsers
  // expose a byte-safe API for QR scanning.
  const barcodeDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const [useNativeDetector, setUseNativeDetector] = useState(false);

  useEffect(() => {
    uploadConfigRef.current = uploadConfig;
  }, [uploadConfig]);

  const clearChunkExactTotals = useCallback(() => {
    chunkExactTotalsRef.current.clear();
  }, []);

  const { getOrCreateSessionId, resetScanner } = useScannerSessionState({
      autoContinue,
      clearChunkExactTotals,
      chunksSavedRef,
      filenameRef,
      fpsFrameCountRef,
      fpsLastTimeRef,
      ignoredSessionAfterResetRef,
      isProcessingFrameRef: isProcessingFrame,
      lastScanAtRef,
      localDeviceName: localDeviceNameRef.current,
      onScanProgress,
      packetIndexRef,
      remoteCompleteHandledRef,
      resumeMode,
      resumeSessionId,
      resumeStats,
      resetGenerationRef,
      scanRequestIdRef,
      resultData,
      serverProgressSeenRef,
      sessionIdRef,
      setActiveSessionId,
      setActiveChunk,
      setFps,
      setIsScanning,
      setProgress,
      setResultData,
      setScanStats,
      setSessionProgress,
      setStatus,
      setSyncSourceName,
      startTimeRef,
      suppressResetSessionRealtimeRef,
      t,
    });

  const queueServerResumePacketForRetry = useCallback((binaryData: Uint8Array) => {
    const queue = queuedServerResumePacketsRef.current;
    const key = getRawPacketQueueKey(binaryData);
    if (queue.has(key)) {
      return;
    }

    while (queue.size >= SERVER_RESUME_PACKET_QUEUE_LIMIT) {
      const oldestKey = queue.keys().next().value;
      if (!isWireString(oldestKey)) break;
      queue.delete(oldestKey);
    }

    queue.set(key, Uint8Array.from(binaryData));
    setActiveChunk(null);
  }, []);

  const scheduleQueuedServerResumePacketRetry = useCallback(() => {
    if (
      resumeAuthority !== 'server' ||
      retryingQueuedServerResumePacketRef.current ||
      queuedServerResumePacketsRef.current.size === 0
    ) {
      return;
    }

    setQueuedServerResumeRetryVersion((version) => version + 1);
  }, [resumeAuthority]);

  const handleDecodedData = useCallback((binaryData: Uint8Array) => {
    if (resultDataRef.current) return;
    if (
      sessionIdRef.current &&
      remoteCompleteHandledRef.current === sessionIdRef.current
    ) {
      return;
    }

    const isStreaming =
      binaryData.length >= 31 && (binaryData[0] === 1 || binaryData[0] === 2);
    const packetSessionId = isStreaming
      ? extractSessionIdFromPacket(binaryData)
      : undefined;
    if (
      packetSessionId &&
      suppressResetSessionRealtimeRef.current &&
      ignoredSessionAfterResetRef.current === packetSessionId
    ) {
      return;
    }

    // Store this packet for potential resume
    const packetStartIndex = packetIndexRef.current;
    packetIndexRef.current += 1;
    const packetDelta = [binaryData];
    const transportIdentity = extractScanPacketTransportIdentity(binaryData);
    const queueServerAuthoritativePacketForSync = (
      resolvedSessionId?: string,
      resultType = 'server_authoritative_decode_error'
    ) => {
      if (
        resumeAuthority !== 'server' ||
        !isStreaming ||
        transportIdentity.packetIndex === undefined ||
        transportIdentity.chunkId === undefined
      ) {
        return false;
      }

      const fallbackSessionId =
        resolvedSessionId ?? packetSessionId ?? sessionIdRef.current ?? resumeSessionId;
      if (!fallbackSessionId) {
        return false;
      }

      queuePacketForSync({
        binaryData,
        chunkId: transportIdentity.chunkId,
        expectedPackets: undefined,
        filename: filenameRef.current ?? resumeStats?.filename,
        isStreaming,
        packetStartIndex,
        receivedPackets: undefined,
        resolvedSessionId: fallbackSessionId,
        resultType,
        totalChunks: undefined,
        totalExact: false,
        totalPackets: undefined,
        transportIdentity,
      });
      return true;
    };

    try {
      let result;

      if (isStreaming) {
        result = normalizeDecodeResult(decode_streaming_packet(binaryData));
        logger.debug("Streaming decoder result", { type: result.type });
      } else {
        result = normalizeDecodeResult(decode_normal_packet(binaryData));
        logger.debug("Normal decoder result", { type: result.type });
      }

      const resultSessionId =
        result.sessionId ??
        packetSessionId ??
        extractSessionIdFromPacket(binaryData);
      if (
        resultSessionId &&
        suppressResetSessionRealtimeRef.current &&
        ignoredSessionAfterResetRef.current === resultSessionId
      ) {
        return;
      }
      const resolvedSessionId = getOrCreateSessionId(resultSessionId);
      if (result.type !== "error") {
        if (
          !resultSessionId ||
          ignoredSessionAfterResetRef.current !== resultSessionId
        ) {
          ignoredSessionAfterResetRef.current = null;
          suppressResetSessionRealtimeRef.current = false;
        }
      }
      const normalizedFilename = normalizeScanFilename(result.filename);
      if (normalizedFilename) {
        filenameRef.current = normalizedFilename;
      }

      const receivedPackets = result.receivedPackets;
      const expectedPackets = result.expectedPackets;
      const totalPackets = result.totalPackets;
      const totalExact = result.totalPacketsExact;

      if (result.type !== "error" && startTimeRef.current <= 0) {
        startTimeRef.current = Date.now();
      }

      if (result.type !== "error") {
        const packetFilename = normalizedFilename || filenameRef.current || undefined;
        queuePacketForSync({
          binaryData,
          chunkId: result.chunkId,
          chunksCompleted: result.chunksCompleted,
          expectedPackets,
          filename: packetFilename,
          isStreaming,
          packetStartIndex,
          receivedPackets,
          resolvedSessionId,
          resultType: result.type,
          totalChunks: result.totalChunks,
          totalExact,
          totalPackets,
          transportIdentity,
        });
      } else {
        queueServerAuthoritativePacketForSync(resolvedSessionId);
      }

      if (result.type === "progress") {
        applyProgressResult({
          expectedPackets,
          packetDelta,
          packetStartIndex,
          receivedPackets,
          resolvedSessionId,
          result,
          totalPackets,
        });
      } else if (isChunkCompletedDecodeResult(result)) {
        const chunkId = result.chunkId;
        const totalChunks = result.totalChunks;
        const chunkData = result.chunkData;
        const sessionId = resolvedSessionId;
        const filename = result.filename;

        logger.info("Chunk completed", {
          chunkId,
          totalChunks,
          chunksCompleted: result.chunksCompleted,
          overallPercent: result.overallPercent,
          dataLen: chunkData ? chunkData.length : 0,
          packetsReceivedTotal: result.packetsReceivedTotal || 0,
        });
        const chunkProgressState = applyChunkCompletedProgress({
          packetDelta,
          packetStartIndex,
          resolvedSessionId: sessionId,
          result: {
            chunkData,
            chunkId,
            chunksCompleted: result.chunksCompleted,
            filename,
            overallPercent: result.overallPercent,
            packetsExpectedChunk: result.packetsExpectedChunk || 0,
            packetsReceivedChunk: result.packetsReceivedChunk,
            packetsReceivedTotal: result.packetsReceivedTotal || 0,
            packetsTotalChunk: result.totalPackets || 0,
            totalChunks,
          },
        });

        if (chunkData && sessionId) {
          void persistChunkAndMaybeAssemble({
            sessionId,
            chunkId,
            chunkData,
            filename,
            totalChunks,
          }).then(({ chunksSaved }) => {
              if (chunksSaved > 0) {
                chunksSavedRef.current = chunksSaved;

                emitPersistedChunkProgress({
                  chunksCompleted: result.chunksCompleted,
                  chunksSaved: chunksSavedRef.current,
                  filename,
                  progressState: chunkProgressState,
                  resolvedSessionId: sessionId,
                  totalChunks,
                });
              }
            });
        }
      } else if (isCompletedDecodeResult(result)) {
        logger.info("All completed", {
          filename: result.filename,
          dataSize: result.data.length,
          sessionId: result.sessionId,
        });
        if (isNoteFilename(result.filename)) {
          const historyItem = createHistoryItem({
            id: resolvedSessionId || Date.now().toString(),
            origin: 'scanned',
            filename: result.filename,
            fileData: Uint8Array.from(result.data),
            mimeType: 'text/plain',
          });
          historyItem.title = getVersionedHistoryTitle(historyItems, historyItem.title);
          const nextResultData: ScannerResultData = {
            kind: 'note',
            filename: historyItem.title,
            internalFilename: result.filename,
            data: Uint8Array.from(result.data),
            duration: getScanDurationSeconds(),
            noteContent: decodeNoteContent(result.data),
            sessionId: resolvedSessionId,
          };
          if (resolvedSessionId) {
            remoteCompleteHandledRef.current = resolvedSessionId;
          }
          resultDataRef.current = nextResultData;
          setIsScanning(false);
          setResultData(nextResultData);
          onScanComplete?.(historyItem);
          if (resolvedSessionId) {
            cleanupCompletedSession(resolvedSessionId);
            removeIncompleteScan(resolvedSessionId);
            clearResumeScan();
          }
          packetIndexRef.current = 0;
          return;
        }
        logger.warn("If not all chunks were scanned, this is the BUG");
        void finalizeCompletedScan({
          sessionId: resolvedSessionId,
          filename: result.filename,
          data: result.data,
        });
      }

      if (result.type !== "error") {
        scheduleQueuedServerResumePacketRetry();
      }
    } catch (err) {
      if (
        resumeAuthority === 'server' &&
        isStreaming &&
        isMissingLocalDecodeContextError(err instanceof Error ? err : '')
      ) {
        const fallbackSessionId =
          packetSessionId ?? sessionIdRef.current ?? resumeSessionId;
        if (fallbackSessionId) {
          queueServerAuthoritativePacketForSync(
            fallbackSessionId,
            'server_authoritative_decode_pending'
          );
        }
        queueServerResumePacketForRetry(binaryData);
        logger.debug("Queued server-authoritative packet for decode retry", {
          queuedPackets: queuedServerResumePacketsRef.current.size,
          retrying: retryingQueuedServerResumePacketRef.current,
        });
      }
      // Ignore decode errors - some frames may be redundant or not locally applicable yet.
    }
  }, [
    cleanupCompletedSession,
    clearResumeScan,
    finalizeCompletedScan,
    getOrCreateSessionId,
    getScanDurationSeconds,
    historyItems,
    onScanComplete,
    persistChunkAndMaybeAssemble,
    applyChunkCompletedProgress,
    applyProgressResult,
    emitPersistedChunkProgress,
    queueServerResumePacketForRetry,
    queuePacketForSync,
    removeIncompleteScan,
    resumeAuthority,
    resumeSessionId,
    resumeStats?.filename,
    scheduleQueuedServerResumePacketRetry,
  ]);

  useEffect(() => {
    if (resumeAuthority !== 'server') {
      queuedServerResumePacketsRef.current.clear();
      return;
    }
    if (!sessionProgress && queuedServerResumeRetryVersion === 0) {
      return;
    }
    const queuedPackets = Array.from(queuedServerResumePacketsRef.current.entries());
    if (queuedPackets.length === 0) {
      return;
    }

    retryingQueuedServerResumePacketRef.current = true;
    try {
      for (const [key, queuedPacket] of queuedPackets) {
        queuedServerResumePacketsRef.current.delete(key);
        handleDecodedData(queuedPacket);
      }
    } finally {
      retryingQueuedServerResumePacketRef.current = false;
    }
  }, [handleDecodedData, queuedServerResumeRetryVersion, resumeAuthority, sessionProgress]);

  useScannerDecoderBootstrap({
    barcodeDetectorRef,
    handleDecodedData,
    isProcessingFrameRef: isProcessingFrame,
    overlayRef,
    packetIndexRef,
    resumeAuthority,
    resumeMode,
    resumeSessionId,
    scanRequestIdRef,
    scanWorkerRef,
    setDecoderInitialized,
    setStatus,
    setUseNativeDetector,
    storedPackets,
    t,
  });

  const handleDownload = () => {
    if (!resultData) return;
    downloadScannerResult(resultData);
  };

  const handleCopyNote = useCallback(async () => {
    if (!resultData || resultData.kind !== 'note') {
      return;
    }

    try {
      await copyTextToClipboard(resultData.noteContent || '');
      showToast(t('scanner.copiedToClipboard'), 'success');
    } catch (error) {
      logger.error('Failed to copy note to clipboard', { error: error instanceof Error ? error.message : String(error) });
    }
  }, [resultData, showToast, t]);

  useScannerFrameLoop({
    barcodeDetectorRef,
    canvasRef,
    decoderInitialized,
    fpsFrameCountRef,
    fpsLastTimeRef,
    handleDecodedData,
    hasCamera,
    isProcessingFrameRef: isProcessingFrame,
    isScanning,
    lastScanAtRef,
    overlayRef,
    requestRef,
    resetGenerationRef,
    scanRequestIdRef,
    scanWorkerRef,
    scannerConfig,
    setFps,
    useNativeDetector,
    videoRef,
  });

  const handleResultClose = () => {
    resetScanner();
    onClose?.();
  };

  if (resultData) {
    return (
      <ScanResult
        filename={resultData.filename}
        fileSize={getBinaryDataSize(resultData.data)}
        duration={resultData.duration}
        fileData={resultData.kind === 'file' ? resultData.data : undefined}
        mimeType={resultData.kind === 'file' ? resultData.mimeType : undefined}
        isNote={resultData.kind === 'note'}
        noteContent={resultData.kind === 'note' ? resultData.noteContent : undefined}
        onCopyNote={resultData.kind === 'note' ? handleCopyNote : undefined}
        onDownload={handleDownload}
        onScanAgain={resetScanner}
        onClose={handleResultClose}
      />
    );
  }

  return (
    <div className="relative flex flex-col h-full w-full bg-transparent font-display text-white overflow-hidden select-none">
      {/* Camera View */}
      <div className="absolute inset-0 z-0">
        <video
          ref={videoRef}
          className="w-full h-full object-cover bg-black"
          playsInline
          muted
        />
        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Visible overlay for detection graphics */}
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />

        {/* Dark overlay for better contrast */}
        <div className="absolute inset-0 bg-black/20"></div>
      </div>

      <ScannerChrome
        activeChunk={activeChunk}
        availableCameras={availableCameras}
        cameraButtonRef={cameraButtonRef}
        cameraDropdownStyle={cameraDropdownStyle}
        cameraSelectorRef={cameraSelectorRef}
        fps={fps}
        getCameraDisplayName={getCameraDisplayName}
        handleSelectCamera={handleSelectCamera}
        localDeviceName={localDeviceNameRef.current}
        progress={progress}
        scanStats={scanStats}
        scannerTorchEnabled={scannerConfig.enableTorch}
        selectedCameraId={selectedCameraId}
        sharedSessionPending={Boolean(uploadConfig.enabled && uploadConfig.url && activeSessionId && !sessionProgress)}
        sessionProgress={sessionProgress}
        diagnosticsEnabled={diagnosticsEnabled}
        diagnosticsSnapshot={diagnosticsSnapshot}
        setShowCameraSelector={setShowCameraSelector}
        showCameraSelector={showCameraSelector}
        status={status}
        syncSourceName={syncSourceName}
        t={t}
        toggleTorch={toggleTorch}
        onReset={resetScanner}
      />
    </div>
  );
};

export default Scanner;
