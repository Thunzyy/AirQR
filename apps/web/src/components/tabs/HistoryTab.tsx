/**
 * HistoryTab component - Full history view with preview and resume support
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import History from '../../features/history/History';
import QrGifViewer from '../media/QrGifViewer';
import { useHistoryStore, useSettingsStore, useToastStore } from '../../store';
import {
  normalizeHistoryItem,
  resolveHistoryPreviewKind,
  resolveHistoryItemSortTimestamp,
  toZipFilename,
} from '../../utils/history';
import { asWireObject, asWireString, type WireValue } from '../../parse/wire';
import { formatDateCategory, formatSize, formatScanDisplayName } from '../../utils/format';
import { unzipFilesInWorker } from '../../utils/zipWorker';
import Icon from '../ui/Icon';
import NoteCodeViewer from '../note/NoteCodeViewer';
import type {
  HistoryItem,
  IncompleteScanItem,
  ResumeAuthority,
  ScanUploadConfig,
} from '../../types';
import { createLogger } from '../../utils/logger';
import {
  deleteHistoryItem,
  getHistoryItemById,
  getIncompleteScanById,
  loadHistoryFromIndexedDB,
  loadIncompleteScans,
  markHistoryItemAsLocalOnly,
  enableSyncForHistoryItem,
  saveHistoryItem,
  markHistoryItemAsSynced,
  clearSyncFailedStatus,
  markHistoryItemAsSyncFailed,
} from '../../services/historyDB';
import {
  deleteServerSession,
  deleteServerHistoryItem,
  fetchServerFile,
  fetchServerHistoryFile,
  fetchServerHistory,
  fetchServerPackets,
  fetchServerSession,
} from '../../services/scanSyncService';
import { deleteIncompleteScan, saveIncompleteScan } from '../../services/historyDB';
import {
  appendScanSessionPackets,
  countScanSessionPackets,
  deleteScanSessionChunks,
  deleteScanSessionPackets,
  replaceScanSessionPacketPages,
  visitScanSessionPacketPages,
} from '@web/services/scanSessionDB';
import { queueHistoryItem, queueScanComplete, queueScanPacket } from '../../services/scanUploadService';
import {
  getWebSocketSyncService,
  type WebSocketEvent,
} from '../../services/websocketSyncService';
import { canOptimisticallyAttemptServerSync } from '../../services/serverAuth';
import { useServerAuthState } from '../../hooks/useServerAuthState';
import {
  generateSessionId,
  saveMultiviewSession,
  blobUrlToUint8Array,
} from '../../utils/multiviewStorage';
import {
  getLegacyIncompleteScanPackets,
  mergeIncompleteScanItems,
  stripIncompleteScanBuffers,
} from '../../utils/incompleteSync';
import { shouldDeleteRemoteIncompleteSession } from '../../utils/remoteIncompleteDeletion';
import {
  getBinaryDataSize,
  toBinaryBlob,
  toUint8Array,
} from '../../utils/binaryData';
import { decodeNoteContent } from '../../utils/noteDetection';
import {
  countPacketPages,
  getLegacyPacketPages,
  type LocalPacketPage,
  type LocalPacketSource,
} from '../../utils/historyPackets';
import { useHistoryBackfill } from '../../hooks/useHistoryBackfill';
import { useHistoryResume } from '../../hooks/useHistoryResume';
import {
  acknowledgeRemoteHistoryDurablePurge,
  beginRemoteHistoryStaleSource,
  captureRemoteHistoryTombstoneVersion,
  isHistoryItemTombstoned,
  isIncompleteScanTombstoned,
  getRemoteHistoryServerScope,
  matchesRemoteHistoryDeletion,
  matchesRemoteIncompleteDeletion,
  recordRemoteHistoryDeletion,
  reconcileRemoteHistoryTombstones,
  withoutTombstonedHistoryItems,
  withoutTombstonedIncompleteScans,
} from '../../features/history/historyTombstones';

const logger = createLogger('ui:historyTab');
const REMOTE_RESUME_PACKET_FETCH_LIMIT = 1024;
type RemotePacketHydrationOptions = {
  authority?: ResumeAuthority;
};

function registerHistoryItemLookup(
  map: Map<string, HistoryItem>,
  item: HistoryItem
): void {
  const keys = [item.id, item.serverId, item.remoteSessionId, item.remoteHistoryId];
  for (const key of keys) {
    if (key) {
      map.set(key, item);
    }
  }
}

function toPositiveInteger(value: WireValue | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

const HistoryTab: React.FC = () => {
  const { t } = useTranslation();
  const {
    items,
    incompleteItems,
    removeItem,
    addItem,
    setItems,
    clearHistory: clearHistoryState,
    removeIncompleteScan,
    updateIncompleteScan,
    setResumeScan,
  } = useHistoryStore();
  const { uploadConfig } = useSettingsStore();
  const showToast = useToastStore((s) => s.show);
  const { url: serverUrl } = uploadConfig;
  const serverScope = useMemo(
    () => getRemoteHistoryServerScope(serverUrl),
    [serverUrl]
  );
  const {
    authEnabled,
    authorized,
    checking: authStatusChecking,
    connectionError: authConnectionError,
    authReady,
  } = useServerAuthState(uploadConfig);
  const canAttemptServerSync =
    authReady || canOptimisticallyAttemptServerSync(uploadConfig);
  const shouldSync = canAttemptServerSync;
  const [remoteItems, setRemoteItems] = useState<HistoryItem[]>([]);
  const [remoteIncompleteItems, setRemoteIncompleteItems] = useState<
    IncompleteScanItem[]
  >([]);
  const [remoteHistoryReady, setRemoteHistoryReady] = useState(false);
  const [remoteSyncReachable, setRemoteSyncReachable] = useState(false);
  const historyEtagRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  const incompleteItemsRef = useRef(incompleteItems);
  const remoteItemsRef = useRef(remoteItems);
  const uploadConfigRef = useRef<ScanUploadConfig>(uploadConfig);
  const shouldSyncRef = useRef(shouldSync);
  const remoteIncompleteItemsRef = useRef(remoteIncompleteItems);
  const [, setLocation] = useLocation();

  const [historyPreview, setHistoryPreview] = useState<{
    item: HistoryItem;
    kind?: ReturnType<typeof resolveHistoryPreviewKind>;
    gifUrl?: string;
    previewUrl?: string;
    noteContent?: string;
  } | null>(null);
  const [historyPreviewChunks, setHistoryPreviewChunks] = useState<string[]>([]);
  const [isOpeningMultiView, setIsOpeningMultiView] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0);
  const historyPreviewDialogTitleId = useId();
  const historyPreviewDialogDescriptionId = useId();
  const historyPreviewDialogRef = useRef<HTMLDivElement | null>(null);
  const historyPreviewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyPreviewNoteViewerRef = useRef<HTMLDivElement | null>(null);
  const historyPreviewNoteContentRef = useRef<HTMLPreElement | null>(null);
  const historyPreviewPreviouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    incompleteItemsRef.current = incompleteItems;
  }, [incompleteItems]);

  useEffect(() => {
    remoteItemsRef.current = remoteItems;
  }, [remoteItems]);

  useEffect(() => {
    uploadConfigRef.current = uploadConfig;
  }, [uploadConfig]);

  useEffect(() => {
    shouldSyncRef.current = shouldSync;
  }, [shouldSync]);

  useEffect(() => {
    remoteIncompleteItemsRef.current = remoteIncompleteItems;
  }, [remoteIncompleteItems]);

  const historySyncStatusBadge = !uploadConfig.enabled
    ? {
        label: t('settings.serverSyncStateLocal'),
        className:
          'border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] text-[var(--airqr-text-secondary)]',
      }
      : authStatusChecking
      ? {
          label: t('settings.serverSyncStateChecking'),
          className:
            'airqr-status-warning',
        }
      : authConnectionError
        ? remoteSyncReachable
          ? {
              label: t('settings.serverSyncStateConnected'),
              className:
                'airqr-status-success',
            }
          : {
              label: t('settings.serverSyncStateUnavailable'),
              className:
                'airqr-status-danger',
            }
        : authEnabled
          ? authorized
            ? {
                label: t('settings.serverSyncStateConnected'),
                className:
                  'airqr-status-success',
              }
            : {
                label: t('settings.serverSyncStateCredentials'),
                className:
                  'airqr-status-warning',
              }
          : {
              label: t('settings.serverSyncStateOpen'),
              className:
                'border-[var(--airqr-control-border)] bg-[var(--airqr-accent-soft)] text-[var(--airqr-accent-text)]',
            };

  const displayItems = useMemo(() => {
    const normalizedLocal = withoutTombstonedHistoryItems(
      serverScope,
      items.map(normalizeHistoryItem)
    );
    const normalizedRemote = withoutTombstonedHistoryItems(
      serverScope,
      remoteItems.map(normalizeHistoryItem)
    );

    const remoteMap = new Map<string, HistoryItem>();
    for (const item of normalizedRemote) {
      registerHistoryItemLookup(remoteMap, item);
    }

    const merged: HistoryItem[] = [];
    const seen = new Set<string>();

    for (const localItem of normalizedLocal) {
      if (seen.has(localItem.id)) continue;
      seen.add(localItem.id);

      const remoteKey =
        localItem.serverId ||
        localItem.remoteSessionId ||
        localItem.remoteHistoryId ||
        localItem.id;
      const remoteItem = remoteMap.get(remoteKey) || remoteMap.get(localItem.id);
      if (remoteItem && !localItem.isLocalOnly) {
        merged.push({
          ...localItem,
          isSynced: true,
          serverId: remoteItem.serverId || remoteItem.id,
          source: localItem.source || 'local',
        });
        seen.add(remoteItem.id);
      } else {
        merged.push(localItem);
      }
    }

    for (const remoteItem of normalizedRemote) {
      if (seen.has(remoteItem.id)) continue;
      seen.add(remoteItem.id);
      merged.push(remoteItem);
    }

    return merged;
  }, [items, remoteItems, serverScope]);

  const completedScannedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of displayItems) {
      if (item.origin !== 'scanned') continue;
      ids.add(item.id);
      if (item.remoteSessionId) {
        ids.add(item.remoteSessionId);
      }
      if (item.serverId) {
        ids.add(item.serverId);
      }
    }
    return ids;
  }, [displayItems]);

  const tombstoneFilteredIncompleteItems = useMemo(
    () =>
      withoutTombstonedIncompleteScans(
        serverScope,
        incompleteItems
      ),
    [incompleteItems, serverScope]
  );

  const { clearBackfillState } = useHistoryBackfill({
    incompleteItems: tombstoneFilteredIncompleteItems,
    remoteIncompleteItems,
    setRemoteIncompleteItems,
    completedScannedSessionIds,
    shouldSync,
    remoteHistoryReady,
    uploadConfig,
    removeIncompleteScan,
  });

  const ensureManualHistorySyncReady = useCallback(() => {
    if (!uploadConfig.enabled || !uploadConfig.url) {
      showToast(t('history.enableSyncBeforeUpload'), 'warning');
      return false;
    }

    if (authReady) {
      return true;
    }

    if (authConnectionError) {
      showToast(t('history.syncServerUnavailable'), 'error');
      return false;
    }

    if (authEnabled && !authorized) {
      showToast(t('history.syncSignInRequired'), 'warning');
      return false;
    }

    showToast(t('history.syncServerUnavailable'), 'warning');
    return false;
  }, [
    authConnectionError,
    authEnabled,
    authReady,
    authorized,
    showToast,
    t,
    uploadConfig.enabled,
    uploadConfig.url,
  ]);

  const removeServerBackedHistoryItems = useCallback(
    (origin: 'generated' | 'scanned', remoteId: string): Promise<boolean> => {
      const currentItems = useHistoryStore.getState().items;
      const matches = currentItems.filter((item) =>
        matchesRemoteHistoryDeletion(item, origin, remoteId)
      );

      const persistedIds = new Set([remoteId, ...matches.map((item) => item.id)]);
      setItems(
        withoutTombstonedHistoryItems(serverScope, currentItems)
      );
      const persistedItemsPromise = loadHistoryFromIndexedDB();
      return (async () => {
        try {
          const [persistedItems] = await Promise.all([
            persistedItemsPromise,
            Promise.all(
              Array.from(persistedIds, (id) => deleteHistoryItem(id))
            ),
          ]);
          const activeConfig = useSettingsStore.getState().uploadConfig;
          if (
            !activeConfig.enabled ||
            getRemoteHistoryServerScope(activeConfig.url) !== serverScope
          ) {
            return false;
          }
          await Promise.all(
            persistedItems
              .filter((item) =>
                matchesRemoteHistoryDeletion(item, origin, remoteId)
              )
              .map((item) => deleteHistoryItem(item.id))
          );
          return true;
        } catch (error) {
          logger.debug('Failed to inspect persisted history aliases after realtime delete', {
            error: error instanceof Error ? error.message : String(error),
            origin,
            remoteId,
          });
          return false;
        }
      })();
    },
    [serverScope, setItems]
  );

  const removeServerBackedIncompleteItems = useCallback(
    (remoteSessionId: string): Promise<boolean> => {
      const matches = incompleteItemsRef.current.filter((item) =>
        matchesRemoteIncompleteDeletion(item, remoteSessionId)
      );

      const persistedIds = new Set([
        remoteSessionId,
        ...matches.map((item) => item.sessionId),
      ]);
      matches.forEach((item) => {
        clearBackfillState(item.remoteSessionId || item.sessionId);
        removeIncompleteScan(item.sessionId);
      });
      removeIncompleteScan(remoteSessionId);
      const persistedItemsPromise = loadIncompleteScans();
      return (async () => {
        try {
          const [persistedItems] = await Promise.all([
            persistedItemsPromise,
            Promise.all(
              Array.from(persistedIds).flatMap((sessionId) => [
                deleteIncompleteScan(sessionId),
                deleteScanSessionChunks(sessionId),
                deleteScanSessionPackets(sessionId),
              ])
            ),
          ]);
          const activeConfig = useSettingsStore.getState().uploadConfig;
          if (
            !activeConfig.enabled ||
            getRemoteHistoryServerScope(activeConfig.url) !== serverScope
          ) {
            return false;
          }
          await Promise.all(
            persistedItems
              .filter((item) =>
                matchesRemoteIncompleteDeletion(item, remoteSessionId)
              )
              .flatMap((item) => [
                deleteIncompleteScan(item.sessionId),
                deleteScanSessionChunks(item.sessionId),
                deleteScanSessionPackets(item.sessionId),
              ])
          );
          return true;
        } catch (error) {
          logger.debug('Failed to inspect persisted incomplete aliases after realtime delete', {
            error: error instanceof Error ? error.message : String(error),
            remoteSessionId,
          });
          return false;
        }
      })();
    },
    [clearBackfillState, removeIncompleteScan, serverScope]
  );

  const mergeServerItems = useCallback(
    (serverItems: HistoryItem[], isComplete: boolean) => {
      const localItems = withoutTombstonedHistoryItems(serverScope, itemsRef.current);
      const visibleServerItems = withoutTombstonedHistoryItems(
        serverScope,
        serverItems
      );
      const serverById = new Map<string, HistoryItem>();
      for (const item of visibleServerItems) {
        registerHistoryItemLookup(serverById, item);
      }
      const serverIds = new Set(visibleServerItems.map((item) => item.id));
      const merged: HistoryItem[] = [];
      const mergedIds = new Set<string>();
      let changed = false;

      for (const localItem of localItems) {
        if (isComplete && !localItem.isLocalOnly) {
          const serverKey =
            localItem.serverId ||
            localItem.remoteSessionId ||
            localItem.remoteHistoryId ||
            localItem.id;
          const isServerBacked =
            localItem.source === 'server' ||
            localItem.isSynced ||
            Boolean(localItem.serverId) ||
            Boolean(localItem.remoteSessionId) ||
            Boolean(localItem.remoteHistoryId);
          if (isServerBacked && !serverIds.has(serverKey)) {
            changed = true;
            continue;
          }
        }

        const serverKey =
          localItem.serverId ||
          localItem.remoteSessionId ||
          localItem.remoteHistoryId ||
          localItem.id;
        const serverItem = serverById.get(serverKey) || serverById.get(localItem.id);
        if (!serverItem) {
          merged.push(localItem);
          mergedIds.add(localItem.id);
          continue;
        }
        if (localItem.isLocalOnly) {
          merged.push(localItem);
          mergedIds.add(localItem.id);
          continue;
        }

        const hasLocalFile = Boolean(localItem.fileData);
        const mergedItem: HistoryItem = {
          ...serverItem,
          ...localItem,
          origin: serverItem.origin || localItem.origin,
          type: localItem.type || serverItem.type,
          title: localItem.title || serverItem.title,
          subtitle: localItem.subtitle || serverItem.subtitle,
          date: localItem.date || serverItem.date,
          category: localItem.category || serverItem.category,
          mimeType: localItem.mimeType || serverItem.mimeType,
          totalFrames: localItem.totalFrames ?? serverItem.totalFrames,
          minFrames: localItem.minFrames ?? serverItem.minFrames,
          chunkMinFrames: localItem.chunkMinFrames ?? serverItem.chunkMinFrames,
          fileData: localItem.fileData,
          source: localItem.source ?? (hasLocalFile ? 'local' : serverItem.source),
          remoteSessionId: serverItem.remoteSessionId || localItem.remoteSessionId,
          remoteHistoryId: serverItem.remoteHistoryId || localItem.remoteHistoryId,
          isSynced: true,
          serverId: serverItem.id,
          isLocalOnly: false,
        };

        merged.push(mergedItem);
        mergedIds.add(localItem.id);
        mergedIds.add(serverItem.id);
        if (
          !localItem.isSynced ||
          localItem.serverId !== serverItem.id ||
          localItem.origin !== mergedItem.origin ||
          localItem.title !== mergedItem.title ||
          localItem.subtitle !== mergedItem.subtitle ||
          localItem.mimeType !== mergedItem.mimeType
        ) {
          changed = true;
        }
      }

      for (const serverItem of visibleServerItems) {
        if (mergedIds.has(serverItem.id)) continue;
        merged.push(serverItem);
        mergedIds.add(serverItem.id);
        changed = true;
      }

      if (changed) {
        setItems(merged);
      }
    },
    [serverScope, setItems]
  );

  useEffect(() => {
    if (!shouldSync || remoteItems.length === 0) return;
    const remoteIds = new Set(remoteItems.map((item) => item.id));
    const updatedIds: string[] = [];
    const nextItems = itemsRef.current.map((item) => {
      if (
        remoteIds.has(item.id) &&
        !item.isSynced &&
        !item.isLocalOnly
      ) {
        updatedIds.push(item.id);
        return { ...item, isSynced: true, serverId: item.id };
      }
      return item;
    });
    if (updatedIds.length === 0) return;
    setItems(nextItems);
    for (const id of updatedIds) {
      void markHistoryItemAsSynced(id, id);
    }
  }, [remoteItems, setItems, shouldSync]);

  useEffect(() => {
    let cancelled = false;
    const releaseStaleSource = beginRemoteHistoryStaleSource();

    loadHistoryFromIndexedDB()
      .then((localItems) => {
        if (!cancelled) {
          setItems(
            withoutTombstonedHistoryItems(
              serverScope,
              localItems
            )
          );
        }
      })
      .catch((error) => {
        logger.error('Failed to reload local history', { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        releaseStaleSource();
      });

    return () => {
      cancelled = true;
    };
  }, [historyRefreshNonce, serverScope, setItems]);

  useEffect(() => {
    const wsService = getWebSocketSyncService();
    const effectUploadConfig = uploadConfigRef.current;
    let cancelled = false;
    let historyInFlight = false;
    let historyRefreshQueued = false;

    if (!shouldSync) {
      historyEtagRef.current = null;
      setRemoteHistoryReady(false);
      setRemoteSyncReachable(false);
      wsService.disconnect();
      setRemoteItems([]);
      setRemoteIncompleteItems([]);
      return () => {
        cancelled = true;
      };
    }

    historyEtagRef.current = null;
    setRemoteHistoryReady(false);
    setRemoteSyncReachable(false);

    const refresh = async () => {
      if (cancelled) return;
      if (historyInFlight) {
        historyRefreshQueued = true;
        return;
      }
      historyInFlight = true;
      const tombstoneWatermark = captureRemoteHistoryTombstoneVersion();

      try {
        const result = await fetchServerHistory(effectUploadConfig, {
          etag: historyEtagRef.current || undefined,
          limit: 500,
        });
        if (cancelled) return;

        if (result.notModified) {
          return;
        }

        if (result.etag) {
          historyEtagRef.current = result.etag;
        }
        setRemoteSyncReachable(true);

        const entries = result.entries;
        const nextItems: HistoryItem[] = [];
        const nextIncomplete: IncompleteScanItem[] = [];

        for (const entry of entries) {
          const timestamp =
            entry.updatedAt || entry.createdAt || new Date().toISOString();
          const parsed = new Date(timestamp);
          const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
          const dateLabel = safeDate.toISOString().split('T')[0];
          const timeLabel = safeDate.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          const origin = entry.origin || 'scanned';

          if (origin === 'generated') {
            const historyId = entry.historyId || entry.id;
            if (!historyId) continue;
            const title = entry.title || entry.filename || t('history.generatedFile');
            const size = entry.size || 0;

            nextItems.push({
              id: historyId,
              remoteHistoryId: historyId,
              source: 'server',
              origin: 'generated',
              type: 'file',
              title,
              subtitle: `${dateLabel} - ${timeLabel} - ${formatSize(size)}`,
              date: dateLabel,
              sortTimestamp: safeDate.toISOString(),
              size,
              category: formatDateCategory(safeDate),
              mimeType:
                entry.mimeType ||
                (title.endsWith('.zip')
                  ? 'application/zip'
                  : title.endsWith('.gif')
                  ? 'image/gif'
                  : 'application/octet-stream'),
              totalFrames: entry.totalFrames,
              minFrames: entry.minFrames,
              chunkMinFrames: entry.chunkMinFrames,
              isSynced: true,
              serverId: historyId,
            });
            continue;
          }

          if (origin !== 'scanned') {
            continue;
          }

          const sessionId = entry.sessionId || entry.id;
          if (!sessionId) continue;
          // Use filename if available, otherwise extract timestamp from session ID
          // Format: "scan_TIMESTAMP" -> "Scan TIMESTAMP"
          const displayName = entry.filename || formatScanDisplayName(sessionId);
          const size = entry.size || 0;

          if (entry.completed) {
            nextItems.push({
              id: sessionId,
              remoteSessionId: sessionId,
              source: 'server',
              origin: 'scanned',
              type: 'file',
              title: displayName,
              subtitle: `${dateLabel} - ${timeLabel} - ${formatSize(size)}`,
              date: dateLabel,
              sortTimestamp: safeDate.toISOString(),
              size,
              category: formatDateCategory(safeDate),
              mimeType:
                entry.mimeType ||
                (displayName.endsWith('.zip')
                  ? 'application/zip'
                  : 'application/octet-stream'),
              isSynced: true,
              serverId: sessionId,
            });
          } else {
            const received =
              entry.receivedPackets ?? entry.receivedCount ?? entry.packetCount ?? 0;
            const decodeThreshold = toPositiveInteger(
              entry.scanState?.decodeThreshold ??
                entry.decodeThreshold ??
                entry.expectedPackets
            );
            const transmittedTotal = toPositiveInteger(entry.totalPackets);
            const fallbackTotal = toPositiveInteger(entry.totalChunks);
            const total = decodeThreshold || transmittedTotal || fallbackTotal;
            const displayTotal =
              decodeThreshold > 0 ? total : Math.max(total, received);
            const progressPercent = Number(
              entry.scanState?.completionPercent ?? entry.completionPercent
            );
            nextIncomplete.push({
              sessionId,
              remoteSessionId: sessionId,
              source: 'server',
              filename: displayName || t('scanner.scanning'),
              received,
              total: displayTotal,
              totalIsEstimate: decodeThreshold <= 0,
              progressPercent: Number.isFinite(progressPercent)
                ? progressPercent
                : undefined,
              date: timeLabel,
              chunksCompleted: entry.chunksCompleted,
              totalChunks: entry.totalChunks,
              chunksSaved: entry.chunksSaved ?? entry.chunksCompleted,
              // Device identification for cross-device sync
              deviceId: entry.deviceId,
              deviceName: entry.deviceName,
            });
          }
        }

        const visibleItems = withoutTombstonedHistoryItems(
          serverScope,
          nextItems
        );
        const visibleIncomplete = withoutTombstonedIncompleteScans(
          serverScope,
          nextIncomplete
        );
        setRemoteItems(visibleItems);
        setRemoteIncompleteItems(visibleIncomplete);
        const isComplete =
          result.totalCount === undefined ||
          result.totalCount <= entries.length;
        reconcileRemoteHistoryTombstones(
          serverScope,
          tombstoneWatermark,
          nextItems,
          nextIncomplete,
          isComplete
        );
        mergeServerItems(visibleItems, isComplete);
      } catch (error) {
        if (cancelled) return;
        setRemoteSyncReachable(false);
        logger.error('Failed to load server history', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        historyInFlight = false;
        if (!cancelled) {
          setRemoteHistoryReady(true);
          if (historyRefreshQueued) {
            historyRefreshQueued = false;
            void refresh();
          }
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    void refresh();
    wsService.connect(effectUploadConfig);

    // Subscribe to WebSocket events for real-time updates
    const unsubscribeWs = wsService.subscribe((event: WebSocketEvent) => {
      if (cancelled) return;
      logger.info('HistoryTab received WebSocket event', { type: event.type });
      // SAFETY: websocket events carry a JSON object payload.
      const payload = asWireObject(event.payload as WireValue);
      const rawSessionId = payload.sessionId;
      const sessionId =
        asWireString(rawSessionId) ??
        (rawSessionId != null ? String(rawSessionId) : null);
      const isScanCompleteEvent =
        event.type === 'scan-complete' ||
        (event.type === 'history' && payload.type === 'scan-complete');

      if (isScanCompleteEvent) {
        if (sessionId) {
          clearBackfillState(sessionId);
          setRemoteIncompleteItems((prev) =>
            prev.filter(
              (i) =>
                i.sessionId !== sessionId &&
                (i.remoteSessionId || i.sessionId) !== sessionId
            )
          );
          removeIncompleteScan(sessionId);
          void Promise.allSettled([
            deleteIncompleteScan(sessionId),
            deleteScanSessionChunks(sessionId),
            deleteScanSessionPackets(sessionId),
          ]).then((results) => {
            results.forEach((result) => {
              if (result.status === 'rejected') {
                logger.debug('Failed to purge local incomplete after scan-complete', {
                  error: result.reason,
                  sessionId,
                });
              }
            });
          });
        }
        void refresh();
      } else if (event.type === 'history' || event.type === 'scan-progress') {
        if (event.type === 'history' && payload.kind === 'connection-ready') {
          setRemoteSyncReachable(true);
        }
        // Refresh history when events arrive
        void refresh();
      } else if (event.type === 'delete') {
        if (payload.origin === 'scanned' && payload.sessionId) {
          const remoteId = String(payload.sessionId);
          const tombstoneVersion = recordRemoteHistoryDeletion(
            serverScope,
            'scanned',
            remoteId
          );
          setRemoteItems((prev) =>
            prev.filter(
              (item) =>
                !isHistoryItemTombstoned(serverScope, item)
            )
          );
          setRemoteIncompleteItems((prev) =>
            prev.filter(
              (item) =>
                !isIncompleteScanTombstoned(serverScope, item)
            )
          );
          void Promise.all([
            removeServerBackedHistoryItems('scanned', remoteId),
            removeServerBackedIncompleteItems(remoteId),
          ]).then((purgesSucceeded) => {
            if (purgesSucceeded.every(Boolean)) {
              acknowledgeRemoteHistoryDurablePurge(
                serverScope,
                'scanned',
                remoteId,
                tombstoneVersion
              );
            }
          });
          void refresh();
        } else if (payload.origin === 'generated' && payload.historyId) {
          const remoteId = String(payload.historyId);
          const tombstoneVersion = recordRemoteHistoryDeletion(
            serverScope,
            'generated',
            remoteId
          );
          setRemoteItems((prev) =>
            prev.filter(
              (item) =>
                !isHistoryItemTombstoned(serverScope, item)
            )
          );
          void removeServerBackedHistoryItems('generated', remoteId).then(
            (purgeSucceeded) => {
              if (purgeSucceeded) {
                acknowledgeRemoteHistoryDurablePurge(
                  serverScope,
                  'generated',
                  remoteId,
                  tombstoneVersion
                );
              }
            }
          );
          void refresh();
        }
      }
    });

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribeWs();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials are read via uploadConfigRef to avoid reconnect loops
  }, [
    clearBackfillState,
    mergeServerItems,
    removeIncompleteScan,
    removeServerBackedHistoryItems,
    removeServerBackedIncompleteItems,
    serverUrl,
    historyRefreshNonce,
    shouldSync,
  ]);

  const displayIncompleteItems = useMemo(() => {
    return mergeIncompleteScanItems(
      tombstoneFilteredIncompleteItems,
      withoutTombstonedIncompleteScans(
        serverScope,
        remoteIncompleteItems
      )
    ).filter((item) => {
        const key = item.remoteSessionId || item.sessionId;
        return (
          !completedScannedSessionIds.has(item.sessionId) &&
          !completedScannedSessionIds.has(key)
        );
      });
  }, [
    tombstoneFilteredIncompleteItems,
    remoteIncompleteItems,
    serverScope,
    completedScannedSessionIds,
  ]);

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

  const hydrateRemotePacketPages = useCallback(
    async (
      localSessionId: string,
      remoteSessionId: string,
      config: typeof uploadConfig,
      options?: RemotePacketHydrationOptions
    ): Promise<number> => {
      if (options?.authority === 'server') {
        return 0;
      }

      await deleteScanSessionPackets(localSessionId);

      let offset = 0;
      let totalCount: number | null = null;

      while (true) {
        const response = await fetchServerPackets(config, remoteSessionId, {
          offset,
          limit: REMOTE_RESUME_PACKET_FETCH_LIMIT,
        });

        if (response.packets.length === 0) {
          return totalCount ?? offset;
        }

        await appendScanSessionPackets(localSessionId, offset, response.packets);
        offset += response.packets.length;
        totalCount = response.totalCount;

        if (!response.hasMore) {
          return totalCount ?? offset;
        }
      }
    },
    []
  );

  const navigateToScanner = useCallback(() => {
    setLocation('/scanner');
  }, [setLocation]);

  const { handleResume } = useHistoryResume({
    uploadConfig,
    hydrateRemotePacketPages,
    navigateToScanner,
    resumePreparationFailedMessage: t('history.resumePreparationFailed'),
    setResumeScan,
    showToast,
    updateIncompleteScan,
  });

  const cleanupPreview = useCallback(() => {
    if (historyPreview?.gifUrl) {
      URL.revokeObjectURL(historyPreview.gifUrl);
    }
    if (
      historyPreview?.previewUrl &&
      historyPreview.previewUrl !== historyPreview.gifUrl
    ) {
      URL.revokeObjectURL(historyPreview.previewUrl);
    }
    historyPreviewChunks.forEach((url) => URL.revokeObjectURL(url));
    setHistoryPreviewChunks([]);
    setHistoryPreview(null);
    setIsOpeningMultiView(false);
  }, [historyPreview, historyPreviewChunks]);

  useEffect(() => {
    if (!historyPreview) {
      return;
    }

    historyPreviewPreviouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusableElements = (): HTMLElement[] => {
      const container = historyPreviewDialogRef.current;
      if (!container) {
        return [];
      }

      const focusableSelector = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ');

      return Array.from(
        container.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((element) => !element.hasAttribute('disabled'));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanupPreview();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    const focusFrame = window.requestAnimationFrame(() => {
      if (historyPreview.noteContent) {
        historyPreviewNoteViewerRef.current?.focus({ preventScroll: true });
        return;
      }

      historyPreviewCloseButtonRef.current?.focus();
    });

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      historyPreviewPreviouslyFocusedRef.current?.focus();
      historyPreviewPreviouslyFocusedRef.current = null;
    };
  }, [cleanupPreview, historyPreview]);

  const resolveHistoryItemData = async (
    item: HistoryItem
  ): Promise<HistoryItem | null> => {
    if (item.fileData) {
      return item;
    }
    if (item.source === 'server') {
      try {
          if (item.origin === 'generated' && item.remoteHistoryId) {
            const file = await fetchServerHistoryFile(
              uploadConfig,
              item.remoteHistoryId
            );
            const resolvedTitle =
              item.title && !item.title.endsWith('.zip')
                ? item.title
                : file.filename || item.title;
            return {
              ...item,
              title: resolvedTitle,
              mimeType: file.mimeType || item.mimeType,
              fileData: file.data,
            };
          }
          if (item.remoteSessionId) {
            const file = await fetchServerFile(uploadConfig, item.remoteSessionId);
            return {
              ...item,
              title: file.filename || item.title,
              mimeType: file.mimeType || item.mimeType,
              fileData: file.data,
            };
          }
      } catch (error) {
        logger.error('Failed to fetch server file', { error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    }
    const stored = await getHistoryItemById(item.id);
    return stored ? normalizeHistoryItem(stored) : null;
  };

  const handleDownload = async (item: HistoryItem) => {
    const resolved = await resolveHistoryItemData(item);
    if (!resolved?.fileData) {
      logger.debug('History item data not found', { itemId: item.id });
      return;
    }

    const mimeType = resolved.mimeType || 'application/octet-stream';
    const blob = toBinaryBlob(resolved.fileData, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

      let filename = resolved.title;
      if (mimeType === 'image/gif' && !filename.endsWith('.gif')) {
        filename += '.gif';
      } else if (mimeType === 'application/zip') {
        filename = toZipFilename(filename);
      } else if (mimeType === 'text/plain' && !filename.includes('.')) {
        filename += '.txt';
      }

    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openMultiChunkView = async () => {
    if (historyPreviewChunks.length === 0 || isOpeningMultiView) return;

    setIsOpeningMultiView(true);
    try {
      // Convert blob URLs to Uint8Arrays and store in IndexedDB
      const chunkData = await Promise.all(
        historyPreviewChunks.map((url) => blobUrlToUint8Array(url))
      );

      const sessionId = generateSessionId();

      // Store metadata in IndexedDB
      await saveMultiviewSession(sessionId, chunkData, 'image/gif', {
        filename: historyPreview?.item.title,
        chunkMinFrames: historyPreview?.item.chunkMinFrames,
      });

      window.open(
        `/multi-chunk.html?session=${sessionId}`,
        '_blank',
        'noopener,noreferrer'
      );
    } catch (error) {
      logger.error('Failed to open multi-chunk view', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsOpeningMultiView(false);
    }
  };

  const handleDelete = (item: HistoryItem) => {
    const allowServerDelete = !item.isLocalOnly && (item.source === 'server' || item.isSynced);

    if (allowServerDelete) {
      if (item.origin === 'generated') {
        const historyId = item.remoteHistoryId || item.serverId || item.id;
        deleteServerHistoryItem(uploadConfig, historyId)
          .then(() => {
            setRemoteItems((prev) => prev.filter((i) => i.id !== historyId));
            removeItem(item.id);
          })
          .catch((error) => {
            logger.error('Failed to delete server history item', { error: error instanceof Error ? error.message : String(error) });
          });
        return;
      }
      if (item.origin === 'scanned') {
        const sessionId = item.remoteSessionId || item.serverId || item.id;
        deleteServerSession(uploadConfig, sessionId)
          .then(() => {
            setRemoteItems((prev) => prev.filter((i) => i.id !== sessionId));
            removeItem(item.id);
          })
          .catch((error) => {
            logger.error('Failed to delete server session', { error: error instanceof Error ? error.message : String(error) });
          });
        return;
      }
    }

    removeItem(item.id);
  };

  const handleDeleteIncomplete = async (item: IncompleteScanItem) => {
    clearBackfillState(item.remoteSessionId || item.sessionId);
    // Delete from server if remote
    if (item.remoteSessionId) {
      let shouldDeleteRemote = false;
      let shouldRemoveRemoteRow = true;
      try {
        const session = await fetchServerSession(uploadConfig, item.remoteSessionId);
        shouldDeleteRemote = shouldDeleteRemoteIncompleteSession(session);
        if (!session) {
          logger.info('Skipping remote delete for missing server session', {
            sessionId: item.sessionId,
            remoteSessionId: item.remoteSessionId,
          });
        } else if (!shouldDeleteRemote) {
          logger.warn('Refusing to delete completed server session from stale incomplete row', {
            sessionId: item.sessionId,
            remoteSessionId: item.remoteSessionId,
          });
        }
      } catch (error) {
        shouldRemoveRemoteRow = false;
        logger.warn('Failed to verify server session before deleting incomplete row', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: item.sessionId,
          remoteSessionId: item.remoteSessionId,
        });
      }

      if (shouldDeleteRemote) {
        try {
          await deleteServerSession(uploadConfig, item.remoteSessionId);
        } catch (error) {
          shouldRemoveRemoteRow = false;
          logger.error('Failed to delete server session', { error: error instanceof Error ? error.message : String(error) });
        }
      }

      if (shouldRemoveRemoteRow) {
        setRemoteIncompleteItems((prev) =>
          prev.filter(
            (i) =>
              i.sessionId !== item.sessionId &&
              (i.remoteSessionId || i.sessionId) !== item.remoteSessionId
          )
        );
      }
    }

    // Delete from local IndexedDB
    try {
      await deleteIncompleteScan(item.sessionId);
      await deleteScanSessionChunks(item.sessionId);
      await deleteScanSessionPackets(item.sessionId);
    } catch (error) {
      logger.error('Failed to delete from IndexedDB', { error: error instanceof Error ? error.message : String(error) });
    }

    // Remove from store
    removeIncompleteScan(item.sessionId);
  };

  const handleSyncIncomplete = async (item: IncompleteScanItem) => {
    logger.info('handleSyncIncomplete called', {
      sessionId: item.sessionId,
      uploadEnabled: uploadConfig.enabled,
      syncScanned: uploadConfig.syncScanned,
      source: item.source,
      remoteSessionId: item.remoteSessionId,
    });

    if (!ensureManualHistorySyncReady()) {
      return;
    }
    // syncScanned defaults to true if not set
    if (uploadConfig.syncScanned === false) {
      showToast(t('history.syncScannedDisabled'), 'warning');
      return;
    }
    if (item.source === 'server' || item.remoteSessionId) {
      logger.debug('Incomplete scan already synced or server-backed', {
        sessionId: item.sessionId,
      });
      return;
    }

    try {
      const stored = await getIncompleteScanById(item.sessionId);
      logger.info('Retrieved stored incomplete scan', {
        sessionId: item.sessionId,
        hasStored: Boolean(stored),
        storedPacketsCount: getLegacyIncompleteScanPackets(stored).length,
      });

      const packetSource = await getLocalPacketSource(
        item.sessionId,
        getLegacyIncompleteScanPackets(stored)
      );
      const packetCount = packetSource.packetCount;

      if (packetCount === 0) {
        logger.warn('Cannot sync incomplete scan - no packets found', {
          sessionId: item.sessionId,
        });
        return;
      }

      logger.info('Syncing incomplete scan packets', {
        sessionId: item.sessionId,
        packetCount,
      });

      const filename = stored?.filename || item.filename;
      const received = stored?.received ?? item.received;
      const total = stored?.total ?? item.total;
      const chunksCompleted = stored?.chunksCompleted ?? item.chunksCompleted;
      const totalChunks = stored?.totalChunks ?? item.totalChunks;
      const chunksSaved = stored?.chunksSaved ?? item.chunksSaved;

      await packetSource.visit((page) => {
        page.packets.forEach((packet, offset) => {
          const packetIndex = page.startIndex + offset;
          const isStreaming =
            packet.length >= 31 && (packet[0] === 1 || packet[0] === 2);
          queueScanPacket(
            packet,
            {
              sessionId: item.sessionId,
              filename,
              isStreaming,
              packetIndex,
              receivedPackets: received,
              expectedPackets: total,
              totalPackets: total,
              chunksCompleted,
              totalChunks,
              chunksSaved,
            },
            uploadConfig
          );
        });
      });

      updateIncompleteScan(stripIncompleteScanBuffers({
        ...item,
        filename,
        received,
        total,
        chunksCompleted,
        totalChunks,
        chunksSaved,
        remoteSessionId: item.remoteSessionId || item.sessionId,
        source: item.source ?? 'local',
      }));
    } catch (error) {
      logger.error('Failed to sync incomplete scan', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: item.sessionId,
      });
    }
  };

  const handleKeepLocalIncomplete = async (item: IncompleteScanItem) => {
    logger.info('handleKeepLocalIncomplete called', {
      sessionId: item.sessionId,
      source: item.source,
      remoteSessionId: item.remoteSessionId,
    });

    try {
      // Get existing local data if any
      const existingLocal = await getIncompleteScanById(item.sessionId);

      // If item is from server, we need to fetch packets first then delete from server
      if (item.source === 'server' && item.remoteSessionId) {
        logger.info('Incomplete scan is server-only, fetching packets first', {
          sessionId: item.sessionId,
          remoteSessionId: item.remoteSessionId,
        });

        try {
          const session = await fetchServerSession(uploadConfig, item.remoteSessionId);
          if (!shouldDeleteRemoteIncompleteSession(session)) {
            if (!session) {
              logger.info('Aborting keep-local for missing remote incomplete session', {
                sessionId: item.sessionId,
                remoteSessionId: item.remoteSessionId,
              });
            } else {
              logger.warn('Refusing to convert completed remote session into local incomplete item', {
                sessionId: item.sessionId,
                remoteSessionId: item.remoteSessionId,
              });
            }
            return;
          }
        } catch (error) {
          logger.warn('Failed to verify remote incomplete session before keeping local copy', {
            error: error instanceof Error ? error.message : String(error),
            sessionId: item.sessionId,
            remoteSessionId: item.remoteSessionId,
          });
          return;
        }

        const persistedPacketCount = await countScanSessionPackets(item.sessionId);
        const fallbackPacketPages = getLegacyPacketPages(
          getLegacyIncompleteScanPackets(existingLocal)
        );
        const fallbackPacketCount = countPacketPages(fallbackPacketPages);
        const requiredPacketCount = Math.max(
          item.received || 0,
          existingLocal?.received ?? 0
        );
        let packetCount = persistedPacketCount;
        let packetPagesToPersist: LocalPacketPage[] | null = null;

        if (persistedPacketCount < requiredPacketCount) {
          if (fallbackPacketCount >= requiredPacketCount) {
            packetCount = fallbackPacketCount;
            packetPagesToPersist = fallbackPacketPages;
          } else {
            try {
              packetCount = await hydrateRemotePacketPages(
                item.sessionId,
                item.remoteSessionId,
                uploadConfig
              );
              logger.info('Fetched packets from server', {
                sessionId: item.sessionId,
                packetCount,
              });
            } catch (error) {
              logger.error('Failed to fetch packets from server', { error: error instanceof Error ? error.message : String(error) });
              return;
            }
          }
        }

        if (packetPagesToPersist && packetPagesToPersist.length > 0) {
          try {
            await replaceScanSessionPacketPages(
              item.sessionId,
              packetPagesToPersist
            );
          } catch (error) {
            logger.error('Failed to persist packets for keep-local incomplete scan', {
              error: error instanceof Error ? error.message : String(error),
              sessionId: item.sessionId,
            });
            return;
          }
        }

        // Delete from server
        try {
          await deleteServerSession(uploadConfig, item.remoteSessionId);
          logger.info('Deleted session from server', {
            remoteSessionId: item.remoteSessionId,
          });
          setRemoteIncompleteItems((prev) =>
            prev.filter((i) => i.sessionId !== item.sessionId)
          );
        } catch (error) {
          logger.error('Failed to delete from server', { error: error instanceof Error ? error.message : String(error) });
        }

        // Save locally with packets
        const localItem: IncompleteScanItem = {
          ...item,
          source: 'local',
          remoteSessionId: undefined,
        };

        // Update in store (will be auto-saved to IndexedDB by useHistorySync)
        updateIncompleteScan(stripIncompleteScanBuffers(localItem));

        // Also save directly to IndexedDB to ensure metadata and packets are persisted
        await saveIncompleteScan(stripIncompleteScanBuffers(localItem));

        logger.info('Converted server incomplete scan to local-only', {
          sessionId: item.sessionId,
          packetCount,
        });
      } else {
        // Item is already local, just remove remoteSessionId and delete from server
        const localItem: IncompleteScanItem = {
          ...item,
          source: 'local',
          remoteSessionId: undefined,
        };

        // If there was a remoteSessionId, delete from server
        if (item.remoteSessionId) {
          try {
            const session = await fetchServerSession(uploadConfig, item.remoteSessionId);
            if (shouldDeleteRemoteIncompleteSession(session)) {
              await deleteServerSession(uploadConfig, item.remoteSessionId);
              logger.info('Deleted session from server', {
                remoteSessionId: item.remoteSessionId,
              });
              setRemoteIncompleteItems((prev) =>
                prev.filter((i) => i.sessionId !== item.sessionId)
              );
            } else if (!session) {
              logger.info('Skipping remote delete for missing server session during keep-local', {
                sessionId: item.sessionId,
                remoteSessionId: item.remoteSessionId,
              });
            } else {
              logger.warn('Refusing to delete completed remote session during keep-local', {
                sessionId: item.sessionId,
                remoteSessionId: item.remoteSessionId,
              });
            }
          } catch (error) {
            logger.warn('Failed to verify remote session before keep-local delete', {
              error: error instanceof Error ? error.message : String(error),
              sessionId: item.sessionId,
              remoteSessionId: item.remoteSessionId,
            });
          }
        }

        updateIncompleteScan(stripIncompleteScanBuffers(localItem));

        // Also save directly to IndexedDB
        await saveIncompleteScan(stripIncompleteScanBuffers(localItem));

        logger.info('Marked incomplete scan as local-only', {
          sessionId: item.sessionId,
        });
      }
    } catch (error) {
      logger.error('Failed to keep incomplete scan local', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: item.sessionId,
      });
    }
  };

  const handleKeepLocal = async (item: HistoryItem) => {
    try {
      // If item is from server only (not in local IndexedDB), we need to download and save it first
      if (item.source === 'server') {
        logger.debug('Item is server-only, downloading first', { itemId: item.id });

        // Fetch the file data from server
        let fileData: Uint8Array | undefined;
        let filename = item.title;
        let mimeType = item.mimeType;

        try {
          if (item.origin === 'generated' && item.remoteHistoryId) {
            const file = await fetchServerHistoryFile(uploadConfig, item.remoteHistoryId);
            fileData = file.data;
            filename = file.filename || item.title;
            mimeType = file.mimeType || item.mimeType;
          } else if (item.remoteSessionId) {
            const file = await fetchServerFile(uploadConfig, item.remoteSessionId);
            fileData = file.data;
            filename = file.filename || item.title;
            mimeType = file.mimeType || item.mimeType;
          }
        } catch (error) {
          logger.error('Failed to fetch file from server', { error: error instanceof Error ? error.message : String(error) });
          return;
        }

        if (!fileData) {
          logger.debug('Cannot keep local: no file data', { itemId: item.id });
          return;
        }

        // Save to IndexedDB with isLocalOnly flag
        const localItem: HistoryItem = {
          ...item,
          title: filename,
          mimeType,
          size: getBinaryDataSize(fileData),
          fileData,
          source: 'local',
          isSynced: false,
          serverId: undefined,
          isLocalOnly: true,
        };

        await saveHistoryItem(localItem);
        logger.info('Saved item to local storage as local-only', { itemId: item.id });

        // Add to store and remove from remote items to refresh UI
        addItem(localItem);
        setRemoteItems((prev) => prev.filter((i) => i.id !== item.id));
      } else {
        // Item is already in local storage, just mark as local-only
        await markHistoryItemAsLocalOnly(item.id);
        logger.info('Marked item as local-only', { itemId: item.id });

        // Update the item in the store to reflect the change
        // We need to reload from IndexedDB to get the updated item
        const updatedItem = await getHistoryItemById(item.id);
        if (updatedItem) {
          // Remove old and add updated
          removeItem(item.id);
          addItem(updatedItem);
        }
      }
    } catch (error) {
      logger.error('Failed to mark item as local-only', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const markItemSynced = async (id: string) => {
    try {
      await markHistoryItemAsSynced(id, id);
      const nextItems = itemsRef.current.map((item) =>
        item.id === id
          ? { ...item, isSynced: true, serverId: id, isLocalOnly: false }
          : item
      );
      setItems(nextItems);
    } catch (error) {
      logger.error('Failed to mark item as synced', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleSyncItem = async (item: HistoryItem) => {
    if (!ensureManualHistorySyncReady()) {
      return;
    }

    try {
      // Re-enable sync for this item and clear any previous failure status
      await enableSyncForHistoryItem(item.id);
      if (item.syncFailed) {
        await clearSyncFailedStatus(item.id);
        logger.info('Cleared sync failed status for retry', { itemId: item.id });
      }
      logger.info('Re-enabled sync for item', { itemId: item.id });

      // Get the item with file data
      const fullItem = await getHistoryItemById(item.id);
      if (!fullItem?.fileData) {
        logger.debug('Cannot sync item - no file data', { itemId: item.id });
        return;
      }

      const fileData = fullItem.fileData;
      const fileSize = getBinaryDataSize(fileData);

      const idTimestamp = parseInt(fullItem.id, 10);
      const createdAt = !isNaN(idTimestamp) && idTimestamp > 1600000000000
        ? new Date(idTimestamp).toISOString()
        : fullItem.date.includes('T')
          ? fullItem.date
          : new Date(fullItem.date).toISOString();

      // Callback to mark item as sync failed in both DB and store
      const handleSyncFailure = async (error: string) => {
        await markHistoryItemAsSyncFailed(fullItem.id, error);
        // Update store to show failure state
        const updatedItem = await getHistoryItemById(fullItem.id);
        if (updatedItem) {
          removeItem(fullItem.id);
          addItem(updatedItem);
        }
      };

      // Queue for upload with failure handling
      const uploadFilename =
        fullItem.mimeType === 'application/zip'
          ? toZipFilename(fullItem.title)
          : fullItem.title;

      if (fullItem.origin === 'generated') {
        queueHistoryItem(
            fileData,
            {
              historyId: fullItem.id,
              title: fullItem.title,
              filename: uploadFilename,
              mimeType: fullItem.mimeType,
              size: fileSize,
              totalFrames: fullItem.totalFrames,
              minFrames: fullItem.minFrames,
            chunkMinFrames: fullItem.chunkMinFrames,
            createdAt: createdAt,
            updatedAt: createdAt,
          },
          uploadConfig,
          () => markItemSynced(fullItem.id),
          handleSyncFailure
        );
      } else if (fullItem.origin === 'scanned') {
        queueScanComplete(
          fileData,
          {
            sessionId: fullItem.id,
            filename: uploadFilename,
            mimeType: fullItem.mimeType,
            completedAt: createdAt,
          },
          uploadConfig,
          () => markItemSynced(fullItem.id),
          handleSyncFailure
        );
      }

      logger.info('Queued item for sync', { itemId: item.id });

      // Update the store to reflect the change (isLocalOnly is now false, syncFailed cleared)
      removeItem(item.id);
      addItem({
        ...fullItem,
        isLocalOnly: false,
        isSynced: false, // Will become true once server confirms
        syncFailed: false,
        syncFailedAt: undefined,
      });
    } catch (error) {
      logger.error('Failed to sync item', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleSyncToServer = async () => {
    if (isSyncing) return;
    if (!ensureManualHistorySyncReady()) return;

    setIsSyncing(true);
    try {
      // Load all local items from IndexedDB with their file data
      const localItems = await loadHistoryFromIndexedDB();
      logger.info('Sync started', { count: localItems.length });

      let syncedGenerated = 0;
      let syncedScanned = 0;
      let skipped = 0;

      for (const item of localItems) {
        // Skip items that came from server
        if (item.source === 'server') {
          skipped++;
          continue;
        }

        // Skip items marked as local-only (user explicitly detached from server)
        if (item.isLocalOnly) {
          logger.debug('Skipping item - marked as local-only', { itemId: item.id });
          skipped++;
          continue;
        }

        // Skip items that are already synced
        if (item.isSynced) {
          logger.debug('Skipping item - already synced', { itemId: item.id });
          skipped++;
          continue;
        }

        // Skip items without file data
        if (!item.fileData) {
          logger.debug('Skipping item - no file data', { itemId: item.id });
          skipped++;
          continue;
        }

        const fileData = item.fileData;
        const fileSize = getBinaryDataSize(fileData);

        const createdAt = resolveHistoryItemSortTimestamp(item);

        logger.debug('Processing item for sync', {
          origin: item.origin,
          title: item.title,
          itemId: item.id,
          date: createdAt
        });

        const handleBulkSyncFailure = async (error: string) => {
          await markHistoryItemAsSyncFailed(item.id, error);
          const updatedItem = await getHistoryItemById(item.id);
          if (updatedItem) {
            removeItem(item.id);
            addItem(updatedItem);
          }
        };

        if (item.origin === 'generated') {
          const uploadFilename =
            item.mimeType === 'application/zip'
              ? toZipFilename(item.title)
              : item.title;
          // Use queueHistoryItem for generated items
          queueHistoryItem(
            fileData,
            {
              historyId: item.id,
              title: item.title,
              filename: uploadFilename,
              mimeType: item.mimeType,
              size: fileSize,
              totalFrames: item.totalFrames,
              minFrames: item.minFrames,
              chunkMinFrames: item.chunkMinFrames,
              createdAt: createdAt,
              updatedAt: createdAt,
            },
            uploadConfig,
            () => markItemSynced(item.id),
            handleBulkSyncFailure
          );
          syncedGenerated++;
        } else if (item.origin === 'scanned') {
          const uploadFilename =
            item.mimeType === 'application/zip'
              ? toZipFilename(item.title)
              : item.title;
          // Use queueScanComplete for scanned items
          queueScanComplete(
            fileData,
            {
              sessionId: item.id,
              filename: uploadFilename,
              mimeType: item.mimeType,
              completedAt: createdAt,
            },
            uploadConfig,
            () => markItemSynced(item.id),
            handleBulkSyncFailure
          );
          syncedScanned++;
        }
      }

      logger.info('Sync completed', {
        syncedGenerated,
        syncedScanned,
        skipped
      });
    } catch (error) {
      logger.error('Failed to sync history to server', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRefreshHistory = useCallback(() => {
    historyEtagRef.current = null;
    setRemoteHistoryReady(false);
    setHistoryRefreshNonce((value) => value + 1);
  }, []);

  const handleClearHistory = useCallback(async () => {
    const canDeleteRemoteHistory = shouldSyncRef.current;
    const hasRemoteHistory =
      remoteItemsRef.current.length > 0 || remoteIncompleteItemsRef.current.length > 0;
    const confirmed = window.confirm(
      t(
        canDeleteRemoteHistory && hasRemoteHistory
          ? 'history.clearHistoryConfirmRemote'
          : 'history.clearHistoryConfirmLocal'
      )
    );

    if (!confirmed) {
      return;
    }

    setIsClearingHistory(true);

    try {
      if (canDeleteRemoteHistory) {
        const deletedGeneratedIds = new Set<string>();
        const deletedScanIds = new Set<string>();
        const remoteDeletes: Array<Promise<unknown>> = [];

        for (const item of remoteItemsRef.current) {
          if (item.origin === 'generated') {
            const historyId = item.remoteHistoryId || item.serverId || item.id;
            if (deletedGeneratedIds.has(historyId)) {
              continue;
            }
            deletedGeneratedIds.add(historyId);
            remoteDeletes.push(deleteServerHistoryItem(uploadConfigRef.current, historyId));
            continue;
          }

          if (item.origin === 'scanned') {
            const sessionId = item.remoteSessionId || item.serverId || item.id;
            if (deletedScanIds.has(sessionId)) {
              continue;
            }
            deletedScanIds.add(sessionId);
            remoteDeletes.push(deleteServerSession(uploadConfigRef.current, sessionId));
          }
        }

        for (const item of remoteIncompleteItemsRef.current) {
          const sessionId = item.remoteSessionId || item.sessionId;
          if (deletedScanIds.has(sessionId)) {
            continue;
          }
          deletedScanIds.add(sessionId);
          remoteDeletes.push(deleteServerSession(uploadConfigRef.current, sessionId));
        }

        const remoteDeleteResults = await Promise.allSettled(remoteDeletes);
        const failedCount = remoteDeleteResults.filter(
          (result) => result.status === 'rejected'
        ).length;
        if (failedCount > 0) {
          logger.warn('Some remote history entries failed to delete during clear-history', {
            failedCount,
          });
        }
      }

      clearHistoryState();
      setRemoteItems([]);
      setRemoteIncompleteItems([]);
      showToast(t('history.clearHistorySuccess'), 'success');
    } catch (error) {
      logger.error('Failed to clear history', { error: error instanceof Error ? error.message : String(error) });
      showToast(t('errors.error'), 'error');
    } finally {
      setIsClearingHistory(false);
    }
  }, [clearHistoryState, showToast, t]);

  const handleView = async (item: HistoryItem) => {
    const resolved = await resolveHistoryItemData(item);
    if (!resolved?.fileData) {
      logger.debug('History item data not found', { itemId: item.id });
      return;
    }

    if (historyPreview) {
      cleanupPreview();
    }

    const mimeType = resolved.mimeType || 'application/octet-stream';
    const previewKind = resolveHistoryPreviewKind(resolved);

    if (previewKind === 'text') {
      try {
        const textBytes = await toUint8Array(resolved.fileData);
        setHistoryPreview({
          item: resolved,
          kind: previewKind,
          noteContent: decodeNoteContent(textBytes),
        });
      } catch (error) {
        logger.error('Failed to decode text note preview', { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (previewKind === 'zip') {
      try {
        const gifUrls: string[] = [];
        const zipBytes = await toUint8Array(resolved.fileData);
        const entries = await unzipFilesInWorker(zipBytes, {
          filterExt: '.gif',
          transfer: false,
        });
        const gifFiles = entries.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true })
        );

        for (const entry of gifFiles) {
          const blob = new Blob([new Uint8Array(entry.data)], { type: 'image/gif' });
          gifUrls.push(URL.createObjectURL(blob));
        }

        if (gifUrls.length > 0) {
          setHistoryPreviewChunks(gifUrls);
          setHistoryPreview({
            item: resolved,
            kind: previewKind,
            gifUrl: gifUrls[0],
          });
        } else {
          setHistoryPreview({ item: resolved, kind: previewKind });
        }
      } catch (error) {
        logger.error('Failed to extract ZIP', { error: error instanceof Error ? error.message : String(error) });
        setHistoryPreview({ item: resolved, kind: previewKind });
      }
      return;
    }

    if (previewKind === 'qr-gif') {
      const blob = toBinaryBlob(resolved.fileData, 'image/gif');
      const url = URL.createObjectURL(blob);
      setHistoryPreview({ item: resolved, kind: previewKind, gifUrl: url });
      return;
    }

    if (previewKind === 'image' || previewKind === 'video' || previewKind === 'pdf') {
      const blob = toBinaryBlob(resolved.fileData, mimeType);
      const url = URL.createObjectURL(blob);
      setHistoryPreview({
        item: resolved,
        kind: previewKind,
        previewUrl: url,
      });
      return;
    }

    setHistoryPreview({ item: resolved, kind: 'unsupported' });
  };

  const [noteCopied, setNoteCopied] = useState(false);
  const handleCopyNoteContent = useCallback(async () => {
    if (!historyPreview?.noteContent) return;
    try {
      await navigator.clipboard.writeText(historyPreview.noteContent);
      setNoteCopied(true);
      setTimeout(() => setNoteCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = historyPreview.noteContent;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setNoteCopied(true);
      setTimeout(() => setNoteCopied(false), 2000);
    }
  }, [historyPreview?.noteContent]);

  const selectHistoryPreviewNote = useCallback(() => {
    const noteContent = historyPreviewNoteContentRef.current;
    const selection = window.getSelection();
    if (!noteContent || !selection) {
      return;
    }

    historyPreviewNoteViewerRef.current?.focus({ preventScroll: true });

    const range = document.createRange();
    range.selectNodeContents(noteContent);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  useEffect(() => {
    if (!historyPreview?.noteContent) {
      return;
    }

    historyPreviewNoteViewerRef.current?.focus({ preventScroll: true });
  }, [historyPreview?.noteContent]);

  const handleNoteViewerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        selectHistoryPreviewNote();
        return;
      }

      const selectedText = window.getSelection()?.toString();
      if (key === 'c' && selectedText === historyPreview?.noteContent) {
        event.preventDefault();
        void handleCopyNoteContent();
      }
    },
    [handleCopyNoteContent, historyPreview?.noteContent, selectHistoryPreviewNote]
  );

  // Full-page note viewer (ShareMyCode style)
  if (historyPreview?.noteContent) {
    const noteLines = historyPreview.noteContent.split('\n');
    const noteFooterParts = historyPreview.item.subtitle.split(' - ');
    const noteFooterDateTime =
      noteFooterParts.length > 1
        ? noteFooterParts.slice(0, -1).join(' - ')
        : historyPreview.item.subtitle;
    const noteFooterSize =
      historyPreview.item.size !== undefined
        ? formatSize(historyPreview.item.size)
        : noteFooterParts.at(-1) || '';
    return (
      <div
        ref={historyPreviewNoteViewerRef}
        data-testid="history-note-viewer"
        tabIndex={-1}
        onKeyDown={handleNoteViewerKeyDown}
        className="flex h-full w-full flex-col bg-[var(--airqr-preview-surface)] pb-[calc(env(safe-area-inset-bottom,0px)+7rem)] text-[var(--airqr-text-primary)] outline-none animate-fade-in"
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--airqr-control-panel-surface)] border-b border-[var(--airqr-divider)] shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={cleanupPreview}
              className="airqr-back-button !size-9 !basis-9 !shadow-none"
              aria-label={t('common.back')}
            >
              <Icon name="arrow_back" className="text-[20px]" />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <Icon name="article" className="text-[16px] text-[var(--airqr-accent-text)]" />
              <span className="font-medium text-[var(--airqr-text-primary)] truncate">{historyPreview.item.title}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopyNoteContent}
              className="airqr-action-button flex size-8 items-center justify-center rounded-full"
              aria-label={noteCopied ? t('common.copied', 'Copied') : t('scanner.copyToClipboard')}
              title={noteCopied ? t('common.copied', 'Copied') : t('scanner.copyToClipboard')}
            >
              <Icon name={noteCopied ? 'check' : 'content_copy'} className="text-[14px]" />
            </button>
            <button
              onClick={() => handleDownload(historyPreview.item)}
              className="airqr-action-button flex size-8 items-center justify-center rounded-full"
              aria-label={t('common.download')}
              title={t('common.download')}
            >
              <Icon name="download" className="text-[14px]" />
            </button>
          </div>
        </div>

        {/* Code viewer */}
        <div className="flex-1 overflow-auto">
          <NoteCodeViewer
            ref={historyPreviewNoteContentRef}
            content={historyPreview.noteContent}
            contentTestId="history-note-content"
          />
        </div>

        {/* Status bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--airqr-divider)] bg-[var(--airqr-control-panel-surface)] px-4 py-2 text-xs text-[var(--airqr-text-muted)]">
          <span className="shrink-0">{noteLines.length} {noteLines.length === 1 ? 'line' : 'lines'}</span>
          <span className="flex min-w-0 items-center justify-end text-right">
            <span
              data-testid="history-note-footer-date"
              className="min-w-0 truncate"
            >
              {noteFooterDateTime}
            </span>
            <span aria-hidden="true" className="shrink-0 px-1">-</span>
            <span
              data-testid="history-note-footer-size"
              className="shrink-0"
            >
              {noteFooterSize}
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <History
        items={displayItems}
        incompleteItems={displayIncompleteItems}
        onDelete={handleDelete}
        onDownload={handleDownload}
        onResume={handleResume}
        onDeleteIncomplete={handleDeleteIncomplete}
        onSyncIncomplete={handleSyncIncomplete}
        onKeepLocalIncomplete={handleKeepLocalIncomplete}
        onView={handleView}
        onKeepLocal={handleKeepLocal}
        onSyncItem={handleSyncItem}
        onSyncToServer={handleSyncToServer}
        onRefresh={handleRefreshHistory}
        onClearHistory={handleClearHistory}
        isSyncing={isSyncing}
        isClearingHistory={isClearingHistory}
        syncEnabled={uploadConfig.enabled}
        syncStatusLabel={historySyncStatusBadge.label}
        syncStatusClassName={historySyncStatusBadge.className}
        syncAuthRequired={uploadConfig.enabled && authEnabled && !authorized}
        onOpenSyncSettings={() => setLocation('/settings?scrollTo=sync')}
      />

      {historyPreview && (
        <div
          className="fixed inset-0 z-[100] bg-[rgb(11_20_31/0.62)] backdrop-blur-sm flex items-center justify-center p-4"
          onClick={cleanupPreview}
        >
          <div
            ref={historyPreviewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={historyPreviewDialogTitleId}
            aria-describedby={historyPreviewDialogDescriptionId}
            tabIndex={-1}
            className="airqr-card relative flex h-[94dvh] w-[96vw] max-w-[1500px] flex-col overflow-hidden transition-all duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--airqr-divider)] p-4">
              <div className="flex flex-col min-w-0 flex-1">
                <h3
                  id={historyPreviewDialogTitleId}
                  className="truncate text-lg font-bold text-[var(--airqr-text-primary)]"
                >
                  {historyPreview.item.title}
                </h3>
                <p
                  id={historyPreviewDialogDescriptionId}
                  className="truncate text-sm text-[var(--airqr-text-muted)]"
                >
                  {historyPreview.item.subtitle}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  aria-label={t('history.downloadFile')}
                  title={t('history.downloadFile')}
                  onClick={() => handleDownload(historyPreview.item)}
                  className="airqr-action-button rounded-full p-2 transition-colors"
                >
                  <Icon name="download" />
                </button>
                <button
                  ref={historyPreviewCloseButtonRef}
                  type="button"
                  aria-label={t('common.close')}
                  onClick={cleanupPreview}
                  className="airqr-action-button rounded-full p-2 transition-colors"
                >
                  <Icon name="close" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-[var(--airqr-preview-surface)] p-4">
              {historyPreview.kind === 'qr-gif' ||
              historyPreviewChunks.length > 0 ? (
                <QrGifViewer
                  gifUrls={
                    historyPreviewChunks.length > 0
                      ? historyPreviewChunks
                      : [historyPreview.gifUrl || '']
                  }
                  metadata={
                    historyPreview.item.minFrames
                      ? {
                          totalFrames: historyPreview.item.minFrames,
                          minFrames: historyPreview.item.minFrames,
                        }
                      : undefined
                  }
                  chunkMinFrames={historyPreview.item.chunkMinFrames}
                  isStreamingMode={historyPreviewChunks.length > 1}
                  onOpenMultiView={
                    historyPreviewChunks.length > 1 ? openMultiChunkView : undefined
                  }
                  isOpeningMultiView={isOpeningMultiView}
                  previewAreaClassName="h-[clamp(300px,calc(100vw-24px),420px)] min-h-0 sm:h-[min(64dvh,720px)] sm:min-h-[360px]"
                />
              ) : historyPreview.kind === 'image' && historyPreview.previewUrl ? (
                <div className="flex h-full min-h-[360px] items-center justify-center rounded-[28px] bg-[var(--airqr-control-panel-surface)] p-3">
                  <img
                    src={historyPreview.previewUrl}
                    alt={historyPreview.item.title}
                    className="max-h-[76dvh] max-w-full rounded-[22px] object-contain shadow-[0_20px_80px_rgba(0,0,0,0.45)]"
                  />
                </div>
              ) : historyPreview.kind === 'video' && historyPreview.previewUrl ? (
                <div className="flex h-full min-h-[360px] items-center justify-center rounded-[28px] bg-[var(--airqr-control-panel-surface)] p-3">
                  <video
                    data-testid="history-video-preview"
                    src={historyPreview.previewUrl}
                    controls
                    className="max-h-[76dvh] max-w-full rounded-[22px] shadow-[0_20px_80px_rgba(0,0,0,0.45)]"
                  />
                </div>
              ) : historyPreview.kind === 'pdf' && historyPreview.previewUrl ? (
                <div className="h-full min-h-[70dvh] overflow-hidden rounded-[28px] bg-[var(--airqr-control-panel-surface)] p-3">
                  <object
                    data={historyPreview.previewUrl}
                    type="application/pdf"
                    title={historyPreview.item.title}
                    className="h-full min-h-[68dvh] w-full rounded-[22px] bg-white"
                  >
                    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 text-center">
                      <Icon name="description" className="text-6xl text-[var(--airqr-accent-text)]" />
                      <p className="text-[var(--airqr-text-secondary)]">{t('history.previewUnavailable')}</p>
                      <button
                        type="button"
                        onClick={() => handleDownload(historyPreview.item)}
                        className="airqr-primary-button flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors"
                      >
                        <Icon name="download" className="text-[18px]" />
                        {t('common.download')}
                      </button>
                    </div>
                  </object>
                </div>
              ) : (
                <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4">
                  <Icon
                    name={historyPreview.kind === 'zip' ? 'folder_zip' : 'description'}
                    className="text-6xl text-[var(--airqr-accent-text)]"
                  />
                  <p className="text-[var(--airqr-text-secondary)]">
                    {historyPreview.kind === 'zip'
                      ? t('history.zipArchive')
                      : t('history.previewUnavailable')}
                  </p>
                  <p className="max-w-md text-center text-sm text-[var(--airqr-text-muted)]">
                    {historyPreview.kind === 'zip'
                      ? t('history.noGifFound')
                      : t('history.previewUnsupported')}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDownload(historyPreview.item)}
                    className="airqr-primary-button flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors"
                  >
                    <Icon name="download" className="text-[18px]" />
                    {historyPreview.kind === 'zip'
                      ? t('encoder.downloadZip')
                      : t('common.download')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryTab;
