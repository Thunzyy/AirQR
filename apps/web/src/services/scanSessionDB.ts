import {
  asWireObject,
  asWireString,
  errorMessage,
  isWireObject,
  isWireString,
  type WireValue,
} from "../parse/wire";
import { createLogger } from "../utils/logger";

const logger = createLogger("services:scanSessionDB");

const DB_NAME = "AirQR_ScanSessions";
const DB_VERSION = 6;
const PACKET_STORE_NAME = "packetPages";
const CHUNK_STORE_NAME = "chunkRecords";
const PACKET_SUMMARY_STORE_NAME = "packetSessionSummaries";
const PENDING_PACKET_OUTBOX_STORE_NAME = "pendingPacketOutbox";
const SESSION_ID_INDEX = "sessionId";
const PACKET_SESSION_START_INDEX_INDEX = "sessionStartIndex";
const OUTBOX_SESSION_CHUNK_PACKET_INDEX = "sessionChunkPacket";
const PAGE_PACKET_COUNT = 64;

export const SCAN_SESSION_PACKET_PAGE_SIZE = PAGE_PACKET_COUNT;

type PacketPageRecord = {
  id: string;
  sessionId: string;
  startIndex: number;
  packets: Uint8Array[];
};

export type ScanSessionPacketPage = {
  startIndex: number;
  packets: Uint8Array[];
};

export type ScanSessionPacketPageVisitSummary = {
  pageCount: number;
  packetCount: number;
};

type PacketSessionSummaryRecord = {
  sessionId: string;
  packetCount: number;
};

type ChunkRecord = {
  id: string;
  sessionId: string;
  chunkId: number;
  data: Uint8Array;
};

export type PendingScanPacketOutboxRecord = {
  id: string;
  sessionId: string;
  chunkId: number;
  packetIndex: number;
  packet: Uint8Array;
  filename?: string;
  expectedPackets?: number;
  totalPackets?: number;
  totalPacketsExact?: boolean;
  totalChunks?: number;
  packetSize?: number;
  resultType?: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
};

export type PendingScanPacketOutboxInput = Omit<
  PendingScanPacketOutboxRecord,
  "id" | "createdAt" | "updatedAt" | "attempts"
> &
  Partial<Pick<PendingScanPacketOutboxRecord, "createdAt" | "updatedAt" | "attempts">>;

let dbInstance: IDBDatabase | null = null;

function packetPageId(sessionId: string, startIndex: number): string {
  return `${sessionId}:${startIndex}`;
}

function chunkRecordId(sessionId: string, chunkId: number): string {
  return `${sessionId}:${chunkId}`;
}

function pendingPacketOutboxId(
  sessionId: string,
  chunkId: number,
  packetIndex: number
): string {
  return `${sessionId}:${chunkId}:${packetIndex}`;
}

function normalizePacket(packet: Uint8Array | ArrayBuffer): Uint8Array {
  return packet instanceof Uint8Array ? packet : new Uint8Array(packet);
}

function normalizeChunkData(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function normalizePendingPacketOutboxRecord(
  record: PendingScanPacketOutboxRecord
): PendingScanPacketOutboxRecord {
  return {
    ...record,
    chunkId: Number(record.chunkId),
    packetIndex: Number(record.packetIndex),
    packet: normalizePacket(record.packet),
    attempts: Number.isFinite(Number(record.attempts)) ? Number(record.attempts) : 0,
  };
}

function ensureStoreIndex(
  store: IDBObjectStore,
  indexName: string,
  keyPath: string | string[],
  options: IDBIndexParameters = { unique: false }
): void {
  const hasIndex =
    "indexNames" in store &&
    store.indexNames !== undefined &&
    "contains" in store.indexNames &&
    store.indexNames.contains(indexName);

  if (!hasIndex) {
    store.createIndex(indexName, keyPath, options);
  }
}

function createPacketPageSessionRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [sessionId, 0],
    [sessionId, Number.MAX_SAFE_INTEGER]
  );
}

function isMissingIndexError(error: WireValue | Error | string | null | undefined): boolean {
  if (error instanceof DOMException || error instanceof Error) {
    return (
      error.name === "NotFoundError" ||
      error.name === "InvalidStateError" ||
      ("code" in error && error.code === 8) ||
      error.message.includes("does not exist")
    );
  }
  if (isWireString(error)) {
    return error.includes("NotFoundError") || error.includes("does not exist");
  }
  if (!isWireObject(error)) {
    return false;
  }
  return (
    error.name === "NotFoundError" ||
    error.name === "InvalidStateError" ||
    error.code === 8
  );
}

