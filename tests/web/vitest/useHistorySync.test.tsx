import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHistoryStore } from "@web/store/historyStore";
import { useSettingsStore } from "@web/store/settingsStore";
import {
  acknowledgeRemoteHistoryDurablePurge,
  getRemoteHistoryServerScope,
  beginRemoteHistoryStaleSource,
  captureRemoteHistoryTombstoneVersion,
  isHistoryItemTombstoned,
  recordRemoteHistoryDeletion,
  reconcileRemoteHistoryTombstones,
  resetRemoteHistoryTombstones,
} from "@web/features/history/historyTombstones";

const {
  clearHistoryMock,
  clearIncompleteScanMock,
  deleteHistoryItemMock,
  deleteIncompleteScanMock,
  deleteScanSessionChunksMock,
  deleteScanSessionPacketsMock,
  listScanSessionChunkSessionIdsMock,
  listScanSessionPacketSummariesMock,
  loadHistoryFromIndexedDBMock,
  loadIncompleteScansMock,
  replaceScanSessionPacketsMock,
  saveScanSessionChunkMock,
  saveHistoryItemMock,
  saveIncompleteScanMock,
} = vi.hoisted(() => ({
  clearHistoryMock: vi.fn(),
  clearIncompleteScanMock: vi.fn(),
  deleteHistoryItemMock: vi.fn(),
  deleteIncompleteScanMock: vi.fn(),
  deleteScanSessionChunksMock: vi.fn(),
  deleteScanSessionPacketsMock: vi.fn(),
  listScanSessionChunkSessionIdsMock: vi.fn(),
  listScanSessionPacketSummariesMock: vi.fn(),
  loadHistoryFromIndexedDBMock: vi.fn(),
  loadIncompleteScansMock: vi.fn(),
  replaceScanSessionPacketsMock: vi.fn(),
  saveScanSessionChunkMock: vi.fn(),
  saveHistoryItemMock: vi.fn(),
  saveIncompleteScanMock: vi.fn(),
}));

vi.mock("@web/services/historyDB", () => ({
  clearHistory: clearHistoryMock,
  clearIncompleteScan: clearIncompleteScanMock,
  deleteHistoryItem: deleteHistoryItemMock,
  deleteIncompleteScan: deleteIncompleteScanMock,
  loadHistoryFromIndexedDB: loadHistoryFromIndexedDBMock,
  loadIncompleteScans: loadIncompleteScansMock,
  saveHistoryItem: saveHistoryItemMock,
  saveIncompleteScan: saveIncompleteScanMock,
}));

vi.mock("@web/services/scanSessionDB", () => ({
  deleteScanSessionChunks: deleteScanSessionChunksMock,
  deleteScanSessionPackets: deleteScanSessionPacketsMock,
  listScanSessionChunkSessionIds: listScanSessionChunkSessionIdsMock,
  listScanSessionPacketSummaries: listScanSessionPacketSummariesMock,
  replaceScanSessionPackets: replaceScanSessionPacketsMock,
  saveScanSessionChunk: saveScanSessionChunkMock,
}));

