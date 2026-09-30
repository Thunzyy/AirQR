import { useCallback } from 'react';

import type {
  IncompleteScanItem,
  ResumeAuthority,
  ResumeScanOptions,
  ResumeStats,
  ScanUploadConfig,
} from '../types';
import { createLogger } from '../utils/logger';
import { getIncompleteScanById, saveIncompleteScan } from '../services/historyDB';
import {
  countScanSessionPackets,
  replaceScanSessionPacketPages,
} from '../services/scanSessionDB';
import {
  getLegacyIncompleteScanPackets,
  stripIncompleteScanBuffers,
} from '../utils/incompleteSync';
import { flattenPacketPages, getLegacyPacketPages } from '../utils/historyPackets';
import {
  isMixedContentBlocked,
  resolveServerBaseUrl,
} from '../services/syncUrl';
import { globalHas } from '../parse/wire';

const logger = createLogger('hooks:useHistoryResume');
type ToastType = 'info' | 'success' | 'warning' | 'error';

interface UseHistoryResumeArgs {
  uploadConfig: ScanUploadConfig;
  hydrateRemotePacketPages: (
    localSessionId: string,
    remoteSessionId: string,
    config: ScanUploadConfig,
    options?: { authority?: ResumeAuthority }
  ) => Promise<number>;
  navigateToScanner: () => void;
  resumePreparationFailedMessage: string;
  setResumeScan: (
    sessionId: string,
    packets: Uint8Array[] | null,
    stats?: ResumeStats,
    options?: ResumeScanOptions
  ) => void;
  showToast: (message: string, variant?: ToastType) => void;
  updateIncompleteScan: (item: IncompleteScanItem) => void;
}

interface UseHistoryResumeResult {
  handleResume: (item: IncompleteScanItem) => void;
}

function canUseServerAuthoritativeResume(
  item: IncompleteScanItem,
  remoteSessionId: string | undefined,
  uploadConfig: ScanUploadConfig
): boolean {
  if (!remoteSessionId) {
    return false;
  }

  // SAFETY: older incomplete-scan records may include completed/status fields.
  const completionState = item as IncompleteScanItem & {
    completed?: boolean;
    status?: string;
  };
  const normalizedStatus = String(completionState.status || '').toLowerCase();
  if (
    completionState.completed === true ||
    normalizedStatus === 'complete' ||
    normalizedStatus === 'completed'
  ) {
    return false;
  }

  if (!uploadConfig.enabled || !uploadConfig.url) {
    return false;
  }

  if (uploadConfig.syncScanned === false) {
    return false;
  }

  if (!globalHas('WebSocket')) {
    return false;
  }

  const baseUrl = resolveServerBaseUrl(uploadConfig.url);
  if (!baseUrl || isMixedContentBlocked(baseUrl)) {
    return false;
  }

  return true;
}

