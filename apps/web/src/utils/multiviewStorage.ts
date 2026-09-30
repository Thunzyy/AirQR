/**
 * multiviewStorage.ts - IndexedDB helpers for multi-view sessions
 *
 * Stores chunk data for the multi-chunk viewer, avoiding blob URL issues
 * with URL length limits and cross-tab persistence.
 */

const DB_NAME = 'airqr-multiview';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ChunkData {
  id: number;
  data: Uint8Array;
  mimeType: string;
}

export interface SessionMetadata {
  filename?: string;
  chunkMinFrames?: number[];
}

export interface MultiviewSession {
  sessionId: string;
  createdAt: number;
  chunks: ChunkData[];
  metadata?: SessionMetadata;
}

/**
 * Open the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      // SAFETY: IDBRequest events expose the request as target.
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `mv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Save a multi-view session to IndexedDB
 */
export async function saveMultiviewSession(
  sessionId: string,
  chunks: Uint8Array[],
  mimeType = 'image/gif',
  metadata?: SessionMetadata
): Promise<void> {
  const db = await openDB();

  const session: MultiviewSession = {
    sessionId,
    createdAt: Date.now(),
    chunks: chunks.map((data, id) => ({ id, data, mimeType })),
    metadata,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(session);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    tx.oncomplete = () => db.close();
  });
}

/**
 * Load a multi-view session from IndexedDB
 */
export async function loadMultiviewSession(
  sessionId: string
): Promise<MultiviewSession | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(sessionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      // SAFETY: IDB get() result is a MultiviewSession when present.
      const result = request.result as MultiviewSession | undefined;
      resolve(result || null);
    };

    tx.oncomplete = () => db.close();
  });
}

/**
 * Delete a multi-view session from IndexedDB
 */
export async function deleteMultiviewSession(sessionId: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(sessionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    tx.oncomplete = () => db.close();
  });
}

/**
 * Clean up old sessions (older than maxAgeMs)
 */
export async function cleanupOldSessions(
  maxAgeMs = MAX_SESSION_AGE_MS
): Promise<number> {
  const db = await openDB();
  const cutoffTime = Date.now() - maxAgeMs;
  let deletedCount = 0;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const range = IDBKeyRange.upperBound(cutoffTime);
    const request = index.openCursor(range);

    request.onerror = () => reject(request.error);
    request.onsuccess = (event) => {
      // SAFETY: IDBRequest events expose the request as target.
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    tx.oncomplete = () => {
      db.close();
      resolve(deletedCount);
    };
  });
}

/**
 * Convert a blob URL to Uint8Array
 */
export async function blobUrlToUint8Array(blobUrl: string): Promise<Uint8Array> {
  const response = await fetch(blobUrl);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Create a blob URL from chunk data
 */
export function chunkToBlob(chunk: ChunkData): Blob {
  return new Blob([new Uint8Array(chunk.data)], { type: chunk.mimeType });
}

/**
 * Create a blob URL from chunk data
 */
export function chunkToBlobUrl(chunk: ChunkData): string {
  const blob = chunkToBlob(chunk);
  return URL.createObjectURL(blob);
}
