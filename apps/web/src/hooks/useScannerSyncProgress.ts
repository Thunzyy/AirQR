import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { BinaryData } from '../utils/binaryData';
import type { HistoryItem, ResumeAuthority, ScanUploadConfig } from '../types';
import type {
  ScanChunkState,
  ScanSessionState,
} from '../types/scanSessionState';
import { createLogger } from '../utils/logger';
import { normalizeScanFilename } from '../utils/format';
import { createHistoryItem } from '../utils/history';
import { decodeNoteContent } from '../utils/noteDetection';
import {
  extractScanPacketTransportIdentity,
  normalizeIncompleteProgress,
} from '../utils/scanProgress';
import {
  mergeScanSessionState,
  normalizeScanSessionState,
} from '../utils/scanSessionState';
import { deleteIncompleteScan } from '../services/historyDB';
import {
  countScanSessionPackets,
  deleteScanSessionChunks,
  deleteScanSessionPackets,
  visitScanSessionPacketPages,
} from '../services/scanSessionDB';
import { queueScanPacket } from '../services/scanUploadService';
import { canOptimisticallyAttemptServerSync } from '../services/serverAuth';
import { fetchServerFile, fetchServerSession } from '../services/scanSyncService';
import { getWebSocketSyncService } from '../services/websocketSyncService';
import {
  asWireObject,
  asWireString,
  isWireObject,
  parseJsonText,
  type WireObject,
  type WireValue,
} from '../parse/wire';

const logger = createLogger('hooks:useScannerSyncProgress');
const STALLED_SERVER_REFRESH_INTERVAL_MS = 4000;

export interface SessionProgressInfo {
  received: number;
  total: number;
  totalLabel: string;
  totalIsEstimate: boolean;
  min: number;
  minLabel: string;
  max: number | null;
  maxLabel: string;
  percent: number;
  decodeState?: ScanSessionState['decodeState'];
  fileAvailable?: boolean;
  chunksTotal?: number | null;
  chunksComplete?: number;
  chunksMissing?: number | null;
  chunks?: ScanChunkState[];
}

interface ScanProgressCallback {
  (stats: {
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
  }): void;
}

interface ResultData {
  kind: 'file' | 'note';
  filename: string;
  data: BinaryData;
  duration: number;
  noteContent?: string;
  sessionId?: string;
}

interface UseScannerSyncProgressArgs {
  activeSessionId: string | null;
  uploadConfig: ScanUploadConfig;
  serverAuthReady: boolean;
  resumeAuthority?: ResumeAuthority;
  resumeSessionId?: string;
  onScanComplete?: (item: HistoryItem) => void;
  onScanProgressRef: MutableRefObject<ScanProgressCallback | undefined>;
  t: (key: string, options?: TranslateOptions) => string;
  getScanDurationSeconds: () => number;
  localDeviceName: string;
  chunksSavedRef: MutableRefObject<number>;
  filenameRef: MutableRefObject<string | null>;
  ignoredSessionAfterResetRef: MutableRefObject<string | null>;
  remoteCompleteHandledRef: MutableRefObject<string | null>;
  resultDataRef: MutableRefObject<ResultData | null>;
  serverProgressSeenRef: MutableRefObject<boolean>;
  serverSnapshotInFlightRef: MutableRefObject<boolean>;
  sessionIdRef: MutableRefObject<string | null>;
  suppressResetSessionRealtimeRef: MutableRefObject<boolean>;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  setProgress: Dispatch<SetStateAction<number>>;
  setResultData: Dispatch<SetStateAction<ResultData | null>>;
  setSessionProgress: Dispatch<SetStateAction<SessionProgressInfo | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setSyncSourceName: Dispatch<SetStateAction<string | null>>;
}

function formatProgressTotalLabel(
  total: number,
  totalIsEstimate: boolean,
  options: { thresholdKnown?: boolean } = {}
): string {
  if (!Number.isFinite(total) || total <= 0) {
    return '?';
  }

  if (options.thresholdKnown) {
    return String(total);
  }

  return totalIsEstimate ? `~${total}` : String(total);
}

