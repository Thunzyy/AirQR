import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetHistoryAutoSyncDepsForTests,
  saveHistoryItemWithAutoSync,
  setHistoryAutoSyncDepsForTests,
} from "@web/services/historyDB";
import type { HistoryItem } from "@web/types";

type HistoryRecord = HistoryItem | { id: string };
type SuccessHandler = (() => void) | null;
type UpgradeHandler = ((event: Event) => void) | null;

type FakeRequest = {
  onsuccess: SuccessHandler;
  onerror: SuccessHandler;
};

type FakeOpenRequest = {
  result: FakeHistoryDb;
  error: null;
  onsuccess: SuccessHandler;
  onerror: SuccessHandler;
  onupgradeneeded: UpgradeHandler;
};

type FakeTransaction = {
  error: null;
  oncomplete: SuccessHandler;
  onerror: SuccessHandler;
  objectStore(): {
    createIndex: ReturnType<typeof vi.fn>;
    put(value: HistoryRecord): FakeRequest;
  };
};

type FakeHistoryDb = {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): { createIndex: ReturnType<typeof vi.fn> };
  transaction(): FakeTransaction;
  close: ReturnType<typeof vi.fn>;
};

function createFakeIndexedDB(historyRecords: Map<string, HistoryRecord>): IDBFactory {
  const objectStoreNames = new Set<string>();

  const db: FakeHistoryDb = {
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
      const transaction: FakeTransaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        objectStore() {
          return {
            createIndex: vi.fn(),
            put(value: HistoryRecord) {
              historyRecords.set(String(value.id), value);
              const request: FakeRequest = {
                onsuccess: null,
                onerror: null,
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
    },
    close: vi.fn(),
  };

  const factory = {
    open: vi.fn(() => {
      const request: FakeOpenRequest = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      setTimeout(() => {
        const upgradeEvent = new Event("upgradeneeded");
        Object.defineProperty(upgradeEvent, "target", { value: request });
        request.onupgradeneeded?.(upgradeEvent);
        request.onsuccess?.();
      }, 0);

      return request;
    }),
    deleteDatabase: vi.fn(),
    cmp: vi.fn(),
    databases: vi.fn(),
  };

  // SAFETY: this in-memory stub is only used in unit tests to stand in for IndexedDB.
  return factory as IDBFactory;
}

function createScannedItem(): HistoryItem {
  return {
    id: "scan-1",
    origin: "scanned",
    type: "file",
    title: "banierelink.jpg",
    subtitle: "22.05 KB",
    date: "2026-03-30",
    mimeType: "image/jpeg",
    fileData: new Uint8Array([1, 2, 3]),
  };
}

describe("historyDB auto sync", () => {
  beforeEach(() => {
    resetHistoryAutoSyncDepsForTests();
    globalThis.indexedDB = createFakeIndexedDB(new Map());
  });

  it("uses the existing auth snapshot for scanned auto-sync instead of blocking on a fresh auth probe", async () => {
    const canOptimisticallyAttemptServerSyncMock = vi.fn().mockReturnValue(false);
    const canUseServerSyncMock = vi.fn().mockResolvedValue(false);
    const isServerSyncAuthorizedSnapshotMock = vi.fn().mockReturnValue(true);
    const queueHistoryItemMock = vi.fn();
    const queueScanCompleteMock = vi.fn();

    setHistoryAutoSyncDepsForTests({
      canOptimisticallyAttemptServerSync: canOptimisticallyAttemptServerSyncMock,
      canUseServerSync: canUseServerSyncMock,
      isServerSyncAuthorizedSnapshot: isServerSyncAuthorizedSnapshotMock,
      queueHistoryItem: queueHistoryItemMock,
      queueScanComplete: queueScanCompleteMock,
    });

    await saveHistoryItemWithAutoSync(createScannedItem(), {
      enabled: true,
      url: "same-origin",
      apiKey: "",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: false,
    });

    expect(canUseServerSyncMock).not.toHaveBeenCalled();
    expect(queueScanCompleteMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: "scan-1",
        filename: "banierelink.jpg",
      }),
      expect.objectContaining({
        enabled: true,
        url: "same-origin",
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("allows scanned auto-sync to proceed optimistically when auth is still warming up", async () => {
    const canOptimisticallyAttemptServerSyncMock = vi.fn().mockReturnValue(true);
    const canUseServerSyncMock = vi.fn().mockResolvedValue(false);
    const isServerSyncAuthorizedSnapshotMock = vi.fn().mockReturnValue(false);
    const queueHistoryItemMock = vi.fn();
    const queueScanCompleteMock = vi.fn();

    setHistoryAutoSyncDepsForTests({
      canOptimisticallyAttemptServerSync: canOptimisticallyAttemptServerSyncMock,
      canUseServerSync: canUseServerSyncMock,
      isServerSyncAuthorizedSnapshot: isServerSyncAuthorizedSnapshotMock,
      queueHistoryItem: queueHistoryItemMock,
      queueScanComplete: queueScanCompleteMock,
    });

    await saveHistoryItemWithAutoSync(createScannedItem(), {
      enabled: true,
      url: "same-origin",
      apiKey: "",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: false,
    });

    expect(canOptimisticallyAttemptServerSyncMock).toHaveBeenCalled();
    expect(canUseServerSyncMock).not.toHaveBeenCalled();
    expect(queueScanCompleteMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: "scan-1",
        filename: "banierelink.jpg",
      }),
      expect.objectContaining({
        enabled: true,
        url: "same-origin",
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
