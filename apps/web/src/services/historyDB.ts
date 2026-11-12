// IndexedDB manager for history persistence
// Supports unlimited file sizes (browser limit is much higher than localStorage)

import type {
  HistoryItem,
  IncompleteScanItem,
  PersistedIncompleteScanItem,
  ScanUploadConfig,
} from "../types";
import { getBinaryDataSize } from "../utils/binaryData";
import { resolveHistoryItemSortTimestamp, toZipFilename } from "../utils/history";
import { createLogger } from "../utils/logger";
import { useHistoryStore } from "../store/historyStore";
import {
  canOptimisticallyAttemptServerSync,
  canUseServerSync,
  isServerSyncAuthorizedSnapshot,
} from "./serverAuth";
import { queueHistoryItem, queueScanComplete } from "./scanUploadService";

export type HistoryAutoSyncDeps = {
  canOptimisticallyAttemptServerSync: typeof canOptimisticallyAttemptServerSync;
  canUseServerSync: typeof canUseServerSync;
  isServerSyncAuthorizedSnapshot: typeof isServerSyncAuthorizedSnapshot;
  queueHistoryItem: typeof queueHistoryItem;
  queueScanComplete: typeof queueScanComplete;
};

const defaultAutoSyncDeps: HistoryAutoSyncDeps = {
  canOptimisticallyAttemptServerSync,
  canUseServerSync,
  isServerSyncAuthorizedSnapshot,
  queueHistoryItem,
  queueScanComplete,
};

let autoSyncDeps: HistoryAutoSyncDeps = { ...defaultAutoSyncDeps };

export function setHistoryAutoSyncDepsForTests(
  deps: Partial<HistoryAutoSyncDeps>
): void {
  autoSyncDeps = {
    ...autoSyncDeps,
    ...deps,
  };
}

export function resetHistoryAutoSyncDepsForTests(): void {
  autoSyncDeps = { ...defaultAutoSyncDeps };
}

const logger = createLogger("services:historyDB");

const DB_NAME = "AirQR_History";
const DB_VERSION = 4;
const STORE_NAME = "history";
const INCOMPLETE_STORE_NAME = "incompleteScan";
const MAX_HISTORY_ITEMS = 50;

let dbInstance: IDBDatabase | null = null;

function getHistoryStoreItem(id: string): HistoryItem | undefined {
  return useHistoryStore.getState().items.find((item) => item.id === id);
}

function patchHistoryStoreItem(
  id: string,
  patch: Partial<HistoryItem>
): void {
  const { items, setItems } = useHistoryStore.getState();
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.id !== id) {
      return item;
    }
    changed = true;
    return {
      ...item,
      ...patch,
    };
  });

  if (changed) {
    setItems(nextItems);
  }
}

export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      logger.error("Failed to open IndexedDB", { error: request.error });
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      // SAFETY: IDBRequest events expose the request as target.
      const db = (event.target as IDBOpenDBRequest).result;

      // Create history object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        objectStore.createIndex("date", "date", { unique: false });
        objectStore.createIndex("origin", "origin", { unique: false });
      }

      // Create incomplete scan object store if it doesn't exist
      if (!db.objectStoreNames.contains(INCOMPLETE_STORE_NAME)) {
        db.createObjectStore(INCOMPLETE_STORE_NAME, { keyPath: "sessionId" });
      }
    };
  });
}

