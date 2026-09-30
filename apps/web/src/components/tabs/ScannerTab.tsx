/**
 * ScannerTab component - Wrapper for the Scanner component
 */

import React, { useCallback, useRef } from 'react';
import Scanner from '../../features/scanner/Scanner';
import { useHistoryStore, useSettingsStore } from '../../store';
import type { IncompleteScanItem, HistoryItem } from '../../types';
import {
  saveHistoryItemWithAutoSync,
  saveIncompleteScan,
} from '../../services/historyDB';
import {
  appendScanSessionPackets,
  deleteScanSessionChunks,
  deleteScanSessionPackets,
} from '@web/services/scanSessionDB';
import { stripHistoryItemData } from '../../utils/history';
import { normalizeScanFilename, resolveIncompleteScanName } from '../../utils/format';
import {
  getIncompleteScanSessionKeys,
  stripIncompleteScanBuffers,
} from '../../utils/incompleteSync';
import { globalHas } from '../../parse/wire';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ui:scannerTab');

const ScannerTab: React.FC = () => {
  const autoContinue =
    globalHas('window')
      ? new URLSearchParams(window.location.search).get('autoContinue') === '1'
      : false;

  const {
    updateIncompleteScan,
    removeIncompleteScan,
    addItem,
    resumeSessionId,
    resumePackets,
    resumeStats,
    resumeAuthority,
    clearResumeScan,
    setResumeScan,
  } = useHistoryStore();
  const { uploadConfig } = useSettingsStore();
  const lastScanRef = useRef<IncompleteScanItem | null>(null);
  const packetCursorRef = useRef<Map<string, number>>(new Map());
  const packetWriteQueueRef = useRef<Map<string, Promise<void>>>(new Map());

  const queuePacketPersistence = useCallback(
    (
      scan: IncompleteScanItem,
      packetStartIndex: number | undefined,
      packetDelta: Uint8Array[]
    ) => {
      const sessionId = scan.sessionId;
      const hasPacketDelta =
        Number.isFinite(packetStartIndex) && packetDelta.length > 0;
      const safeStartIndex = hasPacketDelta ? Number(packetStartIndex) : 0;
      const currentCursor = packetCursorRef.current.get(sessionId) ?? safeStartIndex;
      const previousWrite =
        packetWriteQueueRef.current.get(sessionId) ?? Promise.resolve();

      let effectiveStartIndex = safeStartIndex;
      let effectiveDelta = packetDelta;

      if (hasPacketDelta && effectiveStartIndex < currentCursor) {
        const overlap = currentCursor - effectiveStartIndex;
        if (overlap >= effectiveDelta.length) {
          effectiveDelta = [];
          effectiveStartIndex = currentCursor;
        } else {
          effectiveDelta = effectiveDelta.slice(overlap);
          effectiveStartIndex = currentCursor;
        }
      }

      if (hasPacketDelta && effectiveDelta.length > 0 && effectiveStartIndex > currentCursor) {
        logger.warn('Packet persistence gap detected', {
          sessionId,
          currentCursor,
          startIndex: effectiveStartIndex,
          packetCount: effectiveDelta.length,
        });
      }

      if (hasPacketDelta && effectiveDelta.length > 0) {
        packetCursorRef.current.set(
          sessionId,
          effectiveStartIndex + effectiveDelta.length
        );
      }

      const writePromise = previousWrite
        .catch(() => undefined)
        .then(async () => {
          if (hasPacketDelta && effectiveDelta.length > 0) {
            await appendScanSessionPackets(sessionId, effectiveStartIndex, effectiveDelta);
          }
          await saveIncompleteScan(stripIncompleteScanBuffers(scan));
        })
        .catch((error) => {
          logger.error('Failed to persist incomplete scan session', {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
            startIndex: effectiveStartIndex,
            packetCount: effectiveDelta.length,
            received: scan.received,
            total: scan.total,
          });
          if (hasPacketDelta && effectiveDelta.length > 0) {
            packetCursorRef.current.set(sessionId, currentCursor);
          }
        })
        .finally(() => {
          if (packetWriteQueueRef.current.get(sessionId) === writePromise) {
            packetWriteQueueRef.current.delete(sessionId);
          }
        });
      packetWriteQueueRef.current.set(sessionId, writePromise);
    },
    []
  );

  const handleScanProgress = useCallback(
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
    }) => {
      if (!stats.sessionId) {
        clearResumeScan();
        return;
      }
      if (stats.received <= 0) return;

      const prev = lastScanRef.current;
      const existing = useHistoryStore.getState().incompleteItems.find(
        (item) => getIncompleteScanSessionKeys(item).includes(stats.sessionId)
      );
      const isServerBacked = Boolean(
        existing &&
          (existing.source === 'server' || existing.remoteSessionId)
      );
      const isServerEvent = stats.source === 'server';

      let safeReceived = stats.received;
      let safeTotal = stats.total;
      const safeTotalIsEstimate = stats.totalIsEstimate ?? prev?.totalIsEstimate ?? true;
      let safeChunksSaved = stats.chunksSaved ?? prev?.chunksSaved ?? 0;

      if (prev && prev.sessionId === stats.sessionId) {
        if (!isServerEvent && stats.received < prev.received) {
          safeReceived = prev.received;
        }
        if (!isServerEvent && stats.total > 0 && stats.total < prev.total) {
          safeTotal = prev.total;
        }
        if ((prev.chunksSaved || 0) > safeChunksSaved) {
          safeChunksSaved = prev.chunksSaved || safeChunksSaved;
        }
      }

      if (safeTotalIsEstimate && safeReceived > safeTotal) {
        safeTotal = safeReceived;
      }

      const normalizedCurrent = normalizeScanFilename(stats.filename);
      const normalizedPrevious = normalizeScanFilename(prev?.filename);
      const displayFilename =
        normalizedCurrent ||
        normalizedPrevious ||
        resolveIncompleteScanName(stats.filename, stats.sessionId);

      const scan: IncompleteScanItem = {
        sessionId: stats.sessionId,
        filename: displayFilename,
        received: safeReceived,
        total: safeTotal,
        totalIsEstimate: safeTotalIsEstimate,
        progressPercent: stats.progressPercent ?? prev?.progressPercent,
        date: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        chunksCompleted: stats.chunksCompleted,
        totalChunks: stats.totalChunks,
        chunksSaved: safeChunksSaved,
        source: isServerEvent || isServerBacked ? 'server' : 'local',
        remoteSessionId: isServerEvent || isServerBacked
          ? existing?.remoteSessionId || existing?.sessionId || stats.sessionId
          : undefined,
        deviceId: existing?.deviceId,
        deviceName: stats.deviceName || existing?.deviceName,
      };
      const compactScan = stripIncompleteScanBuffers(scan);
      const packetDelta = stats.packetDelta || [];

      lastScanRef.current = compactScan;
      updateIncompleteScan(compactScan);
      setResumeScan(
        compactScan.sessionId,
        null,
        {
          received: compactScan.received,
          total: compactScan.total,
          filename: compactScan.filename,
        },
        { authority: resumeAuthority ?? 'local-cache' }
      );

      if (
        !isServerEvent &&
        (packetDelta.length > 0 || compactScan.chunksSaved !== existing?.chunksSaved)
      ) {
        queuePacketPersistence(
          compactScan,
          Number.isFinite(stats.packetStartIndex)
            ? Number(stats.packetStartIndex)
            : undefined,
          packetDelta
        );
      }
    },
    [
      clearResumeScan,
      queuePacketPersistence,
      resumeAuthority,
      setResumeScan,
      updateIncompleteScan,
    ]
  );

  const handleScanComplete = useCallback(
    (item: HistoryItem) => {
      saveHistoryItemWithAutoSync(item, uploadConfig).catch((error) => {
        logger.error('Failed to save history item', { error: error instanceof Error ? error.message : String(error), itemId: item.id });
      });
      addItem(stripHistoryItemData(item));
      const sessionCandidates = new Set<string>();
      if (item.origin === 'scanned') {
        sessionCandidates.add(item.id);
        if (item.remoteSessionId) {
          sessionCandidates.add(item.remoteSessionId);
        }
      }
      if (lastScanRef.current?.sessionId) {
        sessionCandidates.add(lastScanRef.current.sessionId);
      }
      if (resumeSessionId) {
        sessionCandidates.add(resumeSessionId);
      }
      for (const sessionId of sessionCandidates) {
        removeIncompleteScan(sessionId);
        packetCursorRef.current.delete(sessionId);
        packetWriteQueueRef.current.delete(sessionId);
        void deleteScanSessionPackets(sessionId).catch((error) => {
          logger.debug('Failed to delete persisted scan session packets', {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          });
        });
        void deleteScanSessionChunks(sessionId).catch((error) => {
          logger.debug('Failed to delete persisted scan session chunks', {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
          });
        });
      }
      lastScanRef.current = null;
      clearResumeScan();
    },
    [addItem, clearResumeScan, removeIncompleteScan, resumeSessionId, uploadConfig]
  );

  return (
    <div className="flex flex-col h-full">
      <Scanner
        resumeMode={Boolean(resumeSessionId)}
        resumeSessionId={resumeSessionId || undefined}
        resumeAuthority={resumeAuthority || undefined}
        storedPackets={resumePackets || []}
        resumeStats={resumeStats || undefined}
        onScanProgress={handleScanProgress}
        onScanComplete={handleScanComplete}
        onClose={clearResumeScan}
        autoContinue={autoContinue}
      />
    </div>
  );
};

export default ScannerTab;
