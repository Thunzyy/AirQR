import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ResumeAuthority, ScanUploadConfig } from '../types';
import { queueScanPacket, type ScanUploadPacketMeta } from '../services/scanUploadService';
import { normalizeScanFilename } from '../utils/format';
import type { WireValue } from '../parse/wire';
import {
  normalizeIncompleteProgress,
  resolveKnownGlobalExactChunkTotals,
  resolveScanProgressTotals,
} from '../utils/scanProgress';

interface ScannerStatsState {
  received: number;
  min: number;
  total?: number;
  chunkTotal?: number;
  chunkReceived?: number;
}

interface ProgressResultLike {
  chunkId?: number;
  chunksCompleted?: number;
  filename?: string;
  packetsExpectedChunk?: number;
  packetsReceivedChunk?: number;
  percent?: number;
  overallPercent?: number;
  totalChunks?: number;
}

interface QueuePacketForSyncArgs {
  binaryData: Uint8Array;
  chunkId?: number;
  chunksCompleted?: number;
  expectedPackets?: number;
  filename?: string;
  isStreaming: boolean;
  packetStartIndex: number;
  receivedPackets?: WireValue;
  resolvedSessionId: string;
  resultType: string;
  totalChunks?: number;
  totalExact: boolean;
  totalPackets?: number;
  transportIdentity: {
    packetIndex?: number;
    chunkId?: number;
  };
}

interface ApplyProgressResultArgs {
  expectedPackets?: number;
  packetDelta: Uint8Array[];
  packetStartIndex: number;
  receivedPackets?: WireValue;
  resolvedSessionId: string;
  result: ProgressResultLike;
  totalPackets?: number;
}

interface UseScannerLocalProgressArgs {
  chunkExactTotalsRef: MutableRefObject<Map<number, number>>;
  chunksSavedRef: MutableRefObject<number>;
  localDeviceName: string;
  onScanProgressRef: MutableRefObject<
    | ((stats: {
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
      }) => void)
    | undefined
  >;
  resumeAuthority?: ResumeAuthority;
  resumeMode: boolean;
  scanStatsRef: MutableRefObject<ScannerStatsState>;
  serverProgressSeenRef: MutableRefObject<boolean>;
  setProgress: Dispatch<SetStateAction<number>>;
  setScanStats: Dispatch<SetStateAction<ScannerStatsState>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setSyncSourceName: Dispatch<SetStateAction<string | null>>;
  t: (key: string, options?: TranslateOptions) => string;
  updateActiveChunk: (chunkIdRaw: WireValue | undefined, totalChunksRaw: WireValue | undefined) => void;
  uploadConfigRef: MutableRefObject<ScanUploadConfig>;
}

interface UseScannerLocalProgressResult {
  applyProgressResult: (args: ApplyProgressResultArgs) => void;
  queuePacketForSync: (args: QueuePacketForSyncArgs) => void;
}

type TranslateOptions = {
  readonly [name: string]: string | number | boolean | undefined;
};

function formatProgressTotalLabel(total: number, totalIsEstimate: boolean): string {
  if (!Number.isFinite(total) || total <= 0) {
    return '?';
  }

  return totalIsEstimate ? `~${total}` : String(total);
}

function toPositiveInt(value: WireValue | undefined): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return Math.trunc(numericValue);
}

