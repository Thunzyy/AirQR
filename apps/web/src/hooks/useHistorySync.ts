/**
 * Sync history state with IndexedDB
 */

import { useEffect, useRef, useState } from 'react';
import { useHistoryStore } from '../store';
import { useSettingsStore } from '../store/settingsStore';
import { globalHas } from '../parse/wire';
import { createLogger } from '../utils/logger';

const logger = createLogger('hooks:historySync');
import {
  loadHistoryFromIndexedDB,
  saveHistoryItem,
  deleteHistoryItem,
  clearHistory,
  loadIncompleteScans,
  saveIncompleteScan,
  clearIncompleteScan,
  deleteIncompleteScan,
} from '@web/services/historyDB';
import {
  deleteScanSessionChunks,
  deleteScanSessionPackets,
  listScanSessionChunkSessionIds,
  listScanSessionPacketSummaries,
  replaceScanSessionPackets,
  saveScanSessionChunk,
} from '@web/services/scanSessionDB';
import { resolveIncompleteScanName } from '../utils/format';
import { normalizeHistoryItem, stripHistoryItemData } from '../utils/history';
import {
  coalesceIncompleteScanItems,
  getIncompleteScanSessionKeys,
  getLegacyIncompleteScanChunks,
  getLegacyIncompleteScanPackets,
  stripIncompleteScanBuffers,
} from '../utils/incompleteSync';
import { MAX_HISTORY_ITEMS } from '../constants';
import {
  beginRemoteHistoryStaleSource,
  isHistoryItemTombstoned,
  isIncompleteScanTombstoned,
  getRemoteHistoryServerScope,
  withoutTombstonedHistoryItems,
  withoutTombstonedIncompleteScans,
} from '../features/history/historyTombstones';