function isStringIdbKey(key: IDBValidKey | undefined): key is string {
  // SAFETY: IDB string keys are primitive strings recognized by the wire helper.
  return isWireString(key as WireValue);
}

function toWireError(error: WireValue | Error | null | undefined): WireValue {
  if (error instanceof Error) {
    return error;
  }
  if (error === null || error === undefined) {
    return "idb_error";
  }
  return error;
}

function cursorValueAsWire(value: IDBCursorWithValue["value"]): WireValue {
  // SAFETY: IndexedDB cursor values are JSON-like records written by this module.
  return value as WireValue;
}

function sessionIdFromCursorValue(value: WireValue): string | undefined {
  const sessionId = asWireString(asWireObject(value).sessionId);
  return sessionId && sessionId.length > 0 ? sessionId : undefined;
}

function recordIdFromCursorValue(value: WireValue): string | undefined {
  const id = asWireString(asWireObject(value).id);
  return id && id.length > 0 ? id : undefined;
}

function canFallbackToSessionCursor(
  indexName: string,
  key: IDBValidKey | undefined,
  error: WireValue | Error | null | undefined
): key is string {
  return (
    indexName === SESSION_ID_INDEX &&
    isStringIdbKey(key) &&
    isMissingIndexError(toWireError(error))
  );
}

function canFallbackToSessionIdList(
  indexName: string,
  error: WireValue | Error | string | null | undefined
): boolean {
  return indexName === SESSION_ID_INDEX && isMissingIndexError(error);
}

async function visitPacketPageRecords(
  sessionId: string,
  visitor: (record: PacketPageRecord) => void | Promise<void>
): Promise<ScanSessionPacketPageVisitSummary> {
  if (!sessionId) {
    return { pageCount: 0, packetCount: 0 };
  }

  const db = await initScanSessionDB();
  const transaction = db.transaction([PACKET_STORE_NAME], "readonly");
  const store = transaction.objectStore(PACKET_STORE_NAME);
  const request = store
    .index(PACKET_SESSION_START_INDEX_INDEX)
    .openCursor(createPacketPageSessionRange(sessionId));

  return new Promise((resolve, reject) => {
    let pageCount = 0;
    let packetCount = 0;
    let pending = Promise.resolve();
    let settled = false;

    const fail = (error: WireValue | Error | null | undefined) => {
      if (settled) return;
      settled = true;
      logger.error("Failed to iterate scan session packet pages", {
        error: errorMessage(toWireError(error)),
        sessionId,
      });
      reject(toWireError(error));
    };

    request.onerror = () => {
      fail(request.error);
    };

    request.onsuccess = () => {
      if (settled) {
        return;
      }

      const cursor = request.result;
      if (!cursor) {
        pending
          .then(() => {
            if (settled) return;
            settled = true;
            resolve({ pageCount, packetCount });
          })
          .catch((error) => fail(error instanceof Error ? error : String(error)));
        return;
      }

      // SAFETY: packet page cursor values are PacketPageRecord rows written by this module.
      const record = cursor.value as PacketPageRecord;
      pageCount += 1;
      packetCount += record.packets.length;

      pending = pending.then(() => visitor(record));
      pending
        .then(() => {
          try {
            cursor.continue();
          } catch (error) {
            fail(error instanceof Error ? error : String(error));
          }
        })
        .catch((error) => fail(error instanceof Error ? error : String(error)));
    };
  });
}

function backfillPacketSessionSummaries(
  packetStore: IDBObjectStore,
  summaryStore: IDBObjectStore
): void {
  const request = packetStore.openCursor();
  const summaries = new Map<string, number>();

  request.onerror = () => {
    logger.error("Failed to backfill packet session summaries during upgrade", {
      error: request.error,
    });
  };

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      for (const [sessionId, packetCount] of summaries.entries()) {
        summaryStore.put({
          sessionId,
          packetCount,
        } satisfies PacketSessionSummaryRecord);
      }
      return;
    }

    // SAFETY: packet page cursor values are PacketPageRecord rows written by this module.
    const record = cursor.value as PacketPageRecord;
    if (record.sessionId) {
      summaries.set(
        record.sessionId,
        (summaries.get(record.sessionId) ?? 0) + record.packets.length
      );
    }
    cursor.continue();
  };
}

