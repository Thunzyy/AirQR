import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import {
  normalizeIncompleteProgress,
  resolveKnownGlobalExactChunkTotals,
} from '../utils/scanProgress';
import type { WireValue } from '../parse/wire';
import type { ResumeAuthority } from '../types';

interface ScannerStatsState {
  received: number;
  min: number;
  total?: number;
  chunkTotal?: number;
  chunkReceived?: number;
}

interface ChunkCompletedResultLike {
  chunkData?: Uint8Array;
  chunkId: number;
  chunksCompleted?: number;
  filename?: string;
  overallPercent?: number;
  packetsExpectedChunk?: number;
  packetsReceivedChunk?: number;
  packetsReceivedTotal?: number;
  packetsTotalChunk?: number;
  totalChunks: number;
}

type TranslateOptions = {
  readonly [name: string]: string | number | boolean | undefined;
};

export interface ChunkProgressState {
  filename: string;
  progressPercent: number;
  received: number;
  total: number;
  totalIsEstimate: boolean;
}

interface ApplyChunkCompletedProgressArgs {
  packetDelta: Uint8Array[];
  packetStartIndex: number;
  resolvedSessionId: string;
  result: ChunkCompletedResultLike;
}

interface EmitPersistedChunkProgressArgs {
  chunksCompleted?: number;
  chunksSaved: number;
  filename?: string;
  progressState: ChunkProgressState;
  resolvedSessionId: string;
  totalChunks: number;
}

interface UseScannerChunkProgressArgs {
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
  serverProgressSeenRef: MutableRefObject<boolean>;
  setProgress: Dispatch<SetStateAction<number>>;
  setScanStats: Dispatch<SetStateAction<ScannerStatsState>>;
  setStatus: Dispatch<SetStateAction<string>>;
  t: (key: string, options?: TranslateOptions) => string;
  updateActiveChunk: (chunkIdRaw: WireValue | undefined, totalChunksRaw: WireValue | undefined) => void;
}

interface UseScannerChunkProgressResult {
  applyChunkCompletedProgress: (
    args: ApplyChunkCompletedProgressArgs
  ) => ChunkProgressState;
  emitPersistedChunkProgress: (args: EmitPersistedChunkProgressArgs) => void;
}

export function useScannerChunkProgress({
  chunkExactTotalsRef,
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
}: UseScannerChunkProgressArgs): UseScannerChunkProgressResult {
  const emitPersistedChunkProgress = useCallback(
    ({
      chunksCompleted,
      chunksSaved,
      filename,
      progressState,
      resolvedSessionId,
      totalChunks,
    }: EmitPersistedChunkProgressArgs) => {
      if (resumeAuthority === 'server') {
        return;
      }

      onScanProgressRef.current?.({
        sessionId: resolvedSessionId,
        filename: filename || t('common.unknownFile'),
        received: progressState.received,
        total: progressState.total,
        totalIsEstimate: progressState.totalIsEstimate,
        progressPercent: progressState.progressPercent,
        deviceName: localDeviceName,
        source: 'local',
        chunksCompleted,
        totalChunks,
        chunksSaved,
      });
    },
    [localDeviceName, onScanProgressRef, resumeAuthority, t]
  );

  const applyChunkCompletedProgress = useCallback(
    ({
      packetDelta,
      packetStartIndex,
      resolvedSessionId,
      result,
    }: ApplyChunkCompletedProgressArgs): ChunkProgressState => {
      const chunkId = result.chunkId;
      const totalChunks = result.totalChunks;
      updateActiveChunk(chunkId, totalChunks);

      const packetsReceivedTotal = result.packetsReceivedTotal || 0;
      const packetsExpectedChunk = result.packetsExpectedChunk || 0;
      const estimatedTotal = packetsExpectedChunk * totalChunks || 0;
      const {
        chunkTotal: exactChunkTotal,
        globalTotal: globalExactTotal,
      } = resolveKnownGlobalExactChunkTotals(chunkExactTotalsRef.current, {
        chunkId,
        totalChunks,
        chunkTotal: result.packetsTotalChunk,
      });
      const currentChunkTotal =
        exactChunkTotal && exactChunkTotal > 0
          ? Math.max(exactChunkTotal, packetsExpectedChunk)
          : packetsExpectedChunk > 0
            ? packetsExpectedChunk
            : undefined;
      const normalizedProgress = normalizeIncompleteProgress(
        packetsReceivedTotal,
        estimatedTotal,
        {
          totalIsEstimate: true,
          progressPercent: result.overallPercent,
        }
      );
      const progressPercent = Math.min(99, normalizedProgress.progressPercent);
      const filename = result.filename || t('common.unknownFile');
      const serverAuthoritative = resumeAuthority === 'server';

      if (!serverAuthoritative && !serverProgressSeenRef.current) {
        setStatus(t('scanner.chunkComplete', { current: chunkId + 1, total: totalChunks }));
        setProgress(progressPercent);
      }

      if (!serverAuthoritative) {
        setScanStats((prev) => ({
          received: Math.max(prev.received, normalizedProgress.received),
          min:
            packetsExpectedChunk > 0 && totalChunks > 0
              ? packetsExpectedChunk * totalChunks
              : prev.min,
          total:
            globalExactTotal && globalExactTotal > 0 ? globalExactTotal : undefined,
          chunkTotal: currentChunkTotal,
          chunkReceived:
            result.packetsReceivedChunk !== undefined &&
            Number.isFinite(result.packetsReceivedChunk)
              ? Math.max(0, Math.trunc(result.packetsReceivedChunk))
              : prev.chunkReceived,
        }));

        onScanProgressRef.current?.({
          sessionId: resolvedSessionId,
          filename,
          received: normalizedProgress.received,
          total: normalizedProgress.total,
          totalIsEstimate: normalizedProgress.totalIsEstimate,
          progressPercent,
          deviceName: localDeviceName,
          source: 'local',
          packetStartIndex,
          packetDelta,
          chunksCompleted: result.chunksCompleted,
          totalChunks,
          chunksSaved: chunksSavedRef.current,
        });
      }

      return {
        filename,
        progressPercent,
        received: normalizedProgress.received,
        total: normalizedProgress.total,
        totalIsEstimate: normalizedProgress.totalIsEstimate,
      };
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
    applyChunkCompletedProgress,
    emitPersistedChunkProgress,
  };
}