export async function saveHistoryToIndexedDB(
  items: HistoryItem[]
): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(STORE_NAME);

    // Clear existing data
    objectStore.clear();

    // Save up to MAX_HISTORY_ITEMS
    const itemsToSave = items.slice(0, MAX_HISTORY_ITEMS);

    for (const item of itemsToSave) {
      objectStore.put(item);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        logger.info(`Saved ${itemsToSave.length} items to IndexedDB`);
        resolve();
      };
      transaction.onerror = () => {
        logger.error("Failed to save to IndexedDB", { error: transaction.error });
        reject(transaction.error);
      };
    });
  } catch (error) {
    logger.error("Failed to save history to IndexedDB", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function saveHistoryItem(item: HistoryItem): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(STORE_NAME);
    objectStore.put(item);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        logger.error("Failed to save item to IndexedDB", { error: transaction.error });
        reject(transaction.error);
      };
    });
  } catch (error) {
    logger.error("Failed to save history item", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Save a history item to IndexedDB and optionally auto-sync to server.
 * This should be used when adding new items that need to be synced.
 */
export async function saveHistoryItemWithAutoSync(
  item: HistoryItem,
  uploadConfig: ScanUploadConfig
): Promise<void> {
  logger.info(`[AutoSync] saveHistoryItemWithAutoSync called`, {
    id: item.id,
    title: item.title,
    origin: item.origin,
    mimeType: item.mimeType,
    hasFileData: !!item.fileData,
    fileDataLength: getBinaryDataSize(item.fileData),
    uploadEnabled: uploadConfig.enabled,
    serverUrl: uploadConfig.url,
  });

  // First save to IndexedDB
  await saveHistoryItem(item);

  // Check if sync is enabled
  if (!uploadConfig.enabled) {
    logger.info(`[AutoSync] Skipping ${item.id} - sync not enabled`);
    return;
  }

  const serverSyncReady =
    autoSyncDeps.canOptimisticallyAttemptServerSync(uploadConfig) ||
    autoSyncDeps.isServerSyncAuthorizedSnapshot(uploadConfig) ||
    (await autoSyncDeps.canUseServerSync(uploadConfig));
  if (!serverSyncReady) {
    logger.info(`[AutoSync] Skipping ${item.id} - server auth not ready`);
    return;
  }

  // Skip items that came from server (already synced)
  if (item.source === "server") {
    logger.info(`[AutoSync] Skipping ${item.id} - source is server`);
    return;
  }

  // Skip items without file data
  if (!item.fileData) {
    logger.info(`[AutoSync] Skipping ${item.id} - no file data`);
    return;
  }

  // Check if this type should be synced
  const shouldSync =
    (item.origin === "generated" && (uploadConfig.syncGenerated ?? true)) ||
    (item.origin === "scanned" && (uploadConfig.syncScanned ?? true));

  if (!shouldSync) {
    logger.info(`[AutoSync] Skipping ${item.id} - shouldSync is false`, {
      origin: item.origin,
      syncGenerated: uploadConfig.syncGenerated,
      syncScanned: uploadConfig.syncScanned,
    });
    return;
  }

  const createdAt = resolveHistoryItemSortTimestamp(item);

  logger.info(
    `[AutoSync] Uploading ${item.origin}: ${item.title} (${item.id})`
  );

  const uploadFilename =
    item.mimeType === "application/zip"
      ? toZipFilename(item.title)
      : item.title;

  if (item.origin === "generated") {
    autoSyncDeps.queueHistoryItem(
      item.fileData,
      {
        historyId: item.id,
        title: item.title,
        filename: uploadFilename,
        mimeType: item.mimeType,
        size: getBinaryDataSize(item.fileData),
        totalFrames: item.totalFrames,
        minFrames: item.minFrames,
        chunkMinFrames: item.chunkMinFrames,
        createdAt: createdAt,
        updatedAt: createdAt,
      },
      uploadConfig,
      () => markHistoryItemAsSynced(item.id, item.id),
      (error) => markHistoryItemAsSyncFailed(item.id, error)
    );
  } else if (item.origin === "scanned") {
    autoSyncDeps.queueScanComplete(
      item.fileData,
      {
        sessionId: item.id,
        filename: uploadFilename,
        mimeType: item.mimeType,
        completedAt: createdAt,
      },
      uploadConfig,
      () => markHistoryItemAsSynced(item.id, item.id),
      (error) => markHistoryItemAsSyncFailed(item.id, error)
    );
  }
}

export async function loadHistoryFromIndexedDB(): Promise<HistoryItem[]> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        // SAFETY: history object store values are persisted HistoryItem records.
        const items = request.result as HistoryItem[];
        logger.info(`Loaded ${items.length} items from IndexedDB`);
        resolve(items);
      };
      request.onerror = () => {
        logger.error("Failed to load from IndexedDB", { error: request.error });
        reject(request.error);
      };
    });
  } catch (error) {
    logger.error("Failed to load history from IndexedDB", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

export async function getHistoryItemById(
  id: string
): Promise<HistoryItem | null> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.get(id);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        // SAFETY: history object store get() returns a HistoryItem when present.
        resolve((request.result as HistoryItem) || null);
      };
      request.onerror = () => {
        logger.error("Failed to get history item", { error: request.error });
        reject(request.error);
      };
    });
  } catch (error) {
    logger.error("Failed to fetch history item", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(STORE_NAME);
    objectStore.delete(id);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        logger.info(`Deleted item ${id} from IndexedDB`);
        resolve();
      };
      transaction.onerror = () => {
        logger.error("Failed to delete from IndexedDB", { error: transaction.error });
        reject(transaction.error);
      };
    });
  } catch (error) {
    logger.error("Failed to delete history item", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Mark a history item as synced with the server
 */
export async function markHistoryItemAsSynced(
  id: string,
  serverId: string
): Promise<void> {
  try {
    const item = await getHistoryItemById(id);
    const storeItem = getHistoryStoreItem(id);
    const sourceItem = item || storeItem;
    if (!sourceItem) {
      logger.warn(`Cannot mark as synced: Item ${id} not found`);
      return;
    }

    if (item) {
      const updatedItem: HistoryItem = {
        ...item,
        isSynced: true,
        serverId: serverId,
        syncFailed: false,
        syncFailedAt: undefined,
      };
      await saveHistoryItem(updatedItem);
    }

    patchHistoryStoreItem(id, {
      isSynced: true,
      serverId,
      isLocalOnly: false,
      syncFailed: false,
      syncFailedAt: undefined,
    });
    logger.info(`Marked item ${id} as synced (serverId: ${serverId})`);
  } catch (error) {
    logger.error("Failed to mark item as synced", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Mark a history item as failed to sync with the server
 * This is called when max upload retries are exceeded
 */
export async function markHistoryItemAsSyncFailed(
  id: string,
  errorMessage?: string
): Promise<void> {
  try {
    const item = await getHistoryItemById(id);
    const storeItem = getHistoryStoreItem(id);
    const sourceItem = item || storeItem;
    if (!sourceItem) {
      logger.warn(`Cannot mark as sync failed: Item ${id} not found`);
      return;
    }

    const syncFailedAt = new Date().toISOString();
    if (item) {
      const updatedItem: HistoryItem = {
        ...item,
        isSynced: false,
        syncFailed: true,
        syncFailedAt,
      };
      await saveHistoryItem(updatedItem);
    }

    patchHistoryStoreItem(id, {
      isSynced: false,
      syncFailed: true,
      syncFailedAt,
    });
    logger.warn(`Marked item ${id} as sync failed`, { errorMessage });
  } catch (error) {
    logger.error("Failed to mark item as sync failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Clear the sync failed status for a history item (to allow retry)
 */
export async function clearSyncFailedStatus(id: string): Promise<void> {
  try {
    const item = await getHistoryItemById(id);
    const storeItem = getHistoryStoreItem(id);
    const sourceItem = item || storeItem;
    if (!sourceItem) {
      logger.warn(`Cannot clear sync failed: Item ${id} not found`);
      return;
    }

    if (item) {
      const updatedItem: HistoryItem = {
        ...item,
        syncFailed: false,
        syncFailedAt: undefined,
      };
      await saveHistoryItem(updatedItem);
    }

    patchHistoryStoreItem(id, {
      syncFailed: false,
      syncFailedAt: undefined,
    });
    logger.info(`Cleared sync failed status for item ${id}`);
  } catch (error) {
    logger.error("Failed to clear sync failed status", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Mark a history item as local-only (detach from server)
 * This prevents the item from being deleted when removed from server
 */
export async function markHistoryItemAsLocalOnly(id: string): Promise<void> {
  try {
    const item = await getHistoryItemById(id);
    const storeItem = getHistoryStoreItem(id);
    const sourceItem = item || storeItem;
    if (!sourceItem) {
      logger.warn(`Cannot mark as local-only: Item ${id} not found`);
      return;
    }

    if (item) {
      const updatedItem: HistoryItem = {
        ...item,
        isSynced: false,
        serverId: undefined,
        isLocalOnly: true,
      };
      await saveHistoryItem(updatedItem);
    }

    patchHistoryStoreItem(id, {
      isSynced: false,
      serverId: undefined,
      isLocalOnly: true,
    });
    logger.info(`Marked item ${id} as local-only`);
  } catch (error) {
    logger.error("Failed to mark item as local-only", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Re-enable sync for a local-only item
 * This allows the item to be synced to the server again
 */
export async function enableSyncForHistoryItem(id: string): Promise<void> {
  try {
    const item = await getHistoryItemById(id);
    const storeItem = getHistoryStoreItem(id);
    const sourceItem = item || storeItem;
    if (!sourceItem) {
      logger.warn(`Cannot enable sync: Item ${id} not found`);
      return;
    }

    if (item) {
      const updatedItem: HistoryItem = {
        ...item,
        isLocalOnly: false,
        // Keep isSynced as false so it will be uploaded on next sync
        isSynced: false,
      };
      await saveHistoryItem(updatedItem);
    }

    patchHistoryStoreItem(id, {
      isLocalOnly: false,
      isSynced: false,
    });
    logger.info(`Enabled sync for item ${id}`);
  } catch (error) {
    logger.error("Failed to enable sync for item", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Delete a history item by its server ID
 */
export async function deleteHistoryItemByServerId(
  serverId: string
): Promise<void> {
  try {
    const items = await loadHistoryFromIndexedDB();
    const itemToDelete = items.find((item) => item.serverId === serverId);

    if (itemToDelete) {
      await deleteHistoryItem(itemToDelete.id);
      logger.info(`Deleted item with serverId ${serverId}`);
    }
  } catch (error) {
    logger.error("Failed to delete item by serverId", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function clearHistory(): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(STORE_NAME);
    objectStore.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        logger.info("Cleared all history from IndexedDB");
        resolve();
      };
      transaction.onerror = () => {
        logger.error("Failed to clear IndexedDB", { error: transaction.error });
        reject(transaction.error);
      };
    });
  } catch (error) {
    logger.error("Failed to clear history", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Incomplete scan management
export async function saveIncompleteScan(
  scan: IncompleteScanItem | PersistedIncompleteScanItem
): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([INCOMPLETE_STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(INCOMPLETE_STORE_NAME);

    return new Promise((resolve, reject) => {
      const putRequest = objectStore.put(scan);
      putRequest.onsuccess = () => {
        resolve();
      };
      putRequest.onerror = () => reject(putRequest.error);
    });
  } catch (error) {
    logger.error("Failed to save incomplete scan", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function getIncompleteScanById(
  sessionId: string
): Promise<PersistedIncompleteScanItem | null> {
  try {
    const db = await initDB();
    const transaction = db.transaction([INCOMPLETE_STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(INCOMPLETE_STORE_NAME);
    const request = objectStore.get(sessionId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        // SAFETY: incomplete-scan get() returns a persisted scan record when present.
        resolve((request.result as PersistedIncompleteScanItem) || null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    logger.error("Failed to get incomplete scan", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function loadIncompleteScan(): Promise<IncompleteScanItem | null> {
  const scans = await loadIncompleteScans();
  return scans.length > 0 ? scans[0] : null;
}

export async function loadIncompleteScans(): Promise<PersistedIncompleteScanItem[]> {
  try {
    const db = await initDB();
    const transaction = db.transaction([INCOMPLETE_STORE_NAME], "readonly");
    const objectStore = transaction.objectStore(INCOMPLETE_STORE_NAME);
    const request = objectStore.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        // SAFETY: incomplete-scan getAll() returns persisted scan records.
        const scans = request.result as PersistedIncompleteScanItem[];
        if (scans.length > 0) {
          logger.info(`Loaded ${scans.length} incomplete scan(s) from IndexedDB`);
        }
        resolve(scans);
      };
      request.onerror = () => {
        logger.error("Failed to load incomplete scans", { error: request.error });
        reject(request.error);
      };
    });
  } catch (error) {
    logger.error("Failed to load incomplete scans", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

export async function clearIncompleteScan(): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([INCOMPLETE_STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(INCOMPLETE_STORE_NAME);
    objectStore.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        logger.info("Cleared incomplete scan from IndexedDB");
        resolve();
      };
      transaction.onerror = () => {
        logger.error("Failed to clear incomplete scan", { error: transaction.error });
        reject(transaction.error);
      };
    });
  } catch (error) {
    logger.error("Failed to clear incomplete scan", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function deleteIncompleteScan(sessionId: string): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([INCOMPLETE_STORE_NAME], "readwrite");
    const objectStore = transaction.objectStore(INCOMPLETE_STORE_NAME);
    objectStore.delete(sessionId);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        logger.info(`Deleted incomplete scan ${sessionId} from IndexedDB`);
        resolve();
      };
      transaction.onerror = () => {
        logger.error("Failed to delete incomplete scan", { error: transaction.error });
        reject(transaction.error);
      };
    });
  } catch (error) {
    logger.error("Failed to delete incomplete scan", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