async function initScanSessionDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      logger.error("Failed to open scan session IndexedDB", {
        error: request.error,
      });
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      // SAFETY: IDBRequest events expose the request as target.
      const upgradeRequest = event.target as IDBOpenDBRequest;
      const db = upgradeRequest.result;
      const upgradeTransaction = upgradeRequest.transaction;
      const hadPacketStore = db.objectStoreNames.contains(PACKET_STORE_NAME);

      let packetStore: IDBObjectStore;
      if (!hadPacketStore) {
        db.createObjectStore(PACKET_STORE_NAME, {
          keyPath: "id",
        });
      }
      if (upgradeTransaction) {
        packetStore = upgradeTransaction.objectStore(PACKET_STORE_NAME);
      } else {
        throw new Error("Missing upgrade transaction for packetPages store");
      }
      ensureStoreIndex(packetStore, SESSION_ID_INDEX, SESSION_ID_INDEX);
      ensureStoreIndex(packetStore, "startIndex", "startIndex");
      ensureStoreIndex(
        packetStore,
        PACKET_SESSION_START_INDEX_INDEX,
        ["sessionId", "startIndex"]
      );

      let summaryStoreCreated = false;
      if (!db.objectStoreNames.contains(PACKET_SUMMARY_STORE_NAME)) {
        db.createObjectStore(PACKET_SUMMARY_STORE_NAME, {
          keyPath: "sessionId",
        });
        summaryStoreCreated = true;
      }
      if (!upgradeTransaction) {
        throw new Error("Missing upgrade transaction for packetSessionSummaries store");
      }
      const summaryStore = upgradeTransaction.objectStore(
        PACKET_SUMMARY_STORE_NAME
      );
      if (summaryStoreCreated && hadPacketStore) {
        backfillPacketSessionSummaries(packetStore, summaryStore);
      }

      let chunkStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
        db.createObjectStore(CHUNK_STORE_NAME, {
          keyPath: "id",
        });
      }
      if (upgradeTransaction) {
        chunkStore = upgradeTransaction.objectStore(CHUNK_STORE_NAME);
      } else {
        throw new Error("Missing upgrade transaction for chunkRecords store");
      }
      ensureStoreIndex(chunkStore, SESSION_ID_INDEX, SESSION_ID_INDEX);
      ensureStoreIndex(chunkStore, "chunkId", "chunkId");

      let outboxStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(PENDING_PACKET_OUTBOX_STORE_NAME)) {
        db.createObjectStore(PENDING_PACKET_OUTBOX_STORE_NAME, {
          keyPath: "id",
        });
      }
      if (upgradeTransaction) {
        outboxStore = upgradeTransaction.objectStore(
          PENDING_PACKET_OUTBOX_STORE_NAME
        );
      } else {
        throw new Error("Missing upgrade transaction for pendingPacketOutbox store");
      }
      ensureStoreIndex(outboxStore, SESSION_ID_INDEX, SESSION_ID_INDEX);
      ensureStoreIndex(
        outboxStore,
        OUTBOX_SESSION_CHUNK_PACKET_INDEX,
        ["sessionId", "chunkId", "packetIndex"]
      );
    };
  });
}

async function loadIndexedRecords<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey
): Promise<T[]> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  let request: IDBRequest<T[]>;
  try {
    request = store.index(indexName).getAll(key);
  } catch (error) {
    if (canFallbackToSessionCursor(indexName, key, error instanceof Error ? error : String(error))) {
      logger.warn("Scan session index unavailable; falling back to cursor scan", {
        error: error instanceof Error ? error : String(error),
        indexName,
        key: isStringIdbKey(key) ? key : String(key),
        storeName,
      });
      return loadSessionRecordsByCursor<T & { sessionId?: string }>(
        storeName,
        key
      );
    }
    throw error;
  }

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      // SAFETY: IndexedDB getAll() returns the typed store records for this request.
      resolve((request.result as T[]) || []);
    };
    request.onerror = (event) => {
      if (canFallbackToSessionCursor(indexName, key, request.error)) {
        event.preventDefault();
        logger.warn(
          "Scan session index request failed; falling back to cursor scan",
          {
            error: request.error,
            indexName,
            key: isStringIdbKey(key) ? key : String(key),
            storeName,
          }
        );
        loadSessionRecordsByCursor<T & { sessionId?: string }>(storeName, key)
          .then(resolve)
          .catch(reject);
        return;
      }

      logger.error("Failed to load indexed scan session records", {
        error: request.error,
        indexName,
        key: isStringIdbKey(key) ? key : String(key),
        storeName,
      });
      reject(request.error);
    };
  });
}