export const useHistorySync = (): void => {
  const { items, incompleteItems, setItems, setIncompleteItems } =
    useHistoryStore();
  const saveItemsTimer = useRef<number | null>(null);
  const saveIncompleteTimer = useRef<number | null>(null);
  const savedIdsRef = useRef<Set<string>>(new Set());
  const savedIncompleteIdsRef = useRef<Set<string>>(new Set());
  const hasIndexedDB = globalHas('indexedDB');
  const [historyLoaded, setHistoryLoaded] = useState(() => !hasIndexedDB);
  const [incompleteLoaded, setIncompleteLoaded] = useState(() => !hasIndexedDB);

  useEffect(() => {
    if (!hasIndexedDB) {
      return;
    }

    let isMounted = true;
    const releaseHistoryStaleSource = beginRemoteHistoryStaleSource();
    const releaseIncompleteStaleSource = beginRemoteHistoryStaleSource();

    loadHistoryFromIndexedDB()
      .then((loaded) => {
        if (!isMounted) return;
        const allNormalized = (loaded || []).map(normalizeHistoryItem);
        const activeConfig = useSettingsStore.getState().uploadConfig;
        const activeServerScope = activeConfig.enabled
          ? getRemoteHistoryServerScope(activeConfig.url)
          : null;
        const normalized = withoutTombstonedHistoryItems(
          activeServerScope,
          allNormalized
        );
        for (const item of allNormalized) {
          if (isHistoryItemTombstoned(activeServerScope, item)) {
            void deleteHistoryItem(item.id).catch((error) => {
              logger.error('Failed to purge tombstoned history during hydration', {
                error: error instanceof Error ? error.message : String(error),
                id: item.id,
              });
            });
          }
        }
        const loadedIds = new Set(normalized.map((item) => item.id));
        savedIdsRef.current = loadedIds;
        const currentItems = withoutTombstonedHistoryItems(
          activeServerScope,
          useHistoryStore.getState().items
        );
        if (currentItems.length > 0) {
          const existingIds = new Set(currentItems.map((item) => item.id));
          const strippedCurrent = currentItems.map((item) =>
            loadedIds.has(item.id) ? stripHistoryItemData(item) : item
          );
          const merged = [
            ...strippedCurrent,
            ...normalized
              .filter((item) => !existingIds.has(item.id))
              .map(stripHistoryItemData),
          ];
          setItems(merged);
          return;
        }
        setItems(normalized.map(stripHistoryItemData));
      })
      .finally(() => {
        releaseHistoryStaleSource();
        if (isMounted) setHistoryLoaded(true);
      });

    Promise.all([
      loadIncompleteScans(),
      listScanSessionChunkSessionIds(),
      listScanSessionPacketSummaries(),
    ])
      .then(async ([scans, persistedChunkSessionIds, persistedPacketSummaries]) => {
        if (!isMounted) return;
        const allLoadedScans = scans || [];
        const activeConfig = useSettingsStore.getState().uploadConfig;
        const activeServerScope = activeConfig.enabled
          ? getRemoteHistoryServerScope(activeConfig.url)
          : null;
        const tombstonedScans = allLoadedScans.filter((scan) =>
          isIncompleteScanTombstoned(activeServerScope, scan)
        );
        const loadedScans = allLoadedScans.filter(
          (scan) => !isIncompleteScanTombstoned(activeServerScope, scan)
        );
        const tombstonedSessionIds = new Set(
          tombstonedScans.flatMap((scan) => getIncompleteScanSessionKeys(scan))
        );
        for (const scan of tombstonedScans) {
          void Promise.allSettled([
            deleteIncompleteScan(scan.sessionId),
            deleteScanSessionChunks(scan.sessionId),
            deleteScanSessionPackets(scan.sessionId),
          ]);
        }
        const loadedSessionIds = new Set(
          loadedScans.flatMap((scan) => getIncompleteScanSessionKeys(scan))
        );
        const migrationOperations: Promise<unknown>[] = [];
        const recoveredScans = [];
        const persistedPacketSessionIds = persistedPacketSummaries.map(
          (summary) => summary.sessionId
        );

        for (const scan of loadedScans) {
          const legacyPackets = getLegacyIncompleteScanPackets(scan);
          const legacyChunks = getLegacyIncompleteScanChunks(scan);
          if (legacyPackets.length === 0 && legacyChunks.length === 0) {
            continue;
          }

          const operations: Array<
            | {
                kind: 'packets';
                promise: Promise<void>;
                packetCount: number;
              }
            | {
                kind: 'chunk';
                promise: Promise<void>;
                chunkId: number;
              }
          > = [];

          if (legacyPackets.length > 0) {
            operations.push({
              kind: 'packets',
              packetCount: legacyPackets.length,
              promise: replaceScanSessionPackets(scan.sessionId, legacyPackets),
            });
          }

          for (const chunk of legacyChunks) {
            operations.push({
              kind: 'chunk',
              chunkId: chunk.id,
              promise: saveScanSessionChunk(scan.sessionId, chunk.id, chunk.data),
            });
          }

          migrationOperations.push(
            Promise.allSettled(operations.map((operation) => operation.promise))
              .then(async (results) => {
                let hadFailure = false;

                results.forEach((result, index) => {
                  if (result.status !== 'rejected') {
                    return;
                  }

                  hadFailure = true;
                  const operation = operations[index];
                  if (operation?.kind === 'packets') {
                    logger.error('Failed to migrate legacy incomplete scan packets', {
                      error: result.reason,
                      sessionId: scan.sessionId,
                      packetCount: operation.packetCount,
                    });
                    return;
                  }

                  logger.error('Failed to migrate legacy incomplete scan chunk', {
                    error: result.reason,
                    sessionId: scan.sessionId,
                    chunkId: operation?.chunkId,
                  });
                });

                if (hadFailure) {
                  return;
                }

                try {
                  await saveIncompleteScan(stripIncompleteScanBuffers(scan));
                } catch (error) {
                  logger.error('Failed to compact legacy incomplete scan metadata', {
                    error: error instanceof Error ? error.message : String(error),
                    sessionId: scan.sessionId,
                  });
                }
              })
          );
        }

        for (const { sessionId, packetCount } of persistedPacketSummaries) {
          if (tombstonedSessionIds.has(sessionId)) {
            migrationOperations.push(deleteScanSessionPackets(sessionId));
            continue;
          }
          if (loadedSessionIds.has(sessionId)) {
            continue;
          }

          try {
            if (packetCount <= 0) {
              continue;
            }

            const recoveredScan = {
              sessionId,
              filename: resolveIncompleteScanName(undefined, sessionId),
              received: packetCount,
              total: packetCount,
              date: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              source: 'local' as const,
            };

            recoveredScans.push(recoveredScan);
            loadedSessionIds.add(sessionId);
            migrationOperations.push(
              saveIncompleteScan(recoveredScan).catch((error) => {
                logger.error('Failed to recover packet-backed incomplete scan metadata', {
                  error: error instanceof Error ? error.message : String(error),
                  sessionId,
                  packetCount,
                });
              })
            );
          } catch (error) {
            logger.error('Failed to inspect packet-backed incomplete scan session', {
              error: error instanceof Error ? error.message : String(error),
              sessionId,
            });
          }
        }

        for (const sessionId of persistedChunkSessionIds) {
          if (loadedSessionIds.has(sessionId)) {
            continue;
          }
          migrationOperations.push(
            deleteScanSessionChunks(sessionId).catch((error) => {
              logger.error('Failed to delete orphan scan session chunks', {
                error: error instanceof Error ? error.message : String(error),
                sessionId,
              });
            })
          );
        }

        for (const sessionId of persistedPacketSessionIds) {
          if (loadedSessionIds.has(sessionId)) {
            continue;
          }
          migrationOperations.push(
            deleteScanSessionPackets(sessionId).catch((error) => {
              logger.error('Failed to delete orphan scan session packets', {
                error: error instanceof Error ? error.message : String(error),
                sessionId,
              });
            })
          );
        }

        if (migrationOperations.length > 0) {
          await Promise.allSettled(migrationOperations);
        }
        if (!isMounted) return;

        const compactLoadedScans = coalesceIncompleteScanItems(
          [...loadedScans, ...recoveredScans].map(stripIncompleteScanBuffers)
        );
        savedIncompleteIdsRef.current = new Set(
          compactLoadedScans.map((scan) => scan.sessionId)
        );
        const currentIncomplete = withoutTombstonedIncompleteScans(
          activeServerScope,
          useHistoryStore.getState().incompleteItems
        );
        if (currentIncomplete.length > 0) {
          setIncompleteItems(
            coalesceIncompleteScanItems([
              ...compactLoadedScans,
              ...currentIncomplete.map(stripIncompleteScanBuffers),
            ])
          );
          return;
        }
        setIncompleteItems(compactLoadedScans);
      })
      .finally(() => {
        releaseIncompleteStaleSource();
        if (isMounted) setIncompleteLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, [hasIndexedDB, setItems, setIncompleteItems]);

  useEffect(() => {
    if (!hasIndexedDB || !historyLoaded) return;
    if (saveItemsTimer.current) {
      window.clearTimeout(saveItemsTimer.current);
    }
    saveItemsTimer.current = window.setTimeout(() => {
      const currentIds = new Set(items.map((item) => item.id));
      const prevIds = savedIdsRef.current;
      const removedIds = Array.from(prevIds).filter(
        (id) => !currentIds.has(id)
      );
      const addedItems = items.filter(
        (item) =>
          !prevIds.has(item.id) && (item.fileData || item.source === 'server')
      );
      const trimmedIds =
        items.length > MAX_HISTORY_ITEMS
          ? new Set(
              items.slice(0, MAX_HISTORY_ITEMS).map((item) => item.id)
            )
          : null;
      const overflowIds = trimmedIds
        ? Array.from(currentIds).filter((id) => !trimmedIds.has(id))
        : [];
      const deletions = new Set([...removedIds, ...overflowIds]);

      if (addedItems.length === 0 && deletions.size === 0) {
        savedIdsRef.current = currentIds;
        return;
      }

      const operations: Promise<unknown>[] = [];
      if (items.length === 0 && prevIds.size > 0) {
        operations.push(clearHistory());
      } else {
        addedItems.forEach((rawItem) => {
          const normalized = normalizeHistoryItem(rawItem);
          const payload =
            rawItem.source === 'server'
              ? stripHistoryItemData(normalized)
              : normalized;
          operations.push(saveHistoryItem(payload));
        });
        deletions.forEach((id) => operations.push(deleteHistoryItem(id)));
      }

      Promise.all(operations)
        .catch((error) => {
          logger.error('Failed to sync history', { error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          savedIdsRef.current = currentIds;
        });
    }, 500);
    return () => {
      if (saveItemsTimer.current) {
        window.clearTimeout(saveItemsTimer.current);
      }
    };
  }, [items, historyLoaded, hasIndexedDB]);

  useEffect(() => {
    if (!hasIndexedDB || !incompleteLoaded) return;
    if (saveIncompleteTimer.current) {
      window.clearTimeout(saveIncompleteTimer.current);
    }
    saveIncompleteTimer.current = window.setTimeout(() => {
      const currentIds = new Set(
        incompleteItems.map((scan) => scan.sessionId)
      );
      const previousIds = savedIncompleteIdsRef.current;
      const removedIds = Array.from(previousIds).filter(
        (id) => !currentIds.has(id)
      );

      if (incompleteItems.length === 0 && previousIds.size > 0) {
        Promise.all(
          Array.from(previousIds).flatMap((sessionId) => [
            deleteScanSessionPackets(sessionId),
            deleteScanSessionChunks(sessionId),
          ])
        )
          .catch((error) => {
            logger.error('Failed to clear persisted scan session buffers', {
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .then(() => clearIncompleteScan())
          .catch((error) => {
            logger.error('Failed to clear incomplete scan', { error: error instanceof Error ? error.message : String(error) });
          })
          .finally(() => {
            savedIncompleteIdsRef.current = currentIds;
          });
        return;
      }

      if (incompleteItems.length === 0 && removedIds.length === 0) {
        savedIncompleteIdsRef.current = currentIds;
        return;
      }

      const operations: Promise<unknown>[] = [];
      for (const scan of incompleteItems) {
        operations.push(saveIncompleteScan(scan));
      }
      for (const sessionId of removedIds) {
        operations.push(deleteIncompleteScan(sessionId));
        operations.push(deleteScanSessionPackets(sessionId));
        operations.push(deleteScanSessionChunks(sessionId));
      }

      Promise.all(operations)
        .catch((error) => {
          logger.error('Failed to sync incomplete scans', { error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          savedIncompleteIdsRef.current = currentIds;
        });
    }, 500);
    return () => {
      if (saveIncompleteTimer.current) {
        window.clearTimeout(saveIncompleteTimer.current);
      }
    };
  }, [incompleteItems, incompleteLoaded, hasIndexedDB]);
};