export function useScannerLocalProgress({
  chunkExactTotalsRef,
  chunksSavedRef,
  localDeviceName,
  onScanProgressRef,
  resumeAuthority = 'local-cache',
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
}: UseScannerLocalProgressArgs): UseScannerLocalProgressResult {
  const queuePacketForSync = useCallback(
    ({
      binaryData,
      chunkId,
      chunksCompleted,
      expectedPackets,
      filename,
      isStreaming,
      packetStartIndex,
      receivedPackets,
      resolvedSessionId,
      resultType,
      totalChunks,
      totalExact,
      totalPackets,
      transportIdentity,
    }: QueuePacketForSyncArgs) => {
      const normalizedReceivedPackets = Number.isFinite(Number(receivedPackets))
        ? Number(receivedPackets)
        : undefined;
      const meta: ScanUploadPacketMeta = {
        sessionId: resolvedSessionId,
        filename,
        isStreaming,
        resultType,
        packetIndex: transportIdentity.packetIndex ?? packetStartIndex,
        chunkId: transportIdentity.chunkId ?? chunkId,
        totalChunks,
        chunksCompleted,
        receivedPackets: normalizedReceivedPackets,
        expectedPackets,
        totalPackets,
        totalPacketsExact: totalExact,
        chunksSaved: chunksSavedRef.current,
      };

      const localReceivedCount = Number(normalizedReceivedPackets ?? 0);
      const shouldMarkLocalSource =
        resumeAuthority !== 'server' &&
        (!resumeMode ||
          !serverProgressSeenRef.current ||
          (Number.isFinite(localReceivedCount) &&
            localReceivedCount > (scanStatsRef.current.received || 0)));

      if (shouldMarkLocalSource) {
        setSyncSourceName(localDeviceName);
      }

      queueScanPacket(binaryData, meta, uploadConfigRef.current);
    },
    [
      chunksSavedRef,
      localDeviceName,
      resumeAuthority,
      resumeMode,
      scanStatsRef,
      serverProgressSeenRef,
      setSyncSourceName,
      uploadConfigRef,
    ]
  );

  const applyProgressResult = useCallback(
    ({
      expectedPackets,
      packetDelta,
      packetStartIndex,
      receivedPackets,
      resolvedSessionId,
      result,
      totalPackets,
    }: ApplyProgressResultArgs) => {
      updateActiveChunk(result.chunkId, result.totalChunks);

      if (resumeAuthority === 'server') {
        return;
      }

      const {
        uiTotal: rawTotalForUi,
        totalIsEstimate,
        exactTransmittedTotal,
      } = resolveScanProgressTotals(
        expectedPackets,
        totalPackets
      );
      const percentFromDecoder = result.percent ?? result.overallPercent;
      const normalizedProgress = normalizeIncompleteProgress(
        receivedPackets,
        rawTotalForUi,
        {
          totalIsEstimate,
          progressPercent: percentFromDecoder,
        }
      );
      const displayReceived = normalizedProgress.received;
      const totalForUi = normalizedProgress.total;
      const percent = Math.min(
        normalizedProgress.totalIsEstimate ? 99 : 100,
        normalizedProgress.progressPercent
      );
      const totalLabel = formatProgressTotalLabel(
        totalForUi,
        normalizedProgress.totalIsEstimate
      );
      const totalChunks = toPositiveInt(result.totalChunks);
      const {
        chunkTotal: currentChunkTotal,
        globalTotal: globalExactTotal,
      } = resolveKnownGlobalExactChunkTotals(chunkExactTotalsRef.current, {
        chunkId: result.chunkId,
        totalChunks: result.totalChunks,
        chunkTotal: totalPackets,
      });
      const currentChunkMin =
        toPositiveInt(result.packetsExpectedChunk) ||
        (totalChunks > 1 ? Math.ceil(toPositiveInt(expectedPackets) / totalChunks) : 0);
      const globalDecodeMin =
        toPositiveInt(expectedPackets) ||
        (currentChunkMin > 0 && totalChunks > 0 ? currentChunkMin * totalChunks : 0);
      const displayMin =
        globalDecodeMin > 0
          ? globalDecodeMin
          : totalForUi || Number(rawTotalForUi);
      const displayTotal =
        globalExactTotal && globalExactTotal > 0
          ? Math.max(globalExactTotal, displayMin)
          : totalChunks <= 1 && exactTransmittedTotal && exactTransmittedTotal > 0
            ? Math.max(exactTransmittedTotal, displayMin)
            : undefined;

      if (!serverProgressSeenRef.current) {
        setProgress(percent);
        if (totalForUi > 0 && Number(receivedPackets) >= 0) {
          setStatus(
            t('scanner.progressStatus', {
              percent: percent.toFixed(1),
              received: displayReceived,
              total: totalLabel,
            })
          );
        } else {
          setStatus(t('scanner.receiving', { percent: percent.toFixed(1) }));
        }
      }

      if (receivedPackets === undefined || rawTotalForUi <= 0) {
        return;
      }

      setScanStats((prev) => ({
        received: Math.max(prev.received, displayReceived),
        min: displayMin > 0 ? displayMin : prev.min,
        total: displayTotal,
        chunkTotal: currentChunkTotal,
        chunkReceived:
          result.packetsReceivedChunk !== undefined &&
          Number.isFinite(result.packetsReceivedChunk)
            ? Math.max(0, Math.trunc(result.packetsReceivedChunk))
            : prev.chunkReceived,
      }));

      const safeFilename =
        normalizeScanFilename(result.filename) || t('common.unknownFile');

      onScanProgressRef.current?.({
        sessionId: resolvedSessionId,
        filename: safeFilename,
        received: displayReceived,
        total: totalForUi,
        totalIsEstimate: normalizedProgress.totalIsEstimate,
        progressPercent: percent,
        deviceName: localDeviceName,
        source: 'local',
        packetStartIndex,
        packetDelta,
        chunksCompleted: result.chunksCompleted,
        totalChunks: result.totalChunks,
        chunksSaved: chunksSavedRef.current,
      });
    },
    [
      chunksSavedRef,
      localDeviceName,
      onScanProgressRef,
      resumeAuthority,
      serverProgressSeenRef,
      setProgress,
      setScanStats,
      setStatus,
      t,
      updateActiveChunk,
      chunkExactTotalsRef,
    ]
  );

  return {
    applyProgressResult,
    queuePacketForSync,
  };
}