async function loadSessionRecordsByCursor<T extends { sessionId?: string }>(
  storeName: string,
  sessionId: string
): Promise<T[]> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  const request = store.openCursor();

  return new Promise((resolve, reject) => {
    const records: T[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(records);
        return;
      }

      // SAFETY: cursor.value is a record from the requested object store.
      const record = cursor.value as T;
      if (record.sessionId === sessionId) {
        records.push(record);
      }
      cursor.continue();
    };

    request.onerror = () => {
      logger.error("Failed to scan session records by cursor", {
        error: request.error,
        sessionId,
        storeName,
      });
      reject(request.error);
    };
  });
}

async function loadStoreRecord<T>(
  storeName: string,
  key: IDBValidKey
): Promise<T | undefined> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  const request = store.get(key);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      // SAFETY: IndexedDB get() returns the typed store record or undefined.
      resolve((request.result as T | undefined) ?? undefined);
    };
    request.onerror = () => {
      logger.error("Failed to load scan session record", {
        error: request.error,
        key: isStringIdbKey(key) ? key : String(key),
        storeName,
      });
      reject(request.error);
    };
  });
}

async function loadStoreRecords<T>(storeName: string): Promise<T[]> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      // SAFETY: IndexedDB getAll() returns the typed store records for this request.
      resolve((request.result as T[]) || []);
    };
    request.onerror = () => {
      logger.error("Failed to load scan session records", {
        error: request.error,
        storeName,
      });
      reject(request.error);
    };
  });
}

async function listSessionIdsByStoreCursor(
  storeName: string
): Promise<string[]> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  const request = store.openCursor();

  return new Promise((resolve, reject) => {
    const values = new Set<string>();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(Array.from(values).sort((a, b) => a.localeCompare(b)));
        return;
      }

      const sessionId = sessionIdFromCursorValue(cursorValueAsWire(cursor.value));
      if (sessionId) {
        values.add(sessionId);
      }
      cursor.continue();
    };

    request.onerror = () => {
      logger.error("Failed to list scan session keys by cursor", {
        error: request.error,
        storeName,
      });
      reject(request.error);
    };
  });
}

async function listUniqueIndexedStrings(
  storeName: string,
  indexName: string
): Promise<string[]> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readonly");
  const store = transaction.objectStore(storeName);
  let request: IDBRequest<IDBCursor | null>;
  try {
    request = store.index(indexName).openKeyCursor(undefined, "nextunique");
  } catch (error) {
    if (canFallbackToSessionIdList(indexName, error instanceof Error ? error : String(error))) {
      logger.warn("Scan session key index unavailable; falling back to cursor scan", {
        error: error instanceof Error ? error : String(error),
        indexName,
        storeName,
      });
      return listSessionIdsByStoreCursor(storeName);
    }
    throw error;
  }

  return new Promise((resolve, reject) => {
    const values: string[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(values);
        return;
      }

      if (isStringIdbKey(cursor.key) && cursor.key.length > 0) {
        values.push(cursor.key);
      }
      cursor.continue();
    };
    request.onerror = (event) => {
      if (canFallbackToSessionIdList(indexName, request.error)) {
        event.preventDefault();
        logger.warn(
          "Scan session key index request failed; falling back to cursor scan",
          {
            error: request.error,
            indexName,
            storeName,
          }
        );
        listSessionIdsByStoreCursor(storeName).then(resolve).catch(reject);
        return;
      }

      logger.error("Failed to list indexed scan session keys", {
        error: request.error,
        indexName,
        storeName,
      });
      reject(request.error);
    };
  });
}

async function listPacketSummaries(): Promise<
  Array<{ sessionId: string; packetCount: number }>
> {
  const summaries = await loadStoreRecords<PacketSessionSummaryRecord>(
    PACKET_SUMMARY_STORE_NAME
  );
  return summaries
    .filter(
      (summary) =>
        isWireString(summary.sessionId) &&
        summary.sessionId.length > 0 &&
        Number.isFinite(summary.packetCount) &&
        summary.packetCount > 0
    )
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    .map((summary) => ({
      sessionId: summary.sessionId,
      packetCount: summary.packetCount,
    }));
}