const CANONICAL_SCAN_STATE_FIELDS = [
  'receivedUnique',
  'decodeThreshold',
  'decodeState',
  'completionPercent',
  'fileAvailable',
  'chunksTotal',
  'chunksMissing',
  'chunksComplete',
  'chunks',
] as const;

type TranslateOptions = {
  readonly [name: string]: string | number | boolean | undefined;
};

function hasCanonicalScanSessionState(raw: WireValue): boolean {
  if (!isWireObject(raw)) {
    return false;
  }
  if (raw.type === 'scan-session-state' || isWireObject(raw.scanState)) {
    return true;
  }
  if (isWireObject(raw.payload) && raw.payload.type === 'scan-session-state') {
    return true;
  }
  if (isWireObject(raw.state) && raw.state.type === 'scan-session-state') {
    return true;
  }
  return CANONICAL_SCAN_STATE_FIELDS.some((field) => field in raw);
}

function readCanonicalField(raw: WireValue, field: string): WireValue | undefined {
  if (!isWireObject(raw)) {
    return undefined;
  }
  if (field in raw) {
    return raw[field];
  }
  if (isWireObject(raw.payload) && field in raw.payload) {
    return raw.payload[field];
  }
  if (isWireObject(raw.scanState) && field in raw.scanState) {
    return raw.scanState[field];
  }
  if (isWireObject(raw.state) && field in raw.state) {
    return raw.state[field];
  }
  return undefined;
}

function toSessionId(value: WireValue | undefined): string | null {
  const text = asWireString(value);
  if (text !== undefined) {
    return text;
  }
  return value != null ? String(value) : null;
}