describe("useHistorySync", () => {
  beforeEach(() => {
    resetRemoteHistoryTombstones();
    vi.useFakeTimers();
    global.indexedDB = {} as IDBFactory;

    clearHistoryMock.mockReset();
    clearHistoryMock.mockResolvedValue(undefined);
    clearIncompleteScanMock.mockReset();
    clearIncompleteScanMock.mockResolvedValue(undefined);
    deleteHistoryItemMock.mockReset();
    deleteHistoryItemMock.mockResolvedValue(undefined);
    deleteIncompleteScanMock.mockReset();
    deleteIncompleteScanMock.mockResolvedValue(undefined);
    deleteScanSessionChunksMock.mockReset();
    deleteScanSessionChunksMock.mockResolvedValue(undefined);
    deleteScanSessionPacketsMock.mockReset();
    deleteScanSessionPacketsMock.mockResolvedValue(undefined);
    listScanSessionChunkSessionIdsMock.mockReset();
    listScanSessionChunkSessionIdsMock.mockResolvedValue([]);
    listScanSessionPacketSummariesMock.mockReset();
    listScanSessionPacketSummariesMock.mockResolvedValue([]);
    loadHistoryFromIndexedDBMock.mockReset();
    loadHistoryFromIndexedDBMock.mockResolvedValue([]);
    loadIncompleteScansMock.mockReset();
    loadIncompleteScansMock.mockResolvedValue([]);
    replaceScanSessionPacketsMock.mockReset();
    replaceScanSessionPacketsMock.mockResolvedValue(undefined);
    saveScanSessionChunkMock.mockReset();
    saveScanSessionChunkMock.mockResolvedValue(undefined);
    saveHistoryItemMock.mockReset();
    saveHistoryItemMock.mockResolvedValue(undefined);
    saveIncompleteScanMock.mockReset();
    saveIncompleteScanMock.mockResolvedValue(undefined);

    global.indexedDB = {} as IDBFactory;

    useHistoryStore.setState({
      items: [],
      incompleteItems: [],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
    });
    useSettingsStore.setState((state) => ({
      uploadConfig: {
        ...state.uploadConfig,
        enabled: true,
        url: "https://sync.example.test",
      },
    }));
  });

  it("isolates tombstones by canonical server scope", () => {
    const serverA = getRemoteHistoryServerScope("https://server-a.example/path");
    const serverB = getRemoteHistoryServerScope("https://server-b.example");
    const serverBackedItem = {
      id: "shared-id",
      origin: "generated" as const,
      source: "server" as const,
      type: "file" as const,
      title: "shared.gif",
      subtitle: "remote",
      date: "2026-03-29",
    };

    recordRemoteHistoryDeletion(serverA, "generated", "shared-id");
    expect(isHistoryItemTombstoned(serverA, serverBackedItem)).toBe(true);

    expect(isHistoryItemTombstoned(serverA, serverBackedItem)).toBe(true);
    expect(isHistoryItemTombstoned(serverB, serverBackedItem)).toBe(false);
  });

  it("does not let an older purge acknowledge a newer delete event", () => {
    const server = getRemoteHistoryServerScope("https://sync.example.test");
    const firstVersion = recordRemoteHistoryDeletion(
      server,
      "generated",
      "same-id"
    );
    const currentVersion = recordRemoteHistoryDeletion(
      server,
      "generated",
      "same-id"
    );

    expect(
      acknowledgeRemoteHistoryDurablePurge(
        server,
        "generated",
        "same-id",
        firstVersion
      )
    ).toBe(false);
    expect(
      acknowledgeRemoteHistoryDurablePurge(
        server,
        "generated",
        "same-id",
        currentVersion
      )
    ).toBe(true);
  });

  it("bounds confirmed tombstones only after stale hydration sources finish", () => {
    const server = getRemoteHistoryServerScope("https://sync.example.test");
    const releaseStaleSource = beginRemoteHistoryStaleSource();
    let oldestVersion = 0;
    for (let index = 0; index < 1025; index += 1) {
      const version = recordRemoteHistoryDeletion(
        server,
        "generated",
        `deleted-${index}`
      );
      if (index === 0) oldestVersion = version;
    }
    const watermark = captureRemoteHistoryTombstoneVersion();

    reconcileRemoteHistoryTombstones(server, watermark, [], [], true);
    const oldest = {
      id: "deleted-0",
      origin: "generated" as const,
      source: "server" as const,
      type: "file" as const,
      title: "old.gif",
      subtitle: "remote",
      date: "2026-03-29",
    };
    expect(isHistoryItemTombstoned(server, oldest)).toBe(true);

    releaseStaleSource();

    expect(isHistoryItemTombstoned(server, oldest)).toBe(true);
    acknowledgeRemoteHistoryDurablePurge(
      server,
      "generated",
      "deleted-0",
      oldestVersion
    );

    expect(isHistoryItemTombstoned(server, oldest)).toBe(false);
    expect(
      isHistoryItemTombstoned(server, { ...oldest, id: "deleted-1024" })
    ).toBe(true);
  });

  it("filters tombstoned completed and incomplete aliases from global IndexedDB hydration", async () => {
    let resolveHistory!: (items: Array<Record<string, unknown>>) => void;
    let resolveIncomplete!: (items: Array<Record<string, unknown>>) => void;
    loadHistoryFromIndexedDBMock.mockReturnValue(
      new Promise((resolve) => {
        resolveHistory = resolve;
      })
    );
    loadIncompleteScansMock.mockReturnValue(
      new Promise((resolve) => {
        resolveIncomplete = resolve;
      })
    );

    const { useHistorySync } = await import("@web/hooks/useHistorySync");
    renderHook(() => useHistorySync());

    const serverScope = getRemoteHistoryServerScope(
      useSettingsStore.getState().uploadConfig.url
    );
    recordRemoteHistoryDeletion(serverScope, "generated", "remote-generated-1");
    recordRemoteHistoryDeletion(serverScope, "scanned", "remote-scan-1");
    act(() => {
      useHistoryStore.setState({
        items: [
          {
            id: "local-generated-shadow",
            remoteHistoryId: "remote-generated-1",
            origin: "generated",
            source: "local",
            type: "file",
            title: "stale.gif",
            subtitle: "stale in-memory race",
            date: "2026-03-29",
            isSynced: true,
          },
        ],
        incompleteItems: [
          {
            sessionId: "local-scan-shadow",
            remoteSessionId: "remote-scan-1",
            filename: "stale.bin",
            received: 4,
            total: 10,
            date: "10:00",
            source: "local",
          },
        ],
      });
    });
    resolveHistory([
      {
        id: "local-generated-shadow",
        remoteHistoryId: "remote-generated-1",
        serverId: "remote-generated-1",
        origin: "generated",
        source: "local",
        type: "file",
        title: "stale.gif",
        subtitle: "stale",
        date: "2026-03-29",
        isSynced: true,
      },
      {
        id: "unrelated-local",
        origin: "generated",
        source: "local",
        type: "file",
        title: "keep.gif",
        subtitle: "local only",
        date: "2026-03-29",
        isLocalOnly: true,
      },
    ]);
    resolveIncomplete([
      {
        sessionId: "local-scan-shadow",
        remoteSessionId: "remote-scan-1",
        filename: "stale.bin",
        received: 4,
        total: 10,
        date: "10:00",
        source: "local",
      },
    ]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useHistoryStore.getState().items.map((item) => item.id)).toEqual([
      "unrelated-local",
    ]);
    expect(useHistoryStore.getState().incompleteItems).toEqual([]);
  });

  it("migrates legacy packets into scanSessionDB and strips them from the in-memory store", async () => {
    const packet = new Uint8Array([1, 2, 3]);
    const chunk = new Uint8Array([4, 5, 6]);
    loadIncompleteScansMock.mockResolvedValue([
      {
        sessionId: "legacy-session",
        filename: "legacy.bin",
        received: 3,
        total: 12,
        date: "10:00",
        packets: [packet],
        chunks: [{ id: 0, data: chunk }],
        chunksSaved: 1,
      },
    ]);
    listScanSessionChunkSessionIdsMock.mockResolvedValue([
      "legacy-session",
      "orphan-chunk-session",
    ]);
    listScanSessionPacketSummariesMock.mockResolvedValue([
      { sessionId: "legacy-session", packetCount: 1 },
      { sessionId: "orphan-session", packetCount: 2 },
    ]);

    const { useHistorySync } = await import("@web/hooks/useHistorySync");

    renderHook(() => useHistorySync());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replaceScanSessionPacketsMock).toHaveBeenCalledWith(
      "legacy-session",
      [packet]
    );
    expect(saveScanSessionChunkMock).toHaveBeenCalledWith(
      "legacy-session",
      0,
      chunk
    );
    expect(saveIncompleteScanMock).toHaveBeenCalledWith({
      sessionId: "legacy-session",
      filename: "legacy.bin",
      received: 3,
      total: 12,
      date: "10:00",
      chunksSaved: 1,
    });
    expect(deleteScanSessionPacketsMock).not.toHaveBeenCalledWith(
      "orphan-session"
    );
    expect(deleteScanSessionChunksMock).toHaveBeenCalledWith(
      "orphan-chunk-session"
    );
    expect(saveIncompleteScanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "orphan-session",
        received: 2,
        total: 2,
        source: "local",
      })
    );

    expect(useHistoryStore.getState().incompleteItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "legacy-session",
          filename: "legacy.bin",
          received: 3,
          total: 12,
          chunksSaved: 1,
        }),
        expect.objectContaining({
          sessionId: "orphan-session",
          received: 2,
          total: 2,
          source: "local",
        }),
      ])
    );
    useHistoryStore.getState().incompleteItems.forEach((item) => {
      expect(item).not.toHaveProperty("packets");
      expect(item).not.toHaveProperty("chunks");
    });
  });

  it("deletes packet pages for removed incomplete sessions during debounced sync", async () => {
    loadIncompleteScansMock.mockResolvedValue([
      {
        sessionId: "session-1",
        filename: "first.bin",
        received: 2,
        total: 10,
        date: "10:00",
      },
      {
        sessionId: "session-2",
        filename: "second.bin",
        received: 5,
        total: 10,
        date: "10:01",
      },
    ]);
    listScanSessionPacketSummariesMock.mockResolvedValue([
      { sessionId: "session-1", packetCount: 2 },
      { sessionId: "session-2", packetCount: 5 },
    ]);

    const { useHistorySync } = await import("@web/hooks/useHistorySync");

    renderHook(() => useHistorySync());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      useHistoryStore.setState((state) => ({
        incompleteItems: state.incompleteItems.filter(
          (item) => item.sessionId !== "session-1"
        ),
      }));
    });

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(deleteIncompleteScanMock).toHaveBeenCalledWith("session-1");
    expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith("session-1");
    expect(deleteScanSessionChunksMock).toHaveBeenCalledWith("session-1");
  });

  it("recovers packet-backed incomplete sessions before orphan cleanup runs", async () => {
    loadIncompleteScansMock.mockResolvedValue([]);
    listScanSessionPacketSummariesMock.mockResolvedValue([
      { sessionId: "session-1", packetCount: 3 },
    ]);

    const { useHistorySync } = await import("@web/hooks/useHistorySync");

    renderHook(() => useHistorySync());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteScanSessionPacketsMock).not.toHaveBeenCalledWith("session-1");
    expect(saveIncompleteScanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        received: 3,
        total: 3,
        source: "local",
      })
    );
    expect(useHistoryStore.getState().incompleteItems).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        received: 3,
        total: 3,
        source: "local",
      }),
    ]);
    expect(listScanSessionPacketSummariesMock).toHaveBeenCalledTimes(1);
  });

  it("does not recover a packet-backed alias when an existing incomplete row already owns the shared remote session", async () => {
    loadIncompleteScansMock.mockResolvedValue([
      {
        sessionId: "local-scan-1",
        remoteSessionId: "shared-session-1",
        filename: "archive.bin",
        received: 136,
        total: 1182,
        date: "10:00",
        source: "local",
      },
    ]);
    listScanSessionPacketSummariesMock.mockResolvedValue([
      { sessionId: "shared-session-1", packetCount: 265 },
    ]);

    const { useHistorySync } = await import("@web/hooks/useHistorySync");

    renderHook(() => useHistorySync());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveIncompleteScanMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "shared-session-1",
      })
    );
    expect(useHistoryStore.getState().incompleteItems).toEqual([
      expect.objectContaining({
        sessionId: "local-scan-1",
        remoteSessionId: "shared-session-1",
        received: 136,
        total: 1182,
      }),
    ]);
  });

  it("does not compact a legacy incomplete row when packet migration fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    loadIncompleteScansMock.mockResolvedValue([
      {
        sessionId: "legacy-session",
        filename: "legacy.bin",
        received: 3,
        total: 12,
        date: "10:00",
        packets: [new Uint8Array([1, 2, 3])],
      },
    ]);
    replaceScanSessionPacketsMock.mockRejectedValue(new Error("disk full"));

    const { useHistorySync } = await import("@web/hooks/useHistorySync");

    renderHook(() => useHistorySync());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveIncompleteScanMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
