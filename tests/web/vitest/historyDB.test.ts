import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryItem } from "@web/types";
import type { PersistedIncompleteScanItem } from "@web/types";

type StoreRecord = Map<string, unknown>;

function createFakeIndexedDB(
  historyRecords: StoreRecord,
  incompleteRecords: StoreRecord
): IDBFactory {
  const objectStoreNames = new Set<string>();

  const getStoreRecords = (name: string): StoreRecord => {
    if (name === "history") {
      return historyRecords;
    }
    if (name === "incompleteScan") {
      return incompleteRecords;
    }
    throw new Error(`Unknown object store: ${name}`);
  };

  const createTransaction = () => {
    const transaction = {
      error: null,
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      objectStore(name: string) {
        const records = getStoreRecords(name);

        return {
          createIndex: vi.fn(),
          put(value: Record<string, unknown>) {
            const key =
              name === "history" ? String(value.id) : String(value.sessionId);
            records.set(key, value);
            const request = {
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
            };
            setTimeout(() => {
              request.onsuccess?.();
              transaction.oncomplete?.();
            }, 0);
            return request;
          },
          get(key: string) {
            const request = {
              result: records.get(key),
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
            };
            setTimeout(() => {
              request.onsuccess?.();
            }, 0);
            return request;
          },
          getAll() {
            const request = {
              result: Array.from(records.values()),
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
            };
            setTimeout(() => {
              request.onsuccess?.();
            }, 0);
            return request;
          },
          delete(key: string) {
            records.delete(key);
            const request = {
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
            };
            setTimeout(() => {
              request.onsuccess?.();
              transaction.oncomplete?.();
            }, 0);
            return request;
          },
          clear() {
            records.clear();
            const request = {
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
            };
            setTimeout(() => {
              request.onsuccess?.();
              transaction.oncomplete?.();
            }, 0);
            return request;
          },
        };
      },
    };

    return transaction;
  };

  const db = {
    objectStoreNames: {
      contains(name: string) {
        return objectStoreNames.has(name);
      },
    },
    createObjectStore(name: string) {
      objectStoreNames.add(name);
      return {
        createIndex: vi.fn(),
      };
    },
    transaction() {
      return createTransaction();
    },
    close: vi.fn(),
  };

  return {
    open: vi.fn(() => {
      const request = {
        result: db,
        error: null,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | ((event: Event) => void),
      };

      setTimeout(() => {
        request.onupgradeneeded?.({ target: request } as unknown as Event);
        request.onsuccess?.();
      }, 0);

      return request;
    }),
    deleteDatabase: vi.fn(),
    cmp: vi.fn(),
    databases: vi.fn(),
  } as unknown as IDBFactory;
}

const createHistoryItem = (): HistoryItem => ({
  id: "item-1",
  type: "file",
  origin: "scanned",
  title: "scan.bin",
  subtitle: "1.0 KB",
  date: new Date().toISOString(),
  mimeType: "application/octet-stream",
});

describe("historyDB", () => {
  let historyRecords: StoreRecord;
  let incompleteRecords: StoreRecord;

  beforeEach(() => {
    vi.resetModules();
    historyRecords = new Map();
    incompleteRecords = new Map();
    global.indexedDB = createFakeIndexedDB(
      historyRecords,
      incompleteRecords
    ) as unknown as IDBFactory;
  });

  it("marks a history item as synced in IndexedDB and the in-memory store", async () => {
    const historyDB = await import("@web/services/historyDB");
    const { useHistoryStore } = await import("@web/store/historyStore");
    const item = createHistoryItem();

    useHistoryStore.setState({
      items: [item],
      incompleteItems: [],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
    });

    await historyDB.saveHistoryItem(item);
    await historyDB.markHistoryItemAsSynced(item.id, "server-1");

    expect(useHistoryStore.getState().items[0]).toMatchObject({
      id: item.id,
      isSynced: true,
      serverId: "server-1",
      syncFailed: false,
      isLocalOnly: false,
    });

    await expect(historyDB.getHistoryItemById(item.id)).resolves.toMatchObject({
      id: item.id,
      isSynced: true,
      serverId: "server-1",
      syncFailed: false,
    });
  });

  it("marks a history item as sync failed immediately in IndexedDB and the in-memory store", async () => {
    const historyDB = await import("@web/services/historyDB");
    const { useHistoryStore } = await import("@web/store/historyStore");
    const item = createHistoryItem();

    useHistoryStore.setState({
      items: [item],
      incompleteItems: [],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
    });

    await historyDB.saveHistoryItem(item);
    await historyDB.markHistoryItemAsSyncFailed(item.id, "server offline");

    expect(useHistoryStore.getState().items[0]).toMatchObject({
      id: item.id,
      isSynced: false,
      syncFailed: true,
    });
    expect(useHistoryStore.getState().items[0].syncFailedAt).toBeTruthy();

    await expect(historyDB.getHistoryItemById(item.id)).resolves.toMatchObject({
      id: item.id,
      isSynced: false,
      syncFailed: true,
    });
  });

  it("clears sync failure immediately in IndexedDB and the in-memory store", async () => {
    const historyDB = await import("@web/services/historyDB");
    const { useHistoryStore } = await import("@web/store/historyStore");
    const item: HistoryItem = {
      ...createHistoryItem(),
      syncFailed: true,
      syncFailedAt: new Date().toISOString(),
    };

    useHistoryStore.setState({
      items: [item],
      incompleteItems: [],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
    });

    await historyDB.saveHistoryItem(item);
    await historyDB.clearSyncFailedStatus(item.id);

    expect(useHistoryStore.getState().items[0]).toMatchObject({
      id: item.id,
      syncFailed: false,
      syncFailedAt: undefined,
    });

    await expect(historyDB.getHistoryItemById(item.id)).resolves.toMatchObject({
      id: item.id,
      syncFailed: false,
      syncFailedAt: undefined,
    });
  });

  it("drops legacy packet and chunk buffers when a metadata-only incomplete scan update is saved", async () => {
    const historyDB = await import("@web/services/historyDB");

    const packet = new Uint8Array([1, 2, 3]);
    const chunk = new Uint8Array([4, 5, 6]);

    await historyDB.saveIncompleteScan({
      sessionId: "scan-1",
      filename: "scan.bin",
      received: 4,
      total: 10,
      date: "10:00",
      packets: [packet],
      chunks: [{ id: 0, data: chunk }],
      chunksSaved: 1,
    } as PersistedIncompleteScanItem);

    await historyDB.saveIncompleteScan({
      sessionId: "scan-1",
      filename: "scan.bin",
      received: 6,
      total: 10,
      date: "10:01",
      chunksSaved: 1,
    });

    const saved = await historyDB.getIncompleteScanById("scan-1");

    expect(saved).toMatchObject({
      sessionId: "scan-1",
      received: 6,
      total: 10,
      chunksSaved: 1,
    });
    expect(saved?.packets).toBeUndefined();
    expect(saved?.chunks).toBeUndefined();
  });
});