async function deleteSessionRecordsByCursor(
  storeName: string,
  sessionId: string
): Promise<void> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readwrite");
  const store = transaction.objectStore(storeName);
  const request = store.openCursor();

  return new Promise((resolve, reject) => {
    let cursorDone = false;
    let pendingDeletes = 0;
    let settled = false;

    const maybeResolve = () => {
      if (!settled && cursorDone && pendingDeletes === 0) {
        settled = true;
        resolve();
      }
    };

    const fail = (error: WireValue | Error | null | undefined) => {
      if (settled) return;
      settled = true;
      logger.error("Failed to delete scan session records by cursor", {
        error: errorMessage(toWireError(error)),
        sessionId,
        storeName,
      });
      reject(toWireError(error));
    };

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        cursorDone = true;
        maybeResolve();
        return;
      }

      const record = asWireObject(cursorValueAsWire(cursor.value));
      const recordId = recordIdFromCursorValue(cursorValueAsWire(cursor.value));
      if (record.sessionId === sessionId && recordId) {
        pendingDeletes += 1;
        const deleteRequest = store.delete(recordId);
        deleteRequest.onsuccess = () => {
          pendingDeletes -= 1;
          maybeResolve();
        };
        deleteRequest.onerror = () => fail(deleteRequest.error);
      }
      cursor.continue();
    };

    request.onerror = () => fail(request.error);
    transaction.onerror = transaction.onabort = () => fail(transaction.error);
  });
}

async function deletePacketSessionRecordsByCursor(
  sessionId: string
): Promise<void> {
  const db = await initScanSessionDB();
  const transaction = db.transaction(
    [PACKET_STORE_NAME, PACKET_SUMMARY_STORE_NAME],
    "readwrite"
  );
  const packetStore = transaction.objectStore(PACKET_STORE_NAME);
  const summaryStore = transaction.objectStore(PACKET_SUMMARY_STORE_NAME);
  const request = packetStore.openCursor();

  return new Promise((resolve, reject) => {
    let cursorDone = false;
    let pendingDeletes = 1;
    let settled = false;

    const maybeResolve = () => {
      if (!settled && cursorDone && pendingDeletes === 0) {
        settled = true;
        resolve();
      }
    };

    const fail = (error: WireValue | Error | null | undefined) => {
      if (settled) return;
      settled = true;
      logger.error("Failed to delete scan session packet records by cursor", {
        error: errorMessage(toWireError(error)),
        sessionId,
      });
      reject(toWireError(error));
    };

    const summaryDeleteRequest = summaryStore.delete(sessionId);
    summaryDeleteRequest.onsuccess = () => {
      pendingDeletes -= 1;
      maybeResolve();
    };
    summaryDeleteRequest.onerror = () => fail(summaryDeleteRequest.error);

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        cursorDone = true;
        maybeResolve();
        return;
      }

      const record = asWireObject(cursorValueAsWire(cursor.value));
      const recordId = recordIdFromCursorValue(cursorValueAsWire(cursor.value));
      if (record.sessionId === sessionId && recordId) {
        pendingDeletes += 1;
        const deleteRequest = packetStore.delete(recordId);
        deleteRequest.onsuccess = () => {
          pendingDeletes -= 1;
          maybeResolve();
        };
        deleteRequest.onerror = () => fail(deleteRequest.error);
      }
      cursor.continue();
    };

    request.onerror = () => fail(request.error);
    transaction.onerror = transaction.onabort = () => fail(transaction.error);
  });
}

async function deleteSessionRecords(
  storeName: string,
  sessionId: string
): Promise<void> {
  const db = await initScanSessionDB();
  const transaction = db.transaction([storeName], "readwrite");
  const store = transaction.objectStore(storeName);
  let request: IDBRequest<IDBCursorWithValue | null>;
  try {
    request = store.index(SESSION_ID_INDEX).openCursor(sessionId);
  } catch (error) {
    if (canFallbackToSessionCursor(SESSION_ID_INDEX, sessionId, error instanceof Error ? error : String(error))) {
      logger.warn("Scan session delete index unavailable; falling back to cursor scan", {
        error: error instanceof Error ? error : String(error),
        sessionId,
        storeName,
      });
      return deleteSessionRecordsByCursor(storeName, sessionId);
    }
    throw error;
  }

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      return;
    }

    const recordId = recordIdFromCursorValue(cursorValueAsWire(cursor.value));
    if (recordId) {
      store.delete(recordId);
    }
    cursor.continue();
  };

  return new Promise((resolve, reject) => {
    request.onerror = (event) => {
      if (canFallbackToSessionCursor(SESSION_ID_INDEX, sessionId, request.error)) {
        event.preventDefault();
        logger.warn(
          "Scan session delete index request failed; falling back to cursor scan",
          {
            error: request.error,
            sessionId,
            storeName,
          }
        );
        deleteSessionRecordsByCursor(storeName, sessionId)
          .then(resolve)
          .catch(reject);
        return;
      }

      logger.error("Failed to iterate scan session records for deletion", {
        error: request.error,
        sessionId,
        storeName,
      });
      reject(request.error);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => {
      logger.error("Failed to delete scan session records", {
        error: transaction.error,
        sessionId,
        storeName,
      });
      reject(transaction.error);
    };
  });
}