export function useHistoryResume({
  uploadConfig,
  hydrateRemotePacketPages,
  navigateToScanner,
  resumePreparationFailedMessage,
  setResumeScan,
  showToast,
  updateIncompleteScan,
}: UseHistoryResumeArgs): UseHistoryResumeResult {
  const handleResume = useCallback(
    (item: IncompleteScanItem) => {
      const stats: ResumeStats = {
        received: item.received,
        total: item.total,
        filename: item.filename,
      };

      void (async () => {
        const remoteSessionId =
          item.remoteSessionId || (item.source === 'server' ? item.sessionId : undefined);

        if (remoteSessionId) {
          const resumeSessionId = remoteSessionId;
          const localCacheResumeSessionId = item.sessionId;
          const resumed = stripIncompleteScanBuffers({
            ...item,
            source: 'server',
            remoteSessionId: resumeSessionId,
          });

          if (canUseServerAuthoritativeResume(item, resumeSessionId, uploadConfig)) {
            try {
              await saveIncompleteScan(resumed);
              updateIncompleteScan(resumed);
              setResumeScan(resumeSessionId, null, stats, { authority: 'server' });
              navigateToScanner();
              return;
            } catch (error) {
              logger.error('Failed to persist server-authoritative resume metadata', {
                error: error instanceof Error ? error.message : String(error),
                remoteSessionId,
                sessionId: item.sessionId,
              });
              showToast(resumePreparationFailedMessage, 'error');
              return;
            }
          }

          try {
            const persistedPacketCount = await countScanSessionPackets(item.sessionId);

            if (persistedPacketCount >= item.received && persistedPacketCount > 0) {
              await saveIncompleteScan(resumed);
              updateIncompleteScan(resumed);
              setResumeScan(localCacheResumeSessionId, null, stats, {
                authority: 'local-cache',
              });
              navigateToScanner();
              return;
            }

            const packetCount = await hydrateRemotePacketPages(
              item.sessionId,
              remoteSessionId,
              uploadConfig,
              { authority: 'local-cache' }
            );
            logger.info('Fetched packets from server for resume', {
              sessionId: item.sessionId,
              packetCount,
            });
            await saveIncompleteScan(resumed);
            updateIncompleteScan(resumed);
            setResumeScan(localCacheResumeSessionId, null, stats, {
              authority: 'local-cache',
            });
            navigateToScanner();
            return;
          } catch (error) {
            logger.error('Failed to prepare remote scan resume', {
              error: error instanceof Error ? error.message : String(error),
              remoteSessionId,
              sessionId: item.sessionId,
            });
            showToast(resumePreparationFailedMessage, 'error');
            return;
          }
        }

        try {
          const stored = await getIncompleteScanById(item.sessionId);
          const hasPersistedPacketPages =
            (await countScanSessionPackets(item.sessionId)) > 0;
          const resumed: IncompleteScanItem = {
            ...item,
            filename: stored?.filename || item.filename,
            received: stored?.received ?? item.received,
            total: stored?.total ?? item.total,
            chunksCompleted: stored?.chunksCompleted ?? item.chunksCompleted,
            totalChunks: stored?.totalChunks ?? item.totalChunks,
            chunksSaved: stored?.chunksSaved ?? item.chunksSaved,
          };
          const resumedStats: ResumeStats = {
            received: resumed.received,
            total: resumed.total,
            filename: resumed.filename,
          };

          if (hasPersistedPacketPages) {
            try {
              const stripped = stripIncompleteScanBuffers(resumed);
              await saveIncompleteScan(stripped);
              updateIncompleteScan(stripped);
              setResumeScan(item.sessionId, null, resumedStats, {
                authority: 'local-cache',
              });
            } catch (error) {
              logger.error('Failed to persist local resume metadata', {
                error: error instanceof Error ? error.message : String(error),
                sessionId: item.sessionId,
              });
              updateIncompleteScan(resumed);
              setResumeScan(item.sessionId, null, resumedStats, {
                authority: 'local-cache',
              });
            }
            navigateToScanner();
            return;
          }

          const fallbackPacketPages = getLegacyPacketPages(
            getLegacyIncompleteScanPackets(stored)
          );

          try {
            const stripped = stripIncompleteScanBuffers(resumed);
            await replaceScanSessionPacketPages(item.sessionId, fallbackPacketPages);
            await saveIncompleteScan(stripped);
            updateIncompleteScan(stripped);
            setResumeScan(item.sessionId, null, resumedStats, {
              authority: 'local-cache',
            });
          } catch (error) {
            const packets = flattenPacketPages(fallbackPacketPages);
            logger.error('Failed to persist local packets before resume', {
              error: error instanceof Error ? error.message : String(error),
              sessionId: item.sessionId,
            });
            updateIncompleteScan(resumed);
            setResumeScan(item.sessionId, packets, resumedStats, {
              authority: 'local-cache',
            });
          }
          navigateToScanner();
          return;
        } catch (error) {
          const fallback = stripIncompleteScanBuffers(item);
          logger.error('Failed to prepare local scan resume', {
            error: error instanceof Error ? error.message : String(error),
            sessionId: item.sessionId,
          });
          updateIncompleteScan(fallback);
          setResumeScan(item.sessionId, null, stats, { authority: 'local-cache' });
          navigateToScanner();
        }
      })().catch((error) => {
        logger.error('Failed to restore local packets for resume', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: item.sessionId,
        });
      });
    },
    [
      hydrateRemotePacketPages,
      navigateToScanner,
      resumePreparationFailedMessage,
      setResumeScan,
      showToast,
      updateIncompleteScan,
      uploadConfig,
    ]
  );

  return { handleResume };
}
