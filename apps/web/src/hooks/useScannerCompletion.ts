import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { BinaryData } from '../utils/binaryData';
import type { HistoryItem, ResumeAuthority } from '../types';
import { createLogger } from '../utils/logger';
import { createHistoryItem, inferMimeTypeFromFilename } from '../utils/history';
import { getIncompleteScanById, deleteIncompleteScan } from '../services/historyDB';
import {
  deleteScanSessionChunks,
  deleteScanSessionPackets,
  loadScanSessionChunks,
  saveScanSessionChunk,
} from '../services/scanSessionDB';
import { toBlobPart } from '../utils/binaryData';

const logger = createLogger('hooks:useScannerCompletion');

interface ResultData {
  kind: 'file' | 'note';
  filename: string;
  data: BinaryData;
  duration: number;
  mimeType?: string;
  noteContent?: string;
  internalFilename?: string;
  sessionId?: string;
}

interface UseScannerCompletionArgs {
  getScanDurationSeconds: () => number;
  onScanComplete?: (item: HistoryItem) => void;
  packetIndexRef: MutableRefObject<number>;
  remoteCompleteHandledRef: MutableRefObject<string | null>;
  resumeAuthority?: ResumeAuthority;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  setResultData: Dispatch<SetStateAction<ResultData | null>>;
}

interface PersistChunkAndMaybeAssembleArgs {
  chunkData: Uint8Array;
  chunkId: number;
  filename?: string | null;
  sessionId: string;
  totalChunks: number;
}

interface PersistChunkAndMaybeAssembleResult {
  chunksSaved: number;
  completed: boolean;
}

interface FinalizeCompletedScanArgs {
  data: BinaryData;
  filename: string;
  sessionId: string;
}

interface UseScannerCompletionResult {
  cleanupCompletedSession: (sessionId: string) => void;
  finalizeCompletedScan: (args: FinalizeCompletedScanArgs) => Promise<void>;
  persistChunkAndMaybeAssemble: (
    args: PersistChunkAndMaybeAssembleArgs
  ) => Promise<PersistChunkAndMaybeAssembleResult>;
}

export function useScannerCompletion({
  getScanDurationSeconds,
  onScanComplete,
  packetIndexRef,
  remoteCompleteHandledRef,
  resumeAuthority = 'local-cache',
  setIsScanning,
  setResultData,
}: UseScannerCompletionArgs): UseScannerCompletionResult {
  const cleanupCompletedSession = useCallback((sessionId: string) => {
    void Promise.allSettled([
      deleteIncompleteScan(sessionId),
      deleteScanSessionChunks(sessionId),
      deleteScanSessionPackets(sessionId),
    ]).then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected') {
          logger.debug('Failed to clear completed session cache', {
            error: result.reason,
            sessionId,
          });
        }
      });
    });
  }, []);

  const finalizeCompletedScan = useCallback(
    async ({ data, filename, sessionId }: FinalizeCompletedScanArgs) => {
      const mimeType = inferMimeTypeFromFilename(filename);
      setIsScanning(false);
      setResultData({
        kind: 'file',
        filename,
        data,
        duration: getScanDurationSeconds(),
        mimeType,
      });
      remoteCompleteHandledRef.current = sessionId;
      packetIndexRef.current = 0;
      onScanComplete?.(
        createHistoryItem({
          id: sessionId,
          origin: 'scanned',
          filename,
          fileData: data,
          mimeType,
        })
      );
      cleanupCompletedSession(sessionId);
    },
    [
      cleanupCompletedSession,
      getScanDurationSeconds,
      onScanComplete,
      packetIndexRef,
      remoteCompleteHandledRef,
      setIsScanning,
      setResultData,
    ]
  );

  const persistChunkAndMaybeAssemble = useCallback(
    async ({
      chunkData,
      chunkId,
      filename,
      sessionId,
      totalChunks,
    }: PersistChunkAndMaybeAssembleArgs): Promise<PersistChunkAndMaybeAssembleResult> => {
      if (resumeAuthority === 'server') {
        return { chunksSaved: 0, completed: false };
      }

      await saveScanSessionChunk(sessionId, chunkId, chunkData);
      const sorted = await loadScanSessionChunks(sessionId);
      const chunksSaved = sorted.length;

      if (chunksSaved !== totalChunks) {
        return { chunksSaved, completed: false };
      }

      logger.info('All chunks collected, assembling file', {
        sessionId,
        totalChunks,
      });

      const finalFilename =
        filename ||
        (await getIncompleteScanById(sessionId))?.filename ||
        'reassembled.bin';
      const finalData = new Blob(sorted.map((chunk) => toBlobPart(chunk.data)), {
        type: inferMimeTypeFromFilename(finalFilename) || 'application/octet-stream',
      });

      await finalizeCompletedScan({
        data: finalData,
        filename: finalFilename,
        sessionId,
      });

      return { chunksSaved, completed: true };
    },
    [finalizeCompletedScan, resumeAuthority]
  );

  return {
    cleanupCompletedSession,
    finalizeCompletedScan,
    persistChunkAndMaybeAssemble,
  };
}