async function deletePacketSessionRecords(sessionId: string): Promise<void> {
  const db = await initScanSessionDB();
  const transaction = db.transaction(
    [PACKET_STORE_NAME, PACKET_SUMMARY_STORE_NAME],
    "readwrite"
  );
  const packetStore = transaction.objectStore(PACKET_STORE_NAME);
  const summaryStore = transaction.objectStore(PACKET_SUMMARY_STORE_NAME);
  let request: IDBRequest<IDBCursorWithValue | null>;
  try {
    request = packetStore.index(SESSION_ID_INDEX).openCursor(sessionId);
  } catch (error) {
    if (canFallbackToSessionCursor(SESSION_ID_INDEX, sessionId, error instanceof Error ? error : String(error))) {
      logger.warn("Scan session packet delete index unavailable; falling back to cursor scan", {
        error: error instanceof Error ? error : String(error),
        sessionId,
      });
      return deletePacketSessionRecordsByCursor(sessionId);
    }
    throw error;
  }

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      return;
    }

    const recordId = recordIdFromCursorValue(cursorValueAsWire(cursor.value));
    if (recordId) {
      packetStore.delete(recordId);
    }
    cursor.continue();
  };
  summaryStore.delete(sessionId);

  return new Promise((resolve, reject) => {
    request.onerror = (event) => {
      if (canFallbackToSessionCursor(SESSION_ID_INDEX, sessionId, request.error)) {
        event.preventDefault();
        logger.warn(
          "Scan session packet delete index request failed; falling back to cursor scan",
          {
            error: request.error,
            sessionId,
          }
        );
        deletePacketSessionRecordsByCursor(sessionId).then(resolve).catch(reject);
        return;
      }

      logger.error("Failed to iterate scan session packet records for deletion", {
        error: request.error,
        sessionId,
      });
      reject(request.error);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => {
      logger.error("Failed to delete scan session packet records", {
        error: transaction.error,
        sessionId,
      });
      reject(transaction.error);
    };
  });
}

export async function appendScanSessionPackets(
  sessionId: string,
  startIndex: number,
  packets: Uint8Array[]
): Promise<void> {
  if (!sessionId || packets.length === 0) {
    return;
  }

  const db = await initScanSessionDB();
  const transaction = db.transaction(
    [PACKET_STORE_NAME, PACKET_SUMMARY_STORE_NAME],
    "readwrite"
  );
  const packetStore = transaction.objectStore(PACKET_STORE_NAME);
  const summaryStore = transaction.objectStore(PACKET_SUMMARY_STORE_NAME);

  const pageWrites: Array<{ pageStartIndex: number; pagePackets: Uint8Array[] }> = [];
  for (let offset = 0; offset < packets.length; offset += PAGE_PACKET_COUNT) {
    pageWrites.push({
      pageStartIndex: startIndex + offset,
      pagePackets: packets
        .slice(offset, offset + PAGE_PACKET_COUNT)
        .map(normalizePacket),
    });
  }

  let basePacketCount = 0;
  let packetDelta = 0;
  let pendingPages = pageWrites.length;
  let summaryResolved = false;
  let summaryWritten = false;

  const maybeWriteSummary = () => {
    if (!summaryResolved || pendingPages > 0 || summaryWritten) {
      return;
    }

    summaryWritten = true;
    summaryStore.put({
      sessionId,
      packetCount: Math.max(0, basePacketCount + packetDelta),
    } satisfies PacketSessionSummaryRecord);
  };

  const summaryRequest = summaryStore.get(sessionId);
  summaryRequest.onsuccess = () => {
    // SAFETY: packet summary get() returns a PacketSessionSummaryRecord when present.
    const summary = summaryRequest.result as PacketSessionSummaryRecord | undefined;
    basePacketCount = summary?.packetCount ?? 0;
    summaryResolved = true;
    maybeWriteSummary();
  };

  for (const { pageStartIndex, pagePackets } of pageWrites) {
    const existingPageRequest = packetStore.get(
      packetPageId(sessionId, pageStartIndex)
    );
    existingPageRequest.onsuccess = () => {
      // SAFETY: packet page get() returns a PacketPageRecord when present.
      const existingPage = existingPageRequest.result as
        | PacketPageRecord
        | undefined;
      packetDelta += pagePackets.length - (existingPage?.packets.length ?? 0);
      packetStore.put({
        id: packetPageId(sessionId, pageStartIndex),
        sessionId,
        startIndex: pageStartIndex,
        packets: pagePackets,
      } satisfies PacketPageRecord);
      pendingPages -= 1;
      maybeWriteSummary();
    };
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      logger.error("Failed to append scan session packets", {
        error: transaction.error,
        sessionId,
        startIndex,
      });
      reject(transaction.error);
    };
  });
}

