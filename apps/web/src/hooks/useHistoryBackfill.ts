import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { IncompleteScanItem, ScanUploadConfig } from '../types';
import { createLogger } from '../utils/logger';
import { extractScanPacketTransportIdentity } from '../utils/scanProgress';
import {
  countPacketPages,
  getLegacyPacketPages,
  type LocalPacketSource,
} from '../utils/historyPackets';
import { getIncompleteScanById, deleteIncompleteScan } from '../services/historyDB';
import {
  countScanSessionPackets,
  deleteScanSessionChunks,
  deleteScanSessionPackets,
  visitScanSessionPacketPages,
} from '../services/scanSessionDB';
import { queueScanPacket } from '../services/scanUploadService';
import {
  getIncompleteScanSessionKeys,
  getLegacyIncompleteScanPackets,
  shouldBackfillIncompleteSession,
} from '../utils/incompleteSync';

const logger = createLogger('hooks:useHistoryBackfill');

interface UseHistoryBackfillArgs {
  incompleteItems: IncompleteScanItem[];
  remoteIncompleteItems: IncompleteScanItem[];
  setRemoteIncompleteItems: Dispatch<SetStateAction<IncompleteScanItem[]>>;
  completedScannedSessionIds: Set<string>;
  shouldSync: boolean;
  remoteHistoryReady: boolean;
  uploadConfig: ScanUploadConfig;
  removeIncompleteScan: (sessionId: string) => void;
}

interface UseHistoryBackfillResult {
  clearBackfillState: (sessionId?: string | null) => void;
}