export function useScannerSyncProgress({
  activeSessionId,
  uploadConfig,
  serverAuthReady,
  resumeSessionId,
  onScanComplete,
  onScanProgressRef,
  t,
  getScanDurationSeconds,
  localDeviceName,
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
}: UseScannerSyncProgressArgs): void {
  const canAttemptServerSync =
    serverAuthReady || canOptimisticallyAttemptServerSync(uploadConfig);
  const canonicalStateRef = useRef<ScanSessionState | null>(null);
  const liveBackfillInFlightRef = useRef<Set<string>>(new Set());
  const liveBackfillSignatureRef = useRef<Map<string, string>>(new Map());

  const shouldIgnoreResetSession = useCallback(
    (candidateSessionId: string | null) =>
      Boolean(
        suppressResetSessionRealtimeRef.current &&
          candidateSessionId &&
          ignoredSessionAfterResetRef.current === candidateSessionId
      ),
    [ignoredSessionAfterResetRef, suppressResetSessionRealtimeRef]
  );

  const backfillLiveSessionPackets = useCallback(
    (
      sessionId: string,
      remoteReceived: number,
      total: number,
      filename: string,
      exactTotal: number | null,
      totalIsEstimate: boolean
    ) => {
      if (!canAttemptServerSync || remoteReceived <= 0) {
        return;
      }
      if (
        liveBackfillInFlightRef.current.has(sessionId) ||
        remoteCompleteHandledRef.current === sessionId ||
        resultDataRef.current
      ) {
        return;
      }

      liveBackfillInFlightRef.current.add(sessionId);
      void (async () => {
        try {
          const localPacketCount = await countScanSessionPackets(sessionId);
          if (localPacketCount <= remoteReceived) {
            liveBackfillSignatureRef.current.delete(sessionId);
            return;
          }

          const totalPackets =
            exactTotal !== null && exactTotal > 0 ? exactTotal : total;
          const signature = `${remoteReceived}:${localPacketCount}:${total}:${totalPackets}`;
          if (liveBackfillSignatureRef.current.get(sessionId) === signature) {
            return;
          }
          liveBackfillSignatureRef.current.set(sessionId, signature);

          await visitScanSessionPacketPages(sessionId, (page) => {
            page.packets.forEach((packet, offset) => {
              const transportIdentity = extractScanPacketTransportIdentity(packet);
              queueScanPacket(
                packet,
                {
                  sessionId: transportIdentity.sessionId || sessionId,
                  filename,
                  isStreaming: transportIdentity.isStreaming,
                  packetIndex:
                    transportIdentity.packetIndex ?? page.startIndex + offset,
                  chunkId: transportIdentity.chunkId,
                  receivedPackets: localPacketCount,
                  expectedPackets: total,
                  totalPackets,
                  totalPacketsExact: !totalIsEstimate,
                },
                uploadConfig,
                { replay: true }
              );
            });
          });

          logger.info('Replayed persisted live scan packets to server', {
            sessionId,
            localPacketCount,
            remoteReceived,
            total,
            totalPackets,
          });
        } catch (error) {
          liveBackfillSignatureRef.current.delete(sessionId);
          logger.error('Failed to replay persisted live scan packets', {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
            remoteReceived,
          });
        } finally {
          liveBackfillInFlightRef.current.delete(sessionId);
        }
      })();
    },
    [
      canAttemptServerSync,
      remoteCompleteHandledRef,
      resultDataRef,
      uploadConfig,
    ]
  );

  const applyServerProgress = useCallback(
    (
      receivedRaw: WireValue | undefined,
      expectedRaw: WireValue | undefined,
      exactTotalRaw?: WireValue,
      filenameRaw?: WireValue,
      deviceNameRaw?: WireValue,
      totalPacketsExactRaw?: WireValue
    ) => {
      const expectedCount = Number(expectedRaw);
      const totalPacketsExact =
        totalPacketsExactRaw === undefined || totalPacketsExactRaw === null
          ? undefined
          : Boolean(totalPacketsExactRaw);
      const hasDecodeThreshold =
        Number.isFinite(expectedCount) && expectedCount > 0;
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }
      const normalizedProgress = normalizeIncompleteProgress(
        receivedRaw,
        expectedRaw,
        {
          totalIsEstimate: !hasDecodeThreshold || totalPacketsExact === false,
        }
      );
      const received = normalizedProgress.received;
      if (received <= 0) {
        return;
      }

      if (shouldIgnoreResetSession(sessionId)) {
        return;
      }
      if (remoteCompleteHandledRef.current === sessionId || resultDataRef.current) {
        return;
      }

      // Legacy progress is emitted before canonical completion and file
      // availability. Keep it below 100%; canonical state or scan-complete
      // are the only sources allowed to finish the UI.
      const percent = Math.min(normalizedProgress.progressPercent, 99);
      const currentCanonical = canonicalStateRef.current;
      if (
        currentCanonical &&
        currentCanonical.sessionId === sessionId &&
        (received < currentCanonical.receivedUnique ||
          percent < currentCanonical.completionPercent)
      ) {
        return;
      }

      const totalForUi = normalizedProgress.total;
      const displayTotalIsEstimate = normalizedProgress.totalIsEstimate;
      const totalLabel = formatProgressTotalLabel(
        totalForUi,
        displayTotalIsEstimate,
        { thresholdKnown: hasDecodeThreshold }
      );
      const min = hasDecodeThreshold
        ? Math.max(0, Math.trunc(expectedCount))
        : totalForUi;
      const minLabel = formatProgressTotalLabel(min, !hasDecodeThreshold);
      const exactTotal = Number(exactTotalRaw);
      const max =
        Number.isFinite(exactTotal) && exactTotal > 0 && totalPacketsExact !== false
          ? Math.max(Math.trunc(exactTotal), min)
          : null;
      const maxLabel = max !== null ? String(max) : '-';

      if (hasDecodeThreshold && received > Math.trunc(expectedCount)) {
        logger.warn('Server counters exceeded provisional expected packets', {
          sessionId,
          received,
          expected: totalForUi,
        });
      }

      const deviceNameRawText = asWireString(deviceNameRaw);
      const deviceName =
        deviceNameRawText !== undefined && deviceNameRawText.trim().length > 0
          ? deviceNameRawText.trim()
          : null;
      serverProgressSeenRef.current = true;

      const filenameRawText = asWireString(filenameRaw);
      if (filenameRawText !== undefined) {
        const safeFilename = normalizeScanFilename(filenameRawText);
        if (safeFilename) {
          filenameRef.current = safeFilename;
        }
      }

      if (deviceName) {
        setSyncSourceName(deviceName);
      }

      setSessionProgress({
        received,
        total: totalForUi,
        totalLabel,
        totalIsEstimate: displayTotalIsEstimate,
        min,
        minLabel,
        max,
        maxLabel,
        percent,
      });
      setProgress(percent);
      setStatus(
        t('scanner.sessionProgressStatus', {
          percent: percent.toFixed(1),
          received,
          total: totalLabel,
        })
      );

      onScanProgressRef.current?.({
        sessionId,
        filename:
          normalizeScanFilename(filenameRef.current || undefined) ||
          t('common.unknownFile'),
        received,
        total: totalForUi,
        totalIsEstimate: displayTotalIsEstimate,
        progressPercent: percent,
        deviceName: deviceName ?? undefined,
        source: 'server',
        chunksSaved: chunksSavedRef.current,
      });
      backfillLiveSessionPackets(
        sessionId,
        received,
        totalForUi,
        normalizeScanFilename(filenameRef.current || undefined) ||
          t('common.unknownFile'),
        max,
        displayTotalIsEstimate
      );
    },
    [
      backfillLiveSessionPackets,
      chunksSavedRef,
      filenameRef,
      onScanProgressRef,
      remoteCompleteHandledRef,
      resultDataRef,
      serverProgressSeenRef,
      sessionIdRef,
      setProgress,
      setSessionProgress,
      setStatus,
      setSyncSourceName,
      shouldIgnoreResetSession,
      t,
    ]
  );

  const handleRemoteComplete = useCallback(
    (eventSessionId: string, durationRaw?: WireValue, filenameRaw?: WireValue) => {
      if (remoteCompleteHandledRef.current === eventSessionId) {
        return;
      }
      remoteCompleteHandledRef.current = eventSessionId;

      if (resultDataRef.current) {
        return;
      }

      setIsScanning(false);
      setProgress(100);

      const duration =
        Number.isFinite(Number(durationRaw))
          ? Number(durationRaw)
          : getScanDurationSeconds();

      void (async () => {
        try {
          const file = await fetchServerFile(uploadConfig, eventSessionId);
          const fallbackFilename = asWireString(filenameRaw);
          const filename =
            normalizeScanFilename(file.filename) ||
            (fallbackFilename !== undefined
              ? normalizeScanFilename(fallbackFilename)
              : null) ||
            t('common.unknownFile');
          const mimeType = file.mimeType;
          const isTextResult =
            mimeType !== undefined &&
            mimeType.toLowerCase().startsWith('text/');
          const nextResultData: ResultData = isTextResult
            ? {
                kind: 'note',
                filename,
                data: file.data,
                duration,
                noteContent: decodeNoteContent(file.data),
                sessionId: eventSessionId,
              }
            : {
                kind: 'file',
                filename,
                data: file.data,
                duration,
              };

          resultDataRef.current = nextResultData;
          setResultData(nextResultData);
          onScanComplete?.(
            createHistoryItem({
              id: eventSessionId,
              origin: 'scanned',
              filename,
              fileData: file.data,
              mimeType: file.mimeType,
            })
          );

          void Promise.allSettled([
            deleteIncompleteScan(eventSessionId),
            deleteScanSessionChunks(eventSessionId),
            deleteScanSessionPackets(eventSessionId),
          ]).then((results) => {
            results.forEach((result) => {
              if (result.status === 'rejected') {
                logger.debug('Failed to clear remote-complete session cache', {
                  error: result.reason,
                  sessionId: eventSessionId,
                });
              }
            });
          });
        } catch (error) {
          logger.error('Failed to fetch completed file from server', {
            error: error instanceof Error ? error.message : String(error),
            sessionId: eventSessionId,
          });
          setStatus(t('scanner.scanning'));
        }
      })();
    },
    [
      getScanDurationSeconds,
      onScanComplete,
      remoteCompleteHandledRef,
      resultDataRef,
      setIsScanning,
      setProgress,
      setResultData,
      setStatus,
      t,
      uploadConfig,
    ]
  );

  const applyCanonicalState = useCallback(
    (raw: WireValue): boolean => {
      const incoming = normalizeScanSessionState(raw);
      if (!incoming) {
        return false;
      }

      const eventSessionId = incoming.sessionId;
      if (shouldIgnoreResetSession(eventSessionId)) {
        return true;
      }

      const currentSessionId = sessionIdRef.current;
      const resumeId = resumeSessionId || null;
      const activeId = activeSessionId || null;
      const matchesCurrent = Boolean(
        currentSessionId && eventSessionId === currentSessionId
      );
      const matchesResume = Boolean(resumeId && eventSessionId === resumeId);
      const matchesActive = Boolean(activeId && eventSessionId === activeId);

      if (currentSessionId && !matchesCurrent && !matchesResume && !matchesActive) {
        return false;
      }
      if (!currentSessionId && !matchesResume && !matchesActive) {
        return false;
      }

      if (!sessionIdRef.current) {
        sessionIdRef.current = eventSessionId;
      }

      if (
        remoteCompleteHandledRef.current === eventSessionId ||
        resultDataRef.current
      ) {
        return true;
      }

      const previous =
        canonicalStateRef.current?.sessionId === eventSessionId
          ? canonicalStateRef.current
          : null;
      const merged = mergeScanSessionState(previous, incoming);
      if (!merged) {
        return false;
      }

      canonicalStateRef.current = merged;
      if (merged === previous) {
        return true;
      }

      if (merged.isComplete && merged.fileAvailable) {
        handleRemoteComplete(
          merged.sessionId,
          readCanonicalField(raw, 'duration'),
          merged.filename ?? readCanonicalField(raw, 'filename')
        );
        return true;
      }

      const received = merged.receivedUnique;
      if (received <= 0) {
        return true;
      }

      const hasDecodeThreshold =
        merged.decodeThreshold !== null && merged.decodeThreshold > 0;
      const hasTotalPackets =
        merged.totalPackets !== null && merged.totalPackets > 0;
      const totalForUi = hasDecodeThreshold
        ? merged.decodeThreshold ?? received
        : hasTotalPackets
          ? merged.totalPackets ?? received
          : received;
      const totalIsEstimate = !merged.totalPacketsExact;
      const minIsEstimate = !hasDecodeThreshold;
      const min = hasDecodeThreshold
        ? merged.decodeThreshold ?? totalForUi
        : totalForUi;
      const max =
        hasTotalPackets && merged.totalPacketsExact
          ? Math.max(merged.totalPackets ?? min, min)
          : null;
      const totalLabel = formatProgressTotalLabel(totalForUi, totalIsEstimate, {
        thresholdKnown: hasDecodeThreshold,
      });
      const minLabel = formatProgressTotalLabel(min, minIsEstimate);
      const maxLabel = max !== null ? String(max) : '-';
      const percent = merged.completionPercent;
      const filenameRaw = asWireString(readCanonicalField(raw, 'filename'));
      const filename =
        normalizeScanFilename(merged.filename ?? undefined) ||
        (filenameRaw !== undefined
          ? normalizeScanFilename(filenameRaw)
          : null) ||
        null;
      const deviceNameRaw = asWireString(readCanonicalField(raw, 'deviceName'));
      const deviceName =
        deviceNameRaw !== undefined && deviceNameRaw.trim().length > 0
          ? deviceNameRaw.trim()
          : null;

      serverProgressSeenRef.current = true;
      if (filename) {
        filenameRef.current = filename;
      }
      if (deviceName) {
        setSyncSourceName(deviceName);
      }

      setSessionProgress({
        received,
        total: totalForUi,
        totalLabel,
        totalIsEstimate,
        min,
        minLabel,
        max,
        maxLabel,
        percent,
        decodeState: merged.decodeState,
        fileAvailable: merged.fileAvailable,
        chunksTotal: merged.chunksTotal,
        chunksComplete: merged.chunksComplete,
        chunksMissing: merged.chunksMissing,
        chunks: merged.chunks,
      });
      setProgress(percent);
      setStatus(
        t('scanner.sessionProgressStatus', {
          percent: percent.toFixed(1),
          received,
          total: totalLabel,
        })
      );

      const displayFilename =
        normalizeScanFilename(filenameRef.current || undefined) ||
        t('common.unknownFile');
      onScanProgressRef.current?.({
        sessionId: merged.sessionId,
        filename: displayFilename,
        received,
        total: totalForUi,
        totalIsEstimate,
        progressPercent: percent,
        deviceName: deviceName ?? undefined,
        source: 'server',
        chunksCompleted: merged.chunksComplete,
        totalChunks: merged.chunksTotal ?? undefined,
        chunksSaved: chunksSavedRef.current,
      });
      backfillLiveSessionPackets(
        merged.sessionId,
        received,
        totalForUi,
        displayFilename,
        max,
        totalIsEstimate
      );

      return true;
    },
    [
      activeSessionId,
      backfillLiveSessionPackets,
      chunksSavedRef,
      filenameRef,
      handleRemoteComplete,
      onScanProgressRef,
      remoteCompleteHandledRef,
      resultDataRef,
      resumeSessionId,
      serverProgressSeenRef,
      sessionIdRef,
      setProgress,
      setSessionProgress,
      setStatus,
      setSyncSourceName,
      shouldIgnoreResetSession,
      t,
    ]
  );

  const refreshServerSessionSnapshot = useCallback(
    (reason: 'mount' | 'connection-ready' | 'poll') => {
      const targetSessionId = sessionIdRef.current || resumeSessionId || null;
      if (!uploadConfig.enabled || !uploadConfig.url || !targetSessionId) {
        return;
      }
      if (shouldIgnoreResetSession(targetSessionId)) {
        return;
      }
      if (
        serverSnapshotInFlightRef.current ||
        remoteCompleteHandledRef.current === targetSessionId ||
        resultDataRef.current
      ) {
        return;
      }

      serverSnapshotInFlightRef.current = true;

      void (async () => {
        try {
          const session = await fetchServerSession(uploadConfig, targetSessionId);
          if (!session) {
            return;
          }

          const authoritativeSessionId =
            session.sessionId.length > 0
              ? session.sessionId
              : targetSessionId;

          if (
            shouldIgnoreResetSession(targetSessionId) ||
            shouldIgnoreResetSession(authoritativeSessionId)
          ) {
            return;
          }

          if (!sessionIdRef.current) {
            sessionIdRef.current = authoritativeSessionId;
          }

          const sessionValue = asWireObject(parseJsonText(JSON.stringify(session)));
          if (hasCanonicalScanSessionState(sessionValue) && applyCanonicalState(sessionValue)) {
            return;
          }

          const isComplete =
            Boolean(session.completed) ||
            String(session.status || '').toLowerCase() === 'complete';

          if (isComplete) {
            handleRemoteComplete(
              authoritativeSessionId,
              session.duration,
              session.filename
            );
            return;
          }

          const receivedRaw =
            session.receivedCount ??
            session.receivedPackets ??
            session.packetCount;
          const expectedRaw =
            session.expectedPackets ??
            session.totalPackets;

          applyServerProgress(
            receivedRaw,
            expectedRaw,
            session.totalPackets,
            session.filename,
            session.deviceName,
            session.totalPacketsExact
          );
        } catch (error) {
          logger.debug('Failed to refresh server session snapshot', {
            error: error instanceof Error ? error.message : String(error),
            reason,
            sessionId: targetSessionId,
          });
        } finally {
          serverSnapshotInFlightRef.current = false;
        }
      })();
    },
    [
      applyCanonicalState,
      applyServerProgress,
      handleRemoteComplete,
      remoteCompleteHandledRef,
      resultDataRef,
      resumeSessionId,
      serverSnapshotInFlightRef,
      sessionIdRef,
      shouldIgnoreResetSession,
      uploadConfig,
    ]
  );

  useEffect(() => {
    const wsService = getWebSocketSyncService();
    let transportProbe: number | undefined;

    const handleRealtimeEvent = (
      eventType: 'scan-progress' | 'scan-complete',
      payload: WireObject
    ) => {
      const eventSessionId = toSessionId(
        payload.sessionId ?? payload.id ?? payload.historyId
      );
      if (shouldIgnoreResetSession(eventSessionId)) {
        return;
      }

      const currentSessionId = sessionIdRef.current;
      const resumeId = resumeSessionId || null;
      const matchedSessionId =
        (eventSessionId && currentSessionId && eventSessionId === currentSessionId) ||
        (eventSessionId && resumeId && eventSessionId === resumeId)
          ? eventSessionId
          : null;
      if (!matchedSessionId) {
        return;
      }

      if (!currentSessionId) {
        sessionIdRef.current = matchedSessionId;
      }

      if (eventType === 'scan-progress') {
        const receivedRaw =
          payload.receivedCount ??
          payload.receivedPackets ??
          payload.packetCount;
        const expectedRaw =
          payload.expectedPackets ??
          payload.totalPackets;

        applyServerProgress(
          receivedRaw,
          expectedRaw,
          payload.totalPackets,
          payload.filename,
          payload.deviceName,
          payload.totalPacketsExact
        );
        return;
      }

      handleRemoteComplete(matchedSessionId, payload.duration, payload.filename);
    };

    const unsubscribe = wsService.subscribe((event) => {
      // SAFETY: websocket events carry a JSON object payload.
      const payload = asWireObject(event.payload as WireValue);

      if (event.type === 'scan-session-state') {
        applyCanonicalState(payload);
        return;
      }

      if (event.type === 'scan-progress' || event.type === 'scan-complete') {
        handleRealtimeEvent(event.type, payload);
        return;
      }

      if (event.type === 'history') {
        if (payload.kind === 'connection-ready') {
          refreshServerSessionSnapshot('connection-ready');
        }

        const nestedType = payload.type;
        if (nestedType === 'scan-session-state') {
          applyCanonicalState(payload);
          return;
        }
        if (nestedType === 'scan-progress' || nestedType === 'scan-complete') {
          handleRealtimeEvent(nestedType, payload);
        }
      }
    });

    if (canAttemptServerSync) {
      wsService.connect(uploadConfig);
      transportProbe = window.setTimeout(() => {
        logger.info('Scanner realtime transport probe', {
          state: wsService.getState(),
          transport: 'websocket',
        });
      }, 1500);
    }

    return () => {
      if (transportProbe !== undefined) {
        window.clearTimeout(transportProbe);
      }
      unsubscribe();
    };
  }, [
    applyCanonicalState,
    applyServerProgress,
    canAttemptServerSync,
    handleRemoteComplete,
    refreshServerSessionSnapshot,
    resumeSessionId,
    sessionIdRef,
    shouldIgnoreResetSession,
    uploadConfig,
  ]);

  useEffect(() => {
    if (!canAttemptServerSync) {
      return;
    }

    const targetSessionId = activeSessionId || resumeSessionId || null;
    if (!targetSessionId) {
      return;
    }

    refreshServerSessionSnapshot('mount');
    const bootstrapProbeIds = [750, 2000].map((delayMs) =>
      window.setTimeout(() => {
        refreshServerSessionSnapshot('mount');
      }, delayMs)
    );
    const stalledServerRefreshId = window.setInterval(() => {
      refreshServerSessionSnapshot('poll');
    }, STALLED_SERVER_REFRESH_INTERVAL_MS);

    return () => {
      bootstrapProbeIds.forEach((probeId) => {
        window.clearTimeout(probeId);
      });
      window.clearInterval(stalledServerRefreshId);
    };
  }, [
    activeSessionId,
    canAttemptServerSync,
    refreshServerSessionSnapshot,
    resumeSessionId,
  ]);

  useEffect(() => {
    setSyncSourceName(localDeviceName);
  }, [localDeviceName, setSyncSourceName]);
}