export async function loadScanSessionPackets(
  sessionId: string
): Promise<Uint8Array[]> {
  if (!sessionId) {
    return [];
  }

  const pages = await loadScanSessionPacketPages(sessionId);
  return pages.flatMap((page) => page.packets);
}

export async function loadScanSessionPacketPages(
  sessionId: string
): Promise<ScanSessionPacketPage[]> {
  if (!sessionId) {
    return [];
  }

  const pages: ScanSessionPacketPage[] = [];
  await visitPacketPageRecords(sessionId, (record) => {
    pages.push({
      startIndex: record.startIndex,
      packets: record.packets.map(normalizePacket),
    });
  });
  return pages;
}

export async function visitScanSessionPacketPages(
  sessionId: string,
  visitor: (page: ScanSessionPacketPage) => void | Promise<void>
): Promise<ScanSessionPacketPageVisitSummary> {
  return visitPacketPageRecords(sessionId, (record) =>
    visitor({
      startIndex: record.startIndex,
      packets: record.packets.map(normalizePacket),
    })
  );
}

export async function listScanSessionPacketSessionIds(): Promise<string[]> {
  const summaries = await listPacketSummaries();
  return summaries.map((summary) => summary.sessionId);
}

export async function listScanSessionPacketSummaries(): Promise<
  Array<{ sessionId: string; packetCount: number }>
> {
  return listPacketSummaries();
}

export async function countScanSessionPackets(sessionId: string): Promise<number> {
  if (!sessionId) {
    return 0;
  }

  const summary = await loadStoreRecord<PacketSessionSummaryRecord>(
    PACKET_SUMMARY_STORE_NAME,
    sessionId
  );
  return summary?.packetCount ?? 0;
}

export async function deleteScanSessionPackets(
  sessionId: string
): Promise<void> {
  if (!sessionId) {
    return;
  }

  await deletePacketSessionRecords(sessionId);
}

export async function replaceScanSessionPackets(
  sessionId: string,
  packets: Uint8Array[]
): Promise<void> {
  await deleteScanSessionPackets(sessionId);
  await appendScanSessionPackets(sessionId, 0, packets);
}

export async function replaceScanSessionPacketPages(
  sessionId: string,
  pages: ScanSessionPacketPage[]
): Promise<void> {
  await deleteScanSessionPackets(sessionId);

  for (const page of pages) {
    if (!Number.isFinite(page.startIndex) || page.startIndex < 0) {
      continue;
    }

    const normalizedPackets = page.packets.map(normalizePacket);
    if (normalizedPackets.length === 0) {
      continue;
    }

    await appendScanSessionPackets(
      sessionId,
      page.startIndex,
      normalizedPackets
    );
  }
}