export function useHistoryBackfill({
  incompleteItems,
  remoteIncompleteItems,
  setRemoteIncompleteItems,
  completedScannedSessionIds,
  shouldSync,
  remoteHistoryReady,
  uploadConfig,
  removeIncompleteScan,
}: UseHistoryBackfillArgs): UseHistoryBackfillResult {
  const incompleteItemsRef = useRef(incompleteItems);
  const remoteIncompleteItemsRef = useRef(remoteIncompleteItems);
  const uploadConfigRef = useRef(uploadConfig);
  const shouldSyncRef = useRef(shouldSync);
  const remoteHistoryReadyRef = useRef(remoteHistoryReady);
  const backfillInFlightRef = useRef<Set<string>>(new Set());
  const backfillSignatureRef = useRef<Map<string, string>>(new Map());
  const backfillDrainInFlightRef = useRef(false);
  const backfillDrainRequestedRef = useRef(false);

  useEffect(() => {
    incompleteItemsRef.current = incompleteItems;
  }, [incompleteItems]);

  useEffect(() => {
    remoteIncompleteItemsRef.current = remoteIncompleteItems;
  }, [remoteIncompleteItems]);

  useEffect(() => {
    uploadConfigRef.current = uploadConfig;
  }, [uploadConfig]);

  useEffect(() => {
    shouldSyncRef.current = shouldSync;
  }, [shouldSync]);

  useEffect(() => {
    remoteHistoryReadyRef.current = remoteHistoryReady;
  }, [remoteHistoryReady]);

  const clearBackfillState = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }
    backfillInFlightRef.current.delete(sessionId);
    backfillSignatureRef.current.delete(sessionId);
  }, []);

  const getLocalPacketSource = useCallback(
    async (
      sessionId: string,
      fallbackPackets?: Array<Uint8Array | ArrayBuffer>
    ): Promise<LocalPacketSource> => {
      const persistedPacketCount = await countScanSessionPackets(sessionId);
      if (persistedPacketCount > 0) {
        return {
          packetCount: persistedPacketCount,
          visit: async (visitor) => {
            await visitScanSessionPacketPages(sessionId, visitor);
          },
        };
      }

      const fallbackPages = getLegacyPacketPages(fallbackPackets);
      return {
        packetCount: countPacketPages(fallbackPages),
        visit: async (visitor) => {
          for (const page of fallbackPages) {
            await visitor(page);
          }
        },
      };
    },
    []
  );

  useEffect(() => {
    const stale = incompleteItems.filter((item) => {
      const key = item.remoteSessionId || item.sessionId;
      return (
        completedScannedSessionIds.has(item.sessionId) ||
        completedScannedSessionIds.has(key)
      );
    });
    if (stale.length === 0) {
      return;
    }

    setRemoteIncompleteItems((prev) =>
      prev.filter((item) => {
        const key = item.remoteSessionId || item.sessionId;
        return (
          !completedScannedSessionIds.has(item.sessionId) &&
          !completedScannedSessionIds.has(key)
        );
      })
    );

    for (const item of stale) {
      clearBackfillState(item.remoteSessionId || item.sessionId);
      removeIncompleteScan(item.sessionId);
      void Promise.allSettled([
        deleteIncompleteScan(item.sessionId),
        deleteScanSessionChunks(item.sessionId),
        deleteScanSessionPackets(item.sessionId),
      ]).then((results) => {
        results.forEach((result) => {
          if (result.status === 'rejected') {
            logger.debug('Failed to remove stale completed incomplete scan from IndexedDB', {
              error: result.reason,
              sessionId: item.sessionId,
            });
          }
        });
      });
    }
  }, [
    clearBackfillState,
    completedScannedSessionIds,
    incompleteItems,
    removeIncompleteScan,
    setRemoteIncompleteItems,
  ]);

  const backfillIncompleteSession = useCallback(
    async (
      item: IncompleteScanItem,
      remoteItem?: IncompleteScanItem
    ): Promise<void> => {
      const sessionId = item.remoteSessionId || item.sessionId;
      if (!sessionId) {
        return;
      }

      if (backfillInFlightRef.current.has(sessionId)) {
        return;
      }

      const localReceived = item.received || 0;
      const remoteReceived = remoteItem?.received || 0;

      if (!shouldBackfillIncompleteSession(localReceived, remoteItem?.received)) {
        return;
      }

      const stored = await getIncompleteScanById(item.sessionId);
      const packetSource = await getLocalPacketSource(
        item.sessionId,
        getLegacyIncompleteScanPackets(stored)
      );
      const packetCount = packetSource.packetCount;
      if (packetCount === 0) {
        return;
      }

      const signature = `${localReceived}:${remoteReceived}:${packetCount}`;
      if (backfillSignatureRef.current.get(sessionId) === signature) {
        return;
      }

      backfillInFlightRef.current.add(sessionId);
      backfillSignatureRef.current.set(sessionId, signature);

      try {
        const filename = stored?.filename || item.filename;
        const total = stored?.total ?? item.total;
        const chunksCompleted = stored?.chunksCompleted ?? item.chunksCompleted;
        const totalChunks = stored?.totalChunks ?? item.totalChunks;
        const chunksSaved = stored?.chunksSaved ?? item.chunksSaved;

        await packetSource.visit((page) => {
          page.packets.forEach((packet, offset) => {
            const transportIdentity = extractScanPacketTransportIdentity(packet);
            const packetIndex =
              transportIdentity.packetIndex ?? (page.startIndex + offset);
            const effectiveSessionId = transportIdentity.sessionId || sessionId;
            queueScanPacket(
              packet,
              {
                sessionId: effectiveSessionId,
                filename,
                isStreaming: transportIdentity.isStreaming,
                packetIndex,
                chunkId: transportIdentity.chunkId,
                receivedPackets: localReceived,
                expectedPackets: total,
                totalPackets: total,
                chunksCompleted,
                totalChunks,
                chunksSaved,
              },
              uploadConfigRef.current
            );
          });
        });

        logger.info('Backfilled incomplete scan packets to server', {
          sessionId,
          packetCount,
          localReceived,
          remoteReceived,
        });
      } catch (error) {
        clearBackfillState(sessionId);
        logger.error('Failed to backfill incomplete scan', {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        });
      } finally {
        backfillInFlightRef.current.delete(sessionId);
      }
    },
    [clearBackfillState, getLocalPacketSource]
  );

  const drainBackfillQueue = useCallback(async (): Promise<void> => {
    if (backfillDrainInFlightRef.current) {
      backfillDrainRequestedRef.current = true;
      return;
    }

    backfillDrainInFlightRef.current = true;
    try {
      do {
        backfillDrainRequestedRef.current = false;

        if (
          !shouldSyncRef.current ||
          !(uploadConfigRef.current.syncScanned ?? true) ||
          !remoteHistoryReadyRef.current
        ) {
          continue;
        }

        const remoteBySession = new Map(
          remoteIncompleteItemsRef.current.flatMap((item) =>
            getIncompleteScanSessionKeys(item).map(
              (sessionKey) => [sessionKey, item] as const
            )
          )
        );

        for (const item of incompleteItemsRef.current) {
          if (
            !shouldSyncRef.current ||
            !(uploadConfigRef.current.syncScanned ?? true) ||
            !remoteHistoryReadyRef.current
          ) {
            break;
          }

          await backfillIncompleteSession(
            item,
            remoteBySession.get(item.sessionId)
          );

          if (backfillDrainRequestedRef.current) {
            break;
          }
        }
      } while (backfillDrainRequestedRef.current);
    } finally {
      backfillDrainInFlightRef.current = false;
    }
  }, [backfillIncompleteSession]);

  useEffect(() => {
    if (!shouldSync || uploadConfig.syncScanned === false || !remoteHistoryReady) {
      backfillDrainRequestedRef.current = false;
      return;
    }

    backfillDrainRequestedRef.current = true;
    void drainBackfillQueue();
  }, [
    drainBackfillQueue,
    incompleteItems,
    remoteIncompleteItems,
    remoteHistoryReady,
    shouldSync,
    uploadConfig.syncScanned,
  ]);

  return { clearBackfillState };
}
