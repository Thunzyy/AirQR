import { beforeEach, describe, expect, it, vi } from "vitest";

type StoreRecord = Map<string, unknown>;

let pendingOutboxRecords: StoreRecord;

type FakeKeyRange =
  | { type: "bound"; lower: unknown[]; upper: unknown[] }
  | { type: "only"; value: unknown };

type FakeIndexedDBOptions = {
  existingObjectStoreNames?: string[];
  missingIndexes?: Record<string, string[]>;
  runUpgrade?: boolean;
  onIndexGetAll?: (args: {
    storeName: string;
    indexName: string;
    query?: unknown;
  }) => void;
  onIndexOpenCursor?: (args: {
    storeName: string;
    indexName: string;
    query?: unknown;
    direction?: string;
  }) => void;
  onStoreGetAll?: (args: { storeName: string }) => void;
  onStoreOpenCursor?: (args: { storeName: string }) => void;
};

function createFakeIndexedDB(
  packetPageRecords: StoreRecord,
  chunkRecords: StoreRecord,
  packetSummaryRecords: StoreRecord,
  options: FakeIndexedDBOptions = {}
): IDBFactory {
  const objectStoreNames = new Set(options.existingObjectStoreNames ?? []);
  const missingIndexesByStore = new Map(
    Object.entries(options.missingIndexes ?? {}).map(([storeName, indexes]) => [
      storeName,
      new Set(indexes),
    ])
  );

  const compareValues = (left: unknown, right: unknown): number => {
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        if (index >= left.length) {
          return -1;
        }
        if (index >= right.length) {
          return 1;
        }

        const compared = compareValues(left[index], right[index]);
        if (compared !== 0) {
          return compared;
        }
      }
      return 0;
    }
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left).localeCompare(String(right));
  };

  const createAsyncRequest = <TResult>(result: TResult) => {
    const request = {
      result,
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    setTimeout(() => {
      request.onsuccess?.();
    }, 0);
    return request;
  };

  const createCursorRequest = <TValue>(
    entries: Array<{ key: unknown; value?: TValue }>
  ) => {
    let index = 0;
    const request = {
      result: null as
        | null
        | {
            key: unknown;
            value?: TValue;
            continue: () => void;
          },
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
    };

    const emitCurrent = () => {
      if (index >= entries.length) {
        request.result = null;
        request.onsuccess?.();
        return;
      }

      const entry = entries[index];
      request.result = {
        key: entry.key,
        value: entry.value,
        continue: () => {
          index += 1;
          setTimeout(emitCurrent, 0);
        },
      };
      request.onsuccess?.();
    };

    setTimeout(emitCurrent, 0);
    return request;
  };

  const getStoreRecords = (name: string): StoreRecord => {
    if (name === "packetPages") {
      return packetPageRecords;
    }
    if (name === "chunkRecords") {
      return chunkRecords;
    }
    if (name === "packetSessionSummaries") {
      return packetSummaryRecords;
    }
    if (name === "pendingPacketOutbox") {
      return pendingOutboxRecords;
    }
    throw new Error(`Unknown object store: ${name}`);
  };

  const getStoreKey = (
    storeName: string,
    value: Record<string, unknown>
  ): unknown => {
    if (storeName === "packetSessionSummaries") {
      return value.sessionId;
    }
    return value.id;
  };

  const getIndexValue = (
    value: Record<string, unknown>,
    indexName: string
  ): unknown => {
    if (indexName === "sessionStartIndex") {
      return [value.sessionId, value.startIndex];
    }
    if (indexName === "sessionChunkPacket") {
      return [value.sessionId, value.chunkId, value.packetIndex];
    }
    return value[indexName];
  };

  const matchesQuery = (value: unknown, query?: unknown): boolean => {
    if (query === undefined) {
      return true;
    }

    const keyRange = query as FakeKeyRange;
    if (
      keyRange &&
      typeof keyRange === "object" &&
      "type" in keyRange &&
      keyRange.type === "bound"
    ) {
      const candidate = Array.isArray(value) ? value : [value];
      return (
        compareValues(candidate, keyRange.lower) >= 0 &&
        compareValues(candidate, keyRange.upper) <= 0
      );
    }

    if (
      keyRange &&
      typeof keyRange === "object" &&
      "type" in keyRange &&
      keyRange.type === "only"
    ) {
      return compareValues(value, keyRange.value) === 0;
    }

    return compareValues(value, query) === 0;
  };

  const isIndexMissing = (storeName: string, indexName: string): boolean =>
    missingIndexesByStore.get(storeName)?.has(indexName) ?? false;

  const markIndexCreated = (storeName: string, indexName: string): void => {
    missingIndexesByStore.get(storeName)?.delete(indexName);
  };

  const createMissingIndexError = (storeName: string, indexName: string) => {
    const message = `Index ${indexName} does not exist on ${storeName}`;
    return typeof DOMException === "function"
      ? new DOMException(message, "NotFoundError")
      : Object.assign(new Error(message), { name: "NotFoundError" });
  };

  const createTransaction = () => {
    const transaction = {
      error: null,
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      objectStore(name: string) {
        const storeName = name;
        const records = getStoreRecords(name);
        const recordValues = () => Array.from(records.values()) as Array<
          Record<string, unknown>
        >;

        return {
          indexNames: {
            contains(indexName: string) {
              return !isIndexMissing(storeName, indexName);
            },
          },
          createIndex: vi.fn((indexName: string) => {
            markIndexCreated(storeName, indexName);
          }),
          put(value: Record<string, unknown>) {
            records.set(String(getStoreKey(storeName, value)), value);
            const request = createAsyncRequest(undefined);
            setTimeout(() => {
              transaction.oncomplete?.();
            }, 0);
            return request;
          },
          get(key: string) {
            return createAsyncRequest(records.get(key));
          },
          getAll() {
            options.onStoreGetAll?.({ storeName });
            return createAsyncRequest(Array.from(records.values()));
          },
          openCursor() {
            options.onStoreOpenCursor?.({ storeName });
            const entries = recordValues()
              .sort((a, b) =>
                compareValues(getStoreKey(storeName, a), getStoreKey(storeName, b))
              )
              .map((value) => ({ key: getStoreKey(storeName, value), value }));
            return createCursorRequest(entries);
          },
          index(indexName: string) {
            if (isIndexMissing(storeName, indexName)) {
              throw createMissingIndexError(storeName, indexName);
            }

            return {
              getAll(query?: unknown) {
                options.onIndexGetAll?.({ storeName, indexName, query });
                const values = recordValues()
                  .filter((value) =>
                    matchesQuery(getIndexValue(value, indexName), query)
                  )
                  .sort((a, b) =>
                    compareValues(
                      getIndexValue(a, indexName),
                      getIndexValue(b, indexName)
                    )
                  );
                return createAsyncRequest(values);
              },
              openKeyCursor(_query?: unknown, direction?: string) {
                const keys = Array.from(
                  new Set(
                    recordValues()
                      .map((value) => getIndexValue(value, indexName))
                      .filter((value) => value !== undefined)
                  )
                ).sort(compareValues);
                const orderedKeys =
                  direction === "prev" || direction === "prevunique"
                    ? [...keys].reverse()
                    : keys;
                return createCursorRequest(
                  orderedKeys.map((key) => ({ key }))
                );
              },
              openCursor(query?: unknown, direction?: string) {
                options.onIndexOpenCursor?.({
                  storeName,
                  indexName,
                  query,
                  direction,
                });
                const values = recordValues()
                  .filter((value) =>
                    matchesQuery(getIndexValue(value, indexName), query)
                  )
                  .sort((a, b) =>
                    direction === "prev"
                      ? compareValues(
                          getIndexValue(b, indexName),
                          getIndexValue(a, indexName)
                        )
                      : compareValues(
                          getIndexValue(a, indexName),
                          getIndexValue(b, indexName)
                        )
                  );
                return createCursorRequest(
                  values.map((value) => ({
                    key: getIndexValue(value, indexName),
                    value,
                  }))
                );
              },
            };
          },
          delete(key: string) {
            records.delete(key);
            const request = createAsyncRequest(undefined);
            setTimeout(() => {
              transaction.oncomplete?.();
            }, 0);
            return request;
          },
          clear() {
            records.clear();
            const request = createAsyncRequest(undefined);
            setTimeout(() => {
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
        indexNames: {
          contains(indexName: string) {
            return !isIndexMissing(name, indexName);
          },
        },
        createIndex: vi.fn((indexName: string) => {
          markIndexCreated(name, indexName);
        }),
      };
    },
    transaction() {
      return createTransaction();
    },
    close: vi.fn(),
  };

  return {
    open: vi.fn(() => {
      const transaction = createTransaction();
      const request = {
        result: db,
        transaction,
        error: null,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | ((event: Event) => void),
      };

      setTimeout(() => {
        if (options.runUpgrade !== false) {
          request.onupgradeneeded?.({ target: request } as unknown as Event);
        }
        request.onsuccess?.();
      }, 0);

      return request;
    }),
    deleteDatabase: vi.fn(),
    cmp: vi.fn(),
    databases: vi.fn(),
  } as unknown as IDBFactory;
}

describe("scanSessionDB", () => {
  let packetPageRecords: StoreRecord;
  let chunkRecords: StoreRecord;
  let packetSummaryRecords: StoreRecord;

  beforeEach(() => {
    vi.resetModules();
    packetPageRecords = new Map();
    chunkRecords = new Map();
    packetSummaryRecords = new Map();
    pendingOutboxRecords = new Map();
    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords
    ) as unknown as IDBFactory;
    global.IDBKeyRange = {
      bound: (lower: unknown[], upper: unknown[]) => ({
        type: "bound",
        lower,
        upper,
      }),
      only: (value: unknown) => ({
        type: "only",
        value,
      }),
    } as unknown as typeof IDBKeyRange;
  });

  it("loads packets in page order after incremental appends", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    const packetA = new Uint8Array([1]);
    const packetB = new Uint8Array([2]);
    const packetC = new Uint8Array([3]);

    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [packetA, packetB]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 2, [packetC]);
    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [new Uint8Array([9])]);

    await expect(scanSessionDB.loadScanSessionPackets("scan-1")).resolves.toEqual([
      packetA,
      packetB,
      packetC,
    ]);
  });

  it("replaces existing packet pages for a session", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [new Uint8Array([1])]);
    await scanSessionDB.replaceScanSessionPackets("scan-1", [
      new Uint8Array([7]),
      new Uint8Array([8]),
      new Uint8Array([9]),
    ]);

    await expect(scanSessionDB.loadScanSessionPackets("scan-1")).resolves.toEqual([
      new Uint8Array([7]),
      new Uint8Array([8]),
      new Uint8Array([9]),
    ]);
  });

  it("replaces existing packet pages from page-shaped input without flattening first", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [new Uint8Array([1])]);
    await scanSessionDB.replaceScanSessionPacketPages("scan-1", [
      {
        startIndex: 64,
        packets: [new Uint8Array([8]), new Uint8Array([9])],
      },
      {
        startIndex: 0,
        packets: [new Uint8Array([7])],
      },
    ]);

    await expect(
      scanSessionDB.loadScanSessionPacketPages("scan-1")
    ).resolves.toEqual([
      {
        startIndex: 0,
        packets: [new Uint8Array([7])],
      },
      {
        startIndex: 64,
        packets: [new Uint8Array([8]), new Uint8Array([9])],
      },
    ]);
    await expect(scanSessionDB.countScanSessionPackets("scan-1")).resolves.toBe(3);
  });

  it("deletes packet pages for a session without touching others", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [new Uint8Array([1])]);
    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [new Uint8Array([2])]);

    await scanSessionDB.deleteScanSessionPackets("scan-1");

    await expect(scanSessionDB.loadScanSessionPackets("scan-1")).resolves.toEqual([]);
    await expect(scanSessionDB.loadScanSessionPackets("scan-2")).resolves.toEqual([
      new Uint8Array([2]),
    ]);
  });

  it("deletes packet pages through the sessionId cursor without getAll materialization", async () => {
    const indexGetAllCalls: Array<{
      storeName: string;
      indexName: string;
      query?: unknown;
    }> = [];
    const openCursorCalls: Array<{
      storeName: string;
      indexName: string;
      query?: unknown;
      direction?: string;
    }> = [];
    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords,
      {
        onIndexGetAll: (args) => {
          indexGetAllCalls.push(args);
        },
        onIndexOpenCursor: (args) => {
          openCursorCalls.push(args);
        },
      }
    ) as unknown as IDBFactory;

    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [new Uint8Array([1])]);
    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [new Uint8Array([9])]);

    await scanSessionDB.deleteScanSessionPackets("scan-1");

    expect(openCursorCalls).toContainEqual({
      storeName: "packetPages",
      indexName: "sessionId",
      query: "scan-1",
      direction: undefined,
    });
    expect(indexGetAllCalls).toEqual([]);
    expect(Array.from(packetPageRecords.keys())).toEqual(["scan-2:0"]);
    expect(packetSummaryRecords.has("scan-1")).toBe(false);
    expect(packetSummaryRecords.get("scan-2")).toEqual({
      sessionId: "scan-2",
      packetCount: 1,
    });
  });

  it("lists unique session ids that currently have packet pages", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 2, [new Uint8Array([3])]);
    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [new Uint8Array([4])]);

    await expect(scanSessionDB.listScanSessionPacketSessionIds()).resolves.toEqual([
      "scan-1",
      "scan-2",
    ]);
  });

  it("counts packets stored across all pages for a session", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 2, [
      new Uint8Array([3]),
      new Uint8Array([4]),
      new Uint8Array([5]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [new Uint8Array([9])]);

    await expect(scanSessionDB.countScanSessionPackets("scan-1")).resolves.toBe(5);
    await expect(scanSessionDB.countScanSessionPackets("scan-2")).resolves.toBe(1);
    await expect(scanSessionDB.countScanSessionPackets("missing")).resolves.toBe(0);
  });

  it("lists packet session summaries with packet counts", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [
      new Uint8Array([4]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 2, [
      new Uint8Array([3]),
    ]);

    await expect(scanSessionDB.listScanSessionPacketSummaries()).resolves.toEqual([
      { sessionId: "scan-1", packetCount: 3 },
      { sessionId: "scan-2", packetCount: 1 },
    ]);
  });

  it("loads packet pages in start-index order without flattening them", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 64, [
      new Uint8Array([7]),
      new Uint8Array([8]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [
      new Uint8Array([9]),
    ]);

    await expect(
      scanSessionDB.loadScanSessionPacketPages("scan-1")
    ).resolves.toEqual([
      {
        startIndex: 0,
        packets: [new Uint8Array([1]), new Uint8Array([2])],
      },
      {
        startIndex: 64,
        packets: [new Uint8Array([7]), new Uint8Array([8])],
      },
    ]);
  });

  it("loads packet pages through the compound session/startIndex index", async () => {
    const openCursorCalls: Array<{
      storeName: string;
      indexName: string;
      query?: unknown;
      direction?: string;
    }> = [];
    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords,
      {
        onIndexOpenCursor: (args) => {
          openCursorCalls.push(args);
        },
      }
    ) as unknown as IDBFactory;

    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-1", 64, [
      new Uint8Array([7]),
      new Uint8Array([8]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);

    await scanSessionDB.loadScanSessionPacketPages("scan-1");

    expect(openCursorCalls).toContainEqual({
      storeName: "packetPages",
      indexName: "sessionStartIndex",
      query: {
        type: "bound",
        lower: ["scan-1", 0],
        upper: ["scan-1", Number.MAX_SAFE_INTEGER],
      },
      direction: undefined,
    });
  });

  it("visits packet pages for one session in start-index order without flattening them", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [
      new Uint8Array([9]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 64, [
      new Uint8Array([7]),
      new Uint8Array([8]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);

    const visited: Array<{ startIndex: number; packets: Uint8Array[] }> = [];
    const summary = await scanSessionDB.visitScanSessionPacketPages(
      "scan-1",
      async (page) => {
        visited.push(page);
      }
    );

    expect(summary).toEqual({ pageCount: 2, packetCount: 4 });
    expect(visited).toEqual([
      {
        startIndex: 0,
        packets: [new Uint8Array([1]), new Uint8Array([2])],
      },
      {
        startIndex: 64,
        packets: [new Uint8Array([7]), new Uint8Array([8])],
      },
    ]);
  });

  it("visits packet pages through the compound session/startIndex index", async () => {
    const openCursorCalls: Array<{
      storeName: string;
      indexName: string;
      query?: unknown;
      direction?: string;
    }> = [];
    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords,
      {
        onIndexOpenCursor: (args) => {
          openCursorCalls.push(args);
        },
      }
    ) as unknown as IDBFactory;

    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [
      new Uint8Array([9]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 64, [
      new Uint8Array([7]),
      new Uint8Array([8]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);

    await scanSessionDB.visitScanSessionPacketPages("scan-1", async () => {});

    expect(openCursorCalls).toContainEqual({
      storeName: "packetPages",
      indexName: "sessionStartIndex",
      query: {
        type: "bound",
        lower: ["scan-1", 0],
        upper: ["scan-1", Number.MAX_SAFE_INTEGER],
      },
      direction: undefined,
    });
    expect(openCursorCalls).not.toContainEqual(
      expect.objectContaining({
        storeName: "packetPages",
        indexName: "startIndex",
      })
    );
  });

  it("lists packet session summaries without scanning packet page rows", async () => {
    const packetPageStoreScans: string[] = [];
    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords,
      {
        onStoreOpenCursor: ({ storeName }) => {
          if (storeName === "packetPages") {
            packetPageStoreScans.push(storeName);
          }
        },
        onIndexOpenCursor: ({ storeName }) => {
          if (storeName === "packetPages") {
            packetPageStoreScans.push(storeName);
          }
        },
        onIndexGetAll: ({ storeName }) => {
          if (storeName === "packetPages") {
            packetPageStoreScans.push(storeName);
          }
        },
      }
    ) as unknown as IDBFactory;

    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.appendScanSessionPackets("scan-2", 0, [
      new Uint8Array([4]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 0, [
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);
    await scanSessionDB.appendScanSessionPackets("scan-1", 2, [
      new Uint8Array([3]),
    ]);
    packetPageStoreScans.length = 0;

    await expect(scanSessionDB.listScanSessionPacketSummaries()).resolves.toEqual([
      { sessionId: "scan-1", packetCount: 3 },
      { sessionId: "scan-2", packetCount: 1 },
    ]);

    expect(packetPageStoreScans).toEqual([]);
  });

  it("backfills packet session summaries during upgrade from existing packet pages", async () => {
    packetPageRecords.set("scan-1:0", {
      id: "scan-1:0",
      sessionId: "scan-1",
      startIndex: 0,
      packets: [new Uint8Array([1]), new Uint8Array([2])],
    });
    packetPageRecords.set("scan-1:2", {
      id: "scan-1:2",
      sessionId: "scan-1",
      startIndex: 2,
      packets: [new Uint8Array([3])],
    });
    packetPageRecords.set("scan-2:0", {
      id: "scan-2:0",
      sessionId: "scan-2",
      startIndex: 0,
      packets: [new Uint8Array([9])],
    });

    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords,
      {
        existingObjectStoreNames: ["packetPages", "chunkRecords"],
      }
    ) as unknown as IDBFactory;

    const scanSessionDB = await import("@web/services/scanSessionDB");
    await scanSessionDB.loadScanSessionPacketPages("scan-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(scanSessionDB.listScanSessionPacketSummaries()).resolves.toEqual([
      { sessionId: "scan-1", packetCount: 3 },
      { sessionId: "scan-2", packetCount: 1 },
    ]);
  });

  it("saves and loads pending scan packet outbox records in packet order", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.savePendingScanPacketOutboxRecord({
      sessionId: "scan-1",
      chunkId: 1,
      packetIndex: 2,
      packet: new Uint8Array([3]),
      filename: "scan.bin",
      expectedPackets: 10,
      totalPackets: 12,
      totalPacketsExact: true,
      totalChunks: 2,
      packetSize: 1,
      resultType: "progress",
    });
    await scanSessionDB.savePendingScanPacketOutboxRecord({
      sessionId: "scan-1",
      chunkId: 0,
      packetIndex: 1,
      packet: new Uint8Array([2]),
    });
    await scanSessionDB.savePendingScanPacketOutboxRecord({
      sessionId: "scan-2",
      chunkId: 0,
      packetIndex: 0,
      packet: new Uint8Array([9]),
    });

    await expect(
      scanSessionDB.loadPendingScanPacketOutboxRecords("scan-1")
    ).resolves.toEqual([
      expect.objectContaining({
        id: "scan-1:0:1",
        sessionId: "scan-1",
        chunkId: 0,
        packetIndex: 1,
        packet: new Uint8Array([2]),
        attempts: 0,
      }),
      expect.objectContaining({
        id: "scan-1:1:2",
        sessionId: "scan-1",
        chunkId: 1,
        packetIndex: 2,
        packet: new Uint8Array([3]),
        filename: "scan.bin",
        expectedPackets: 10,
        totalPackets: 12,
        totalPacketsExact: true,
        totalChunks: 2,
        packetSize: 1,
        resultType: "progress",
      }),
    ]);
  });

  it("deletes one pending scan packet outbox record", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.savePendingScanPacketOutboxRecord({
      sessionId: "scan-1",
      chunkId: 0,
      packetIndex: 0,
      packet: new Uint8Array([1]),
    });
    await scanSessionDB.savePendingScanPacketOutboxRecord({
      sessionId: "scan-1",
      chunkId: 0,
      packetIndex: 1,
      packet: new Uint8Array([2]),
    });

    await scanSessionDB.deletePendingScanPacketOutboxRecord("scan-1", 0, 0);

    await expect(
      scanSessionDB.loadPendingScanPacketOutboxRecords("scan-1")
    ).resolves.toEqual([
      expect.objectContaining({
        id: "scan-1:0:1",
        packet: new Uint8Array([2]),
      }),
    ]);
  });

  it("prunes pending scan packet outbox records with a predicate", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    for (const packetIndex of [0, 1, 2]) {
      await scanSessionDB.savePendingScanPacketOutboxRecord({
        sessionId: "scan-1",
        chunkId: 0,
        packetIndex,
        packet: new Uint8Array([packetIndex]),
      });
    }

    await scanSessionDB.prunePendingScanPacketOutboxRecords(
      "scan-1",
      (record) => record.packetIndex <= 1
    );

    await expect(
      scanSessionDB.loadPendingScanPacketOutboxRecords("scan-1")
    ).resolves.toEqual([
      expect.objectContaining({
        id: "scan-1:0:2",
        packetIndex: 2,
      }),
    ]);
  });

  it("clears pending scan packet outbox records for one session", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.savePendingScanPacketOutboxRecord({
      sessionId: "scan-1",
      chunkId: 0,
      packetIndex: 0,
      packet: new Uint8Array([1]),
    });
    await scanSessionDB.savePendingScanPacketOutboxRecord({
      sessionId: "scan-2",
      chunkId: 0,
      packetIndex: 0,
      packet: new Uint8Array([2]),
    });

    await scanSessionDB.clearPendingScanPacketOutboxSession("scan-1");

    await expect(
      scanSessionDB.loadPendingScanPacketOutboxRecords("scan-1")
    ).resolves.toEqual([]);
    await expect(
      scanSessionDB.loadPendingScanPacketOutboxRecords("scan-2")
    ).resolves.toEqual([
      expect.objectContaining({
        id: "scan-2:0:0",
        packet: new Uint8Array([2]),
      }),
    ]);
  });

  it("saves and loads scan session chunks in chunk order", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.saveScanSessionChunk("scan-1", 2, new Uint8Array([3]));
    await scanSessionDB.saveScanSessionChunk("scan-1", 0, new Uint8Array([1]));
    await scanSessionDB.saveScanSessionChunk("scan-1", 1, new Uint8Array([2]));
    await scanSessionDB.saveScanSessionChunk("scan-2", 0, new Uint8Array([9]));

    await expect(scanSessionDB.loadScanSessionChunks("scan-1")).resolves.toEqual([
      { id: 0, data: new Uint8Array([1]) },
      { id: 1, data: new Uint8Array([2]) },
      { id: 2, data: new Uint8Array([3]) },
    ]);
  });

  it("deletes chunk records for a session without touching others", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.saveScanSessionChunk("scan-1", 0, new Uint8Array([1]));
    await scanSessionDB.saveScanSessionChunk("scan-2", 0, new Uint8Array([2]));

    await scanSessionDB.deleteScanSessionChunks("scan-1");

    await expect(scanSessionDB.loadScanSessionChunks("scan-1")).resolves.toEqual([]);
    await expect(scanSessionDB.loadScanSessionChunks("scan-2")).resolves.toEqual([
      { id: 0, data: new Uint8Array([2]) },
    ]);
  });

  it("deletes chunk records through the sessionId cursor without getAll materialization", async () => {
    const indexGetAllCalls: Array<{
      storeName: string;
      indexName: string;
      query?: unknown;
    }> = [];
    const openCursorCalls: Array<{
      storeName: string;
      indexName: string;
      query?: unknown;
      direction?: string;
    }> = [];
    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords,
      {
        onIndexGetAll: (args) => {
          indexGetAllCalls.push(args);
        },
        onIndexOpenCursor: (args) => {
          openCursorCalls.push(args);
        },
      }
    ) as unknown as IDBFactory;

    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.saveScanSessionChunk("scan-1", 0, new Uint8Array([1]));
    await scanSessionDB.saveScanSessionChunk("scan-2", 0, new Uint8Array([9]));

    await scanSessionDB.deleteScanSessionChunks("scan-1");

    expect(openCursorCalls).toContainEqual({
      storeName: "chunkRecords",
      indexName: "sessionId",
      query: "scan-1",
      direction: undefined,
    });
    expect(indexGetAllCalls).toEqual([]);
    expect(Array.from(chunkRecords.keys())).toEqual(["scan-2:0"]);
  });

  it("lists unique session ids that currently have chunk records", async () => {
    const scanSessionDB = await import("@web/services/scanSessionDB");

    await scanSessionDB.saveScanSessionChunk("scan-1", 0, new Uint8Array([1]));
    await scanSessionDB.saveScanSessionChunk("scan-1", 1, new Uint8Array([2]));
    await scanSessionDB.saveScanSessionChunk("scan-2", 0, new Uint8Array([3]));

    await expect(scanSessionDB.listScanSessionChunkSessionIds()).resolves.toEqual([
      "scan-1",
      "scan-2",
    ]);
  });

  it("continues reading chunk records when an existing mobile database is missing the sessionId index", async () => {
    chunkRecords.set("scan-1:0", {
      id: "scan-1:0",
      sessionId: "scan-1",
      chunkId: 0,
      data: new Uint8Array([1]),
    });
    chunkRecords.set("scan-1:1", {
      id: "scan-1:1",
      sessionId: "scan-1",
      chunkId: 1,
      data: new Uint8Array([2]),
    });
    chunkRecords.set("scan-2:0", {
      id: "scan-2:0",
      sessionId: "scan-2",
      chunkId: 0,
      data: new Uint8Array([9]),
    });

    global.indexedDB = createFakeIndexedDB(
      packetPageRecords,
      chunkRecords,
      packetSummaryRecords,
      {
        existingObjectStoreNames: [
          "packetPages",
          "packetSessionSummaries",
          "chunkRecords",
        ],
        missingIndexes: {
          chunkRecords: ["sessionId"],
        },
        runUpgrade: false,
      }
    ) as unknown as IDBFactory;

    const scanSessionDB = await import("@web/services/scanSessionDB");

    await expect(scanSessionDB.listScanSessionChunkSessionIds()).resolves.toEqual([
      "scan-1",
      "scan-2",
    ]);
    await expect(scanSessionDB.loadScanSessionChunks("scan-1")).resolves.toEqual([
      { id: 0, data: new Uint8Array([1]) },
      { id: 1, data: new Uint8Array([2]) },
    ]);

    await scanSessionDB.deleteScanSessionChunks("scan-1");

    await expect(scanSessionDB.loadScanSessionChunks("scan-1")).resolves.toEqual([]);
    await expect(scanSessionDB.listScanSessionChunkSessionIds()).resolves.toEqual([
      "scan-2",
    ]);
  });
});