export async function savePendingScanPacketOutboxRecord(
  input: PendingScanPacketOutboxInput
): Promise<void> {
  if (
    !input.sessionId ||
    !Number.isFinite(input.chunkId) ||
    input.chunkId < 0 ||
    !Number.isFinite(input.packetIndex) ||
    input.packetIndex < 0
  ) {
    return;
  }

  const id = pendingPacketOutboxId(
    input.sessionId,
    Math.trunc(input.chunkId),
    Math.trunc(input.packetIndex)
  );
  const db = await initScanSessionDB();
  const transaction = db.transaction([PENDING_PACKET_OUTBOX_STORE_NAME], "readwrite");
  const store = transaction.objectStore(PENDING_PACKET_OUTBOX_STORE_NAME);
  const existingRequest = store.get(id);

  return new Promise((resolve, reject) => {
    existingRequest.onsuccess = () => {
      // SAFETY: outbox get() returns a PendingScanPacketOutboxRecord when present.
      const existing = existingRequest.result as
        | PendingScanPacketOutboxRecord
        | undefined;
      const now = new Date().toISOString();
      store.put({
        id,
        sessionId: input.sessionId,
        chunkId: Math.trunc(input.chunkId),
        packetIndex: Math.trunc(input.packetIndex),
        packet: normalizePacket(input.packet),
        filename: input.filename,
        expectedPackets: input.expectedPackets,
        totalPackets: input.totalPackets,
        totalPacketsExact: input.totalPacketsExact,
        totalChunks: input.totalChunks,
        packetSize: input.packetSize,
        resultType: input.resultType,
        createdAt: input.createdAt ?? existing?.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
        attempts: Number.isFinite(Number(input.attempts))
          ? Number(input.attempts)
          : existing?.attempts ?? 0,
      } satisfies PendingScanPacketOutboxRecord);
    };
    existingRequest.onerror = () => {
      logger.error("Failed to load pending scan packet outbox record", {
        error: existingRequest.error,
        id,
        sessionId: input.sessionId,
      });
      reject(existingRequest.error);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => {
      logger.error("Failed to save pending scan packet outbox record", {
        error: transaction.error,
        id,
        sessionId: input.sessionId,
      });
      reject(transaction.error);
    };
  });
}

export async function loadPendingScanPacketOutboxRecords(
  sessionId: string
): Promise<PendingScanPacketOutboxRecord[]> {
  if (!sessionId) {
    return [];
  }

  const records = await loadIndexedRecords<PendingScanPacketOutboxRecord>(
    PENDING_PACKET_OUTBOX_STORE_NAME,
    SESSION_ID_INDEX,
    sessionId
  );
  return records
    .map(normalizePendingPacketOutboxRecord)
    .sort((left, right) => {
      if (left.chunkId !== right.chunkId) {
        return left.chunkId - right.chunkId;
      }
      return left.packetIndex - right.packetIndex;
    });
}

export async function deletePendingScanPacketOutboxRecord(
  sessionId: string,
  chunkId: number,
  packetIndex: number
): Promise<void> {
  if (
    !sessionId ||
    !Number.isFinite(chunkId) ||
    chunkId < 0 ||
    !Number.isFinite(packetIndex) ||
    packetIndex < 0
  ) {
    return;
  }

  const db = await initScanSessionDB();
  const transaction = db.transaction([PENDING_PACKET_OUTBOX_STORE_NAME], "readwrite");
  const store = transaction.objectStore(PENDING_PACKET_OUTBOX_STORE_NAME);
  store.delete(
    pendingPacketOutboxId(
      sessionId,
      Math.trunc(chunkId),
      Math.trunc(packetIndex)
    )
  );

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => {
      logger.error("Failed to delete pending scan packet outbox record", {
        error: transaction.error,
        sessionId,
        chunkId,
        packetIndex,
      });
      reject(transaction.error);
    };
  });
}

export async function prunePendingScanPacketOutboxRecords(
  sessionId: string,
  shouldDelete: (record: PendingScanPacketOutboxRecord) => boolean
): Promise<void> {
  if (!sessionId) {
    return;
  }
  const records = await loadPendingScanPacketOutboxRecords(sessionId);
  for (const record of records) {
    if (shouldDelete(record)) {
      await deletePendingScanPacketOutboxRecord(
        record.sessionId,
        record.chunkId,
        record.packetIndex
      );
    }
  }
}

export async function clearPendingScanPacketOutboxSession(
  sessionId: string
): Promise<void> {
  if (!sessionId) {
    return;
  }
  await deleteSessionRecords(PENDING_PACKET_OUTBOX_STORE_NAME, sessionId);
}

export async function saveScanSessionChunk(
  sessionId: string,
  chunkId: number,
  data: Uint8Array | ArrayBuffer
): Promise<void> {
  if (!sessionId || !Number.isFinite(chunkId) || chunkId < 0) {
    return;
  }

  const db = await initScanSessionDB();
  const transaction = db.transaction([CHUNK_STORE_NAME], "readwrite");
  const store = transaction.objectStore(CHUNK_STORE_NAME);
  store.put({
    id: chunkRecordId(sessionId, chunkId),
    sessionId,
    chunkId,
    data: normalizeChunkData(data),
  } satisfies ChunkRecord);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      logger.error("Failed to save scan session chunk", {
        error: transaction.error,
        sessionId,
        chunkId,
      });
      reject(transaction.error);
    };
  });
}

export async function loadScanSessionChunks(
  sessionId: string
): Promise<Array<{ id: number; data: Uint8Array }>> {
  if (!sessionId) {
    return [];
  }

  const chunks = await loadIndexedRecords<ChunkRecord>(
    CHUNK_STORE_NAME,
    "sessionId",
    sessionId
  );
  return chunks
    .sort((a, b) => a.chunkId - b.chunkId)
    .map((chunk) => ({
      id: chunk.chunkId,
      data: normalizeChunkData(chunk.data),
    }));
}

export async function listScanSessionChunkSessionIds(): Promise<string[]> {
  return listUniqueIndexedStrings(CHUNK_STORE_NAME, "sessionId");
}

export async function deleteScanSessionChunks(
  sessionId: string
): Promise<void> {
  if (!sessionId) {
    return;
  }

  await deleteSessionRecords(CHUNK_STORE_NAME, sessionId);
}
