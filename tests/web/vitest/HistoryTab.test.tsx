import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HistoryTab from "@web/components/tabs/HistoryTab";
import { resetServerAuthStatusCache } from "@web/services/serverAuth";
import { useHistoryStore, useSettingsStore, useToastStore } from "@web/store";
import { resetRemoteHistoryTombstones } from "@web/features/history/historyTombstones";
import * as historyTombstones from "@web/features/history/historyTombstones";

const {
  appendScanSessionPacketsMock,
  clearSyncFailedStatusMock,
  connectMock,
  countScanSessionPacketsMock,
  deleteHistoryItemMock,
  deleteIncompleteScanMock,
  deleteScanSessionChunksMock,
  deleteScanSessionPacketsMock,
  deleteServerHistoryItemMock,
  deleteServerSessionMock,
  disconnectMock,
  enableSyncForHistoryItemMock,
  fetchServerFileMock,
  fetchServerHistoryFileMock,
  fetchServerHistoryMock,
  fetchServerPacketsMock,
  fetchServerSessionMock,
  getHistoryItemByIdMock,
  getIncompleteScanByIdMock,
  loadHistoryFromIndexedDBMock,
  loadIncompleteScansMock,
  loadScanSessionPacketPagesMock,
  loadScanSessionPacketsMock,
  markHistoryItemAsLocalOnlyMock,
  markHistoryItemAsSyncFailedMock,
  markHistoryItemAsSyncedMock,
  queueHistoryItemMock,
  queueScanCompleteMock,
  queueScanPacketMock,
  replaceScanSessionPacketPagesMock,
  replaceScanSessionPacketsMock,
  saveHistoryItemMock,
  saveIncompleteScanMock,
  visitScanSessionPacketPagesMock,
  historyPropsMock,
  subscribeMock,
  unsubscribeMock,
} = vi.hoisted(() => ({
  appendScanSessionPacketsMock: vi.fn(),
  clearSyncFailedStatusMock: vi.fn(),
  connectMock: vi.fn(),
  countScanSessionPacketsMock: vi.fn(),
  deleteHistoryItemMock: vi.fn(),
  deleteIncompleteScanMock: vi.fn(),
  deleteScanSessionChunksMock: vi.fn(),
  deleteScanSessionPacketsMock: vi.fn(),
  deleteServerHistoryItemMock: vi.fn(),
  deleteServerSessionMock: vi.fn(),
  disconnectMock: vi.fn(),
  enableSyncForHistoryItemMock: vi.fn(),
  fetchServerFileMock: vi.fn(),
  fetchServerHistoryFileMock: vi.fn(),
  fetchServerHistoryMock: vi.fn(),
  fetchServerPacketsMock: vi.fn(),
  fetchServerSessionMock: vi.fn(),
  getHistoryItemByIdMock: vi.fn(),
  getIncompleteScanByIdMock: vi.fn(),
  loadHistoryFromIndexedDBMock: vi.fn(),
  loadIncompleteScansMock: vi.fn(),
  loadScanSessionPacketPagesMock: vi.fn(),
  loadScanSessionPacketsMock: vi.fn(),
  markHistoryItemAsLocalOnlyMock: vi.fn(),
  markHistoryItemAsSyncFailedMock: vi.fn(),
  markHistoryItemAsSyncedMock: vi.fn(),
  queueHistoryItemMock: vi.fn(),
  queueScanCompleteMock: vi.fn(),
  queueScanPacketMock: vi.fn(),
  replaceScanSessionPacketPagesMock: vi.fn(),
  replaceScanSessionPacketsMock: vi.fn(),
  saveHistoryItemMock: vi.fn(),
  saveIncompleteScanMock: vi.fn(),
  visitScanSessionPacketPagesMock: vi.fn(),
  historyPropsMock: vi.fn(),
  subscribeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("@web/features/history/History", () => ({
  default: (props: unknown) => {
    historyPropsMock(props);
    return <div data-testid="history-tab-stub" />;
  },
}));

vi.mock("@web/components/media/GifPlayer", () => ({
  default: () => <div data-testid="history-preview-gif-player" />,
}));

vi.mock("@web/services/historyDB", () => ({
  getHistoryItemById: getHistoryItemByIdMock,
  getIncompleteScanById: getIncompleteScanByIdMock,
  loadHistoryFromIndexedDB: loadHistoryFromIndexedDBMock,
  loadIncompleteScans: loadIncompleteScansMock,
  deleteHistoryItem: deleteHistoryItemMock,
  markHistoryItemAsLocalOnly: markHistoryItemAsLocalOnlyMock,
  enableSyncForHistoryItem: enableSyncForHistoryItemMock,
  saveHistoryItem: saveHistoryItemMock,
  markHistoryItemAsSynced: markHistoryItemAsSyncedMock,
  clearSyncFailedStatus: clearSyncFailedStatusMock,
  markHistoryItemAsSyncFailed: markHistoryItemAsSyncFailedMock,
  deleteIncompleteScan: deleteIncompleteScanMock,
  saveIncompleteScan: saveIncompleteScanMock,
}));

vi.mock("@web/services/scanSyncService", () => ({
  deleteServerSession: deleteServerSessionMock,
  deleteServerHistoryItem: deleteServerHistoryItemMock,
  fetchServerFile: fetchServerFileMock,
  fetchServerHistoryFile: fetchServerHistoryFileMock,
  fetchServerHistory: fetchServerHistoryMock,
  fetchServerPackets: fetchServerPacketsMock,
  fetchServerSession: fetchServerSessionMock,
}));

vi.mock("@web/services/scanSessionDB", () => ({
  SCAN_SESSION_PACKET_PAGE_SIZE: 64,
  appendScanSessionPackets: appendScanSessionPacketsMock,
  countScanSessionPackets: countScanSessionPacketsMock,
  deleteScanSessionChunks: deleteScanSessionChunksMock,
  deleteScanSessionPackets: deleteScanSessionPacketsMock,
  loadScanSessionPacketPages: loadScanSessionPacketPagesMock,
  loadScanSessionPackets: loadScanSessionPacketsMock,
  replaceScanSessionPacketPages: replaceScanSessionPacketPagesMock,
  replaceScanSessionPackets: replaceScanSessionPacketsMock,
  visitScanSessionPacketPages: visitScanSessionPacketPagesMock,
}));

vi.mock("@web/services/scanUploadService", () => ({
  queueHistoryItem: queueHistoryItemMock,
  queueScanComplete: queueScanCompleteMock,
  queueScanPacket: queueScanPacketMock,
}));

vi.mock("@web/services/websocketSyncService", () => ({
  getWebSocketSyncService: () => ({
    connect: connectMock,
    disconnect: disconnectMock,
    subscribe: subscribeMock.mockImplementation(() => unsubscribeMock),
  }),
}));

describe("HistoryTab", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };
  const buildStreamingPacket = ({
    sessionId,
    chunkId,
    totalChunks,
    packetIndex,
    totalSize,
    packetSize,
    exactChunkPackets,
  }: {
    sessionId: number;
    chunkId: number;
    totalChunks: number;
    packetIndex: number;
    totalSize: number;
    packetSize: number;
    exactChunkPackets: number;
  }): Uint8Array => {
    const payload = new Uint8Array(36);
    const view = new DataView(payload.buffer);
    view.setUint8(0, 2);
    view.setUint32(1, sessionId, false);
    view.setUint32(5, chunkId, false);
    view.setUint32(9, totalChunks, false);
    view.setBigUint64(13, 0n, false);
    view.setUint32(21, totalSize, false);
    view.setUint16(25, packetSize, false);
    view.setUint32(27, exactChunkPackets, false);
    view.setUint32(31, packetIndex, false);
    view.setUint8(35, 0xaa);
    return payload;
  };
  const getHistoryProps = () =>
    historyPropsMock.mock.calls.at(-1)?.[0] as
      | {
          onResume?: (item: {
            sessionId: string;
            filename: string;
            received: number;
            total: number;
            date: string;
            source?: "local" | "server";
            remoteSessionId?: string;
          }) => void;
          onKeepLocalIncomplete?: (item: {
            sessionId: string;
            filename: string;
            received: number;
            total: number;
            date: string;
            source?: "local" | "server";
            remoteSessionId?: string;
          }) => Promise<void>;
          onSyncItem?: (item: {
            id: string;
            origin: "generated" | "scanned";
            title: string;
            subtitle: string;
            date: string;
            type: "file";
            mimeType: string;
            isLocalOnly?: boolean;
            isSynced?: boolean;
            syncFailed?: boolean;
          }) => Promise<void>;
          onSyncIncomplete?: (item: {
            sessionId: string;
            filename: string;
            received: number;
            total: number;
            date: string;
            source?: "local" | "server";
            remoteSessionId?: string;
          }) => Promise<void>;
          onSyncToServer?: () => Promise<void>;
          onClearHistory?: () => Promise<void>;
          onView?: (item: {
            id: string;
            origin: "generated" | "scanned";
            title: string;
            subtitle: string;
            date: string;
            type: "file" | "text";
            mimeType: string;
            size?: number;
            source?: "local" | "server";
            fileData?: Uint8Array;
          }) => Promise<void>;
          syncStatusLabel?: string;
        }
      | undefined;

  beforeEach(() => {
    resetRemoteHistoryTombstones();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    resetServerAuthStatusCache();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ enabled: false, authorized: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    historyPropsMock.mockReset();
    unsubscribeMock.mockReset();
    subscribeMock.mockImplementation(() => unsubscribeMock);
    fetchServerHistoryMock.mockResolvedValue({
      entries: [],
      etag: "etag-1",
      totalCount: 0,
    });
    countScanSessionPacketsMock.mockResolvedValue(0);
    loadHistoryFromIndexedDBMock.mockResolvedValue([]);
    loadIncompleteScansMock.mockResolvedValue([]);
    loadScanSessionPacketPagesMock.mockResolvedValue([]);
    loadScanSessionPacketsMock.mockResolvedValue([]);
    replaceScanSessionPacketPagesMock.mockResolvedValue(undefined);
    replaceScanSessionPacketsMock.mockResolvedValue(undefined);
    visitScanSessionPacketPagesMock.mockImplementation(
      async (
        sessionId: string,
        visitor: (page: { startIndex: number; packets: Uint8Array[] }) => void | Promise<void>
      ) => {
        const pages =
          (await loadScanSessionPacketPagesMock(sessionId)) as Array<{
            startIndex: number;
            packets: Uint8Array[];
          }>;
        for (const page of pages) {
          await visitor(page);
        }
        return {
          pageCount: pages.length,
          packetCount: pages.reduce((count, page) => count + page.packets.length, 0),
        };
      }
    );
    getIncompleteScanByIdMock.mockResolvedValue(null);
    markHistoryItemAsSyncedMock.mockResolvedValue(undefined);
    saveIncompleteScanMock.mockResolvedValue(undefined);
    deleteHistoryItemMock.mockResolvedValue(undefined);
    deleteIncompleteScanMock.mockResolvedValue(undefined);
    deleteScanSessionChunksMock.mockResolvedValue(undefined);
    deleteScanSessionPacketsMock.mockResolvedValue(undefined);
    appendScanSessionPacketsMock.mockResolvedValue(undefined);
    queueScanPacketMock.mockReset();

    useHistoryStore.setState({
      items: [],
      incompleteItems: [
        {
          sessionId: "scan-1",
          filename: "archive.bin",
          received: 6,
          total: 20,
          date: "10:00",
          source: "local",
        },
      ],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    });
    useToastStore.setState({
      message: "",
      type: "info",
      visible: false,
      show: useToastStore.getState().show,
      hide: useToastStore.getState().hide,
    });

    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: "https://sync.example.com",
        apiKey: "",
        username: "",
        password: "",
        syncScanned: true,
        syncGenerated: true,
        autoSyncHistory: true,
      },
    });
  });

  it("waits for the first server refresh before backfilling local incomplete packets", async () => {
    let resolveFetch:
      | ((value: {
          entries: Array<Record<string, unknown>>;
          etag?: string;
          totalCount?: number;
        }) => void)
      | null = null;
    fetchServerHistoryMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    countScanSessionPacketsMock.mockResolvedValue(2);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
      });
      return { pageCount: 1, packetCount: 2 };
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 6,
      total: 20,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledTimes(1);
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(loadScanSessionPacketPagesMock).not.toHaveBeenCalled();
    expect(queueScanPacketMock).not.toHaveBeenCalled();

    act(() => {
      resolveFetch?.({
        entries: [
          {
            sessionId: "scan-1",
            filename: "archive.bin",
            completed: false,
            receivedPackets: 2,
            totalPackets: 20,
            updatedAt: new Date("2026-03-29T10:00:00.000Z").toISOString(),
          },
        ],
        etag: "etag-2",
        totalCount: 1,
      });
    });

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        "scan-1",
        expect.any(Function)
      );
    });
    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(2);
    });
    expect(loadScanSessionPacketPagesMock).not.toHaveBeenCalled();
    expect(loadScanSessionPacketsMock).not.toHaveBeenCalled();
  });

  it("backfills streaming packets using their embedded transport identity", async () => {
    const sharedSessionId = "1775220640";
    const streamingPacket = buildStreamingPacket({
      sessionId: Number(sharedSessionId),
      chunkId: 1,
      totalChunks: 3,
      packetIndex: 77,
      totalSize: 315200,
      packetSize: 800,
      exactChunkPackets: 472,
    });

    useHistoryStore.setState({
      items: [],
      incompleteItems: [
        {
          sessionId: "local-scan-1",
          remoteSessionId: sharedSessionId,
          filename: "archive.bin",
          received: 136,
          total: 1182,
          date: "10:00",
          source: "local",
          totalChunks: 3,
          chunksSaved: 1,
        },
      ],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    });

    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          sessionId: sharedSessionId,
          filename: "archive.bin",
          completed: false,
          receivedPackets: 20,
          expectedPackets: 1182,
          totalPackets: 1416,
          totalChunks: 3,
          updatedAt: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        },
      ],
      etag: "etag-transport",
      totalCount: 1,
    });
    countScanSessionPacketsMock.mockResolvedValue(1);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [streamingPacket],
      });
      return { pageCount: 1, packetCount: 1 };
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "local-scan-1",
      remoteSessionId: sharedSessionId,
      filename: "archive.bin",
      received: 136,
      total: 1182,
      totalChunks: 3,
      chunksSaved: 1,
      packets: [streamingPacket],
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledWith(
        streamingPacket,
        expect.objectContaining({
          sessionId: sharedSessionId,
          isStreaming: true,
          chunkId: 1,
          packetIndex: 77,
          totalChunks: 3,
        }),
        expect.any(Object)
      );
    });
  });

  it("queues a second refresh when a history event arrives during an in-flight load", async () => {
    let resolveFirstFetch:
      | ((value: {
          entries: Array<Record<string, unknown>>;
          etag?: string;
          totalCount?: number;
        }) => void)
      | null = null;

    fetchServerHistoryMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstFetch = resolve;
          })
      )
      .mockResolvedValueOnce({
        entries: [
          {
            historyId: "generated-queued-1",
            origin: "generated",
            title: "Queued Generated",
            filename: "queued-generated.zip",
            mimeType: "application/zip",
            size: 128,
            createdAt: "2026-03-29T21:29:45.752Z",
            updatedAt: "2026-03-29T21:29:45.752Z",
          },
        ],
        etag: "etag-2",
        totalCount: 1,
      });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledTimes(1);
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;
    expect(eventHandler).toBeTypeOf("function");

    act(() => {
      eventHandler?.({
        type: "history",
        payload: {
          type: "history-item",
          origin: "generated",
          historyId: "generated-queued-1",
        },
      });
    });

    expect(fetchServerHistoryMock).toHaveBeenCalledTimes(1);

    act(() => {
      resolveFirstFetch?.({
        entries: [],
        etag: "etag-1",
        totalCount: 0,
      });
    });

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      const renderedItems = (historyPropsMock.mock.calls.at(-1)?.[0] as {
        items?: Array<{ id: string; title: string; isSynced?: boolean }>;
      })?.items;
      expect(renderedItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "generated-queued-1",
            title: "Queued Generated",
            isSynced: true,
          }),
        ])
      );
    });
  });

  it("renders the history preview as a modal dialog and closes it on Escape", async () => {
    const historyItem = {
      id: "history-preview-1",
      origin: "generated" as const,
      type: "file" as const,
      title: "clip.gif",
      subtitle: "2026-03-29 - 22:29 - 256 B",
      date: "2026-03-29",
      mimeType: "image/gif",
      size: 256,
      source: "local" as const,
      fileData: new Uint8Array([71, 73, 70]),
    };

    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [historyItem],
      incompleteItems: [],
    });
    getHistoryItemByIdMock.mockResolvedValue(historyItem);

    render(<HistoryTab />);

    await waitFor(() => {
      expect(getHistoryProps()?.onView).toBeTypeOf("function");
    });

    await act(async () => {
      await getHistoryProps()?.onView?.(historyItem);
    });

    const dialog = await screen.findByRole("dialog", { name: /clip\.gif/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("qr-preview-scroll")).toHaveClass(
      "h-[clamp(300px,calc(100vw-24px),420px)]",
      "min-h-0",
      "sm:h-[min(64dvh,720px)]",
      "sm:min-h-[360px]",
    );
    expect(
      within(dialog).getAllByRole("button", { name: "Download file" }),
    ).toHaveLength(1);
    expect(screen.queryByTestId("qr-viewer-actions")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /clip\.gif/i })
      ).not.toBeInTheDocument();
    });
  });

  it("renders image, video, and PDF transfers in the history preview modal", async () => {
    const fileData = new Uint8Array([1, 2, 3]);
    const previewItems = [
      {
        id: "history-image-preview",
        origin: "scanned" as const,
        type: "file" as const,
        title: "photo.jpg",
        subtitle: "2026-03-29 - 22:29 - 256 B",
        date: "2026-03-29",
        mimeType: "image/jpeg",
        size: 256,
        source: "local" as const,
        fileData,
      },
      {
        id: "history-video-preview",
        origin: "scanned" as const,
        type: "file" as const,
        title: "clip.mp4",
        subtitle: "2026-03-29 - 22:29 - 512 B",
        date: "2026-03-29",
        mimeType: "video/mp4",
        size: 512,
        source: "local" as const,
        fileData,
      },
      {
        id: "history-pdf-preview",
        origin: "scanned" as const,
        type: "file" as const,
        title: "report.pdf",
        subtitle: "2026-03-29 - 22:29 - 1 KB",
        date: "2026-03-29",
        mimeType: "application/pdf",
        size: 1024,
        source: "local" as const,
        fileData,
      },
    ];

    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: previewItems,
      incompleteItems: [],
    });
    getHistoryItemByIdMock.mockImplementation(async (id: string) =>
      previewItems.find((item) => item.id === id) ?? null
    );

    render(<HistoryTab />);

    await waitFor(() => {
      expect(getHistoryProps()?.onView).toBeTypeOf("function");
    });

    await act(async () => {
      await getHistoryProps()?.onView?.(previewItems[0]);
    });
    expect(await screen.findByRole("img", { name: /photo\.jpg/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download file" })
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: /photo\.jpg/i })).not.toBeInTheDocument();
    });

    await act(async () => {
      await getHistoryProps()?.onView?.(previewItems[1]);
    });
    const video = await screen.findByTestId("history-video-preview");
    expect(video).toHaveAttribute("controls");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("history-video-preview")).not.toBeInTheDocument();
    });

    await act(async () => {
      await getHistoryProps()?.onView?.(previewItems[2]);
    });
    expect(await screen.findByTitle("report.pdf")).toHaveAttribute(
      "type",
      "application/pdf"
    );
  });

  it("uses real browser fullscreen for the history QR preview", async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestFullscreenMock;
    const historyItem = {
      id: "history-fullscreen-1",
      origin: "generated" as const,
      type: "file" as const,
      title: "archive.gif",
      subtitle: "2026-03-29 - 22:29 - 256 B",
      date: "2026-03-29",
      mimeType: "image/gif",
      size: 256,
      source: "local" as const,
      fileData: new Uint8Array([71, 73, 70]),
    };

    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [historyItem],
      incompleteItems: [],
    });
    getHistoryItemByIdMock.mockResolvedValue(historyItem);

    render(<HistoryTab />);

    await waitFor(() => {
      expect(getHistoryProps()?.onView).toBeTypeOf("function");
    });

    await act(async () => {
      await getHistoryProps()?.onView?.(historyItem);
    });

    await screen.findByRole("dialog", { name: /archive\.gif/i });
    await fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it("copies only the note content after Ctrl+A then Ctrl+C in the note preview", async () => {
    const noteContent = "first line\nsecond line";
    const historyItem = {
      id: "history-note-1",
      origin: "generated" as const,
      type: "text" as const,
      title: "note.txt",
      subtitle: "2026-03-29 - 22:29 - 22 B",
      date: "2026-03-29",
      mimeType: "text/plain",
      size: noteContent.length,
      source: "local" as const,
      fileData: new TextEncoder().encode(noteContent),
    };
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [historyItem],
      incompleteItems: [],
    });
    getHistoryItemByIdMock.mockResolvedValue(historyItem);

    render(<HistoryTab />);

    await waitFor(() => {
      expect(getHistoryProps()?.onView).toBeTypeOf("function");
    });

    await act(async () => {
      await getHistoryProps()?.onView?.(historyItem);
    });

    await screen.findByTestId("history-note-content");
    const noteViewer = screen.getByTestId("history-note-viewer");
    const copyButton = screen.getByRole("button", { name: "Copy to Clipboard" });
    const downloadButton = screen.getByRole("button", { name: "Download" });

    expect(document.activeElement).toBe(noteViewer);
    expect(noteViewer.className).toContain(
      "pb-[calc(env(safe-area-inset-bottom,0px)+7rem)]"
    );
    expect(copyButton).toHaveTextContent("");
    expect(downloadButton).toHaveTextContent("");
    expect(copyButton).toHaveAttribute("title", "Copy to Clipboard");
    expect(downloadButton).toHaveAttribute("title", "Download");
    const footerDate = screen.getByTestId("history-note-footer-date");
    const footerSize = screen.getByTestId("history-note-footer-size");
    expect(footerDate).toHaveTextContent("2026-03-29 - 22:29");
    expect(footerDate).toHaveClass("min-w-0", "truncate");
    expect(footerSize).toHaveTextContent("22 B");
    expect(footerSize).toHaveClass("shrink-0");

    fireEvent.keyDown(noteViewer, { key: "a", code: "KeyA", ctrlKey: true });

    expect(window.getSelection()?.toString()).toBe(noteContent);

    fireEvent.keyDown(noteViewer, { key: "c", code: "KeyC", ctrlKey: true });

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(noteContent);
    });
    expect(writeTextMock).toHaveBeenCalledTimes(1);
  });

  it("merges a remote generated item into a local shadow item using remote history identifiers", async () => {
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          historyId: "generated-shadow-1",
          origin: "generated",
          title: "Shadow Generated",
          filename: "shadow-generated.zip",
          mimeType: "application/zip",
          size: 256,
          createdAt: "2026-03-29T21:29:45.752Z",
          updatedAt: "2026-03-29T21:29:45.752Z",
        },
      ],
      etag: "etag-shadow",
      totalCount: 1,
    });

    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [
        {
          id: "local-shadow-1",
          origin: "generated",
          type: "file",
          title: "Shadow Generated",
          subtitle: "2026-03-29 - 22:29 - 256 B",
          date: "2026-03-29",
          mimeType: "application/zip",
          remoteHistoryId: "generated-shadow-1",
          isSynced: false,
          isLocalOnly: false,
        },
      ],
    });

    render(<HistoryTab />);

    await waitFor(() => {
      const renderedItems = (historyPropsMock.mock.calls.at(-1)?.[0] as {
        items?: Array<{
          id: string;
          remoteHistoryId?: string;
          serverId?: string;
          isSynced?: boolean;
        }>;
      })?.items;
      expect(renderedItems).toEqual([
        expect.objectContaining({
          id: "local-shadow-1",
          remoteHistoryId: "generated-shadow-1",
          serverId: "generated-shadow-1",
          isSynced: true,
        }),
      ]);
    });
  });

  it("backfills persisted packet pages with their original packet indexes", async () => {
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          sessionId: "scan-1",
          filename: "archive.bin",
          completed: false,
          receivedPackets: 2,
          totalPackets: 70,
          updatedAt: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        },
      ],
      etag: "etag-2",
      totalCount: 1,
    });
    countScanSessionPacketsMock.mockResolvedValue(4);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([1]), new Uint8Array([2])],
      });
      await visitor({
        startIndex: 64,
        packets: [new Uint8Array([3]), new Uint8Array([4])],
      });
      return { pageCount: 2, packetCount: 4 };
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 70,
      total: 70,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        "scan-1",
        expect.any(Function)
      );
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(4);
    });

    expect(queueScanPacketMock.mock.calls.map(([, metadata]) => metadata.packetIndex)).toEqual([
      0,
      1,
      64,
      65,
    ]);
    expect(loadScanSessionPacketPagesMock).not.toHaveBeenCalled();
    expect(loadScanSessionPacketsMock).not.toHaveBeenCalled();
  });

  it("retries a failed backfill when the session state is revisited with the same counts", async () => {
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          sessionId: "scan-1",
          filename: "archive.bin",
          completed: false,
          receivedPackets: 2,
          totalPackets: 20,
          updatedAt: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        },
      ],
      etag: "etag-2",
      totalCount: 1,
    });
    countScanSessionPacketsMock.mockResolvedValue(1);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([1, 2, 3])],
      });
      return { pageCount: 1, packetCount: 1 };
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 6,
      total: 20,
    });
    queueScanPacketMock
      .mockImplementationOnce(() => {
        throw new Error("temporary failure");
      })
      .mockImplementation(() => undefined);

    render(<HistoryTab />);

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useHistoryStore.setState((state) => ({
        incompleteItems: state.incompleteItems.map((item) => ({ ...item })),
      }));
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(2);
    });
  });

  it("waits for the current backfill packet load before starting the next session", async () => {
    let releaseFirstBackfill: (() => void) | null = null;

    useHistoryStore.setState({
      items: [],
      incompleteItems: [
        {
          sessionId: "scan-1",
          filename: "archive-1.bin",
          received: 6,
          total: 20,
          date: "10:00",
          source: "local",
        },
        {
          sessionId: "scan-2",
          filename: "archive-2.bin",
          received: 8,
          total: 20,
          date: "10:05",
          source: "local",
        },
      ],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    });

    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          sessionId: "scan-1",
          filename: "archive-1.bin",
          completed: false,
          receivedPackets: 2,
          totalPackets: 20,
          updatedAt: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        },
        {
          sessionId: "scan-2",
          filename: "archive-2.bin",
          completed: false,
          receivedPackets: 1,
          totalPackets: 20,
          updatedAt: new Date("2026-03-29T10:05:00.000Z").toISOString(),
        },
      ],
      etag: "etag-2",
      totalCount: 2,
    });
    getIncompleteScanByIdMock.mockImplementation((sessionId: string) =>
      Promise.resolve({
        sessionId,
        filename: `${sessionId}.bin`,
        received: sessionId === "scan-1" ? 6 : 8,
        total: 20,
      })
    );
    countScanSessionPacketsMock.mockResolvedValue(1);
    visitScanSessionPacketPagesMock.mockImplementation(async (sessionId: string, visitor) => {
      if (sessionId === "scan-1") {
        await new Promise<void>((resolve) => {
          releaseFirstBackfill = resolve;
        });
        await visitor({
          startIndex: 0,
          packets: [new Uint8Array([1, 1, 1])],
        });
        return { pageCount: 1, packetCount: 1 };
      }

      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([2, 2, 2])],
      });
      return { pageCount: 1, packetCount: 1 };
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledTimes(1);
    });
    expect(visitScanSessionPacketPagesMock).toHaveBeenNthCalledWith(
      1,
      "scan-1",
      expect.any(Function)
    );
    expect(loadScanSessionPacketPagesMock).not.toHaveBeenCalled();

    act(() => {
      releaseFirstBackfill?.();
    });

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenNthCalledWith(
        2,
        "scan-2",
        expect.any(Function)
      );
    });
    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps auto-backfill enabled when syncScanned is omitted from persisted settings", async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: "https://sync.example.com",
        apiKey: "",
        username: "",
        password: "",
        syncScanned: undefined,
        syncGenerated: true,
        autoSyncHistory: true,
      },
    });
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          sessionId: "scan-1",
          filename: "archive.bin",
          completed: false,
          receivedPackets: 2,
          totalPackets: 20,
          updatedAt: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        },
      ],
      etag: "etag-2",
      totalCount: 1,
    });
    countScanSessionPacketsMock.mockResolvedValue(1);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([1, 2, 3])],
      });
      return { pageCount: 1, packetCount: 1 };
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 6,
      total: 20,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        "scan-1",
        expect.any(Function)
      );
    });
    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(1);
    });
    expect(loadScanSessionPacketPagesMock).not.toHaveBeenCalled();
  });

  it("passes an unavailable sync status label to History when both auth probing and history sync fail", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetchServerHistoryMock.mockRejectedValueOnce(new TypeError("history unavailable"));

    render(<HistoryTab />);

    await waitFor(() => {
      expect(getHistoryProps()?.syncStatusLabel).toBe("Unavailable");
    });
  });

  it("still loads remote incomplete scan progress from a cookie-backed server session when the auth probe fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          id: "scan-1",
          sessionId: "scan-1",
          origin: "scanned",
          filename: "archive.bin",
          completed: false,
          receivedPackets: 520,
          expectedPackets: 1182,
          totalPackets: 1182,
          updatedAt: "2026-04-03T18:28:00.000Z",
        },
      ],
      etag: "etag-cookie-session",
      totalCount: 1,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const historyProps = getHistoryProps() as {
        incompleteItems?: Array<{ sessionId: string; received: number; total: number }>;
        syncStatusLabel?: string;
      };
      expect(historyProps.incompleteItems).toEqual([
        expect.objectContaining({
          sessionId: "scan-1",
          received: 520,
          total: 1182,
        }),
      ]);
      expect(historyProps.syncStatusLabel).toBe("Connected");
    });
  });

  it("still loads remote incomplete scan progress when credentials are present and the auth probe fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: "https://sync.example.com",
        username: "admin",
        password: "admin",
      },
    });
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          id: "scan-1",
          sessionId: "scan-1",
          origin: "scanned",
          filename: "archive.bin",
          completed: false,
          receivedPackets: 520,
          expectedPackets: 1182,
          totalPackets: 1182,
          updatedAt: "2026-04-03T18:28:00.000Z",
        },
      ],
      etag: "etag-cred-fallback",
      totalCount: 1,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const historyProps = getHistoryProps() as {
        incompleteItems?: Array<{ sessionId: string; received: number; total: number }>;
        syncStatusLabel?: string;
      };
      expect(historyProps.incompleteItems).toEqual([
        expect.objectContaining({
          sessionId: "scan-1",
          received: 520,
          total: 1182,
        }),
      ]);
      expect(historyProps.syncStatusLabel).toBe("Connected");
    });
  });

  it("uses the server decode threshold instead of transmitted packet total for remote incomplete scans", async () => {
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      incompleteItems: [],
    });
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          id: "1782324971",
          sessionId: "1782324971",
          origin: "scanned",
          filename: "scan.zip",
          completed: false,
          receivedPackets: 3635,
          expectedPackets: 12753,
          totalPackets: 1374,
          completionPercent: 29,
          updatedAt: "2026-06-24T18:24:00.000Z",
        },
      ],
      etag: "etag-scan-threshold",
      totalCount: 1,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const historyProps = getHistoryProps() as {
        incompleteItems?: Array<{
          sessionId: string;
          received: number;
          total: number;
          totalIsEstimate?: boolean;
          progressPercent?: number;
        }>;
      };
      expect(historyProps.incompleteItems).toEqual([
        expect.objectContaining({
          sessionId: "1782324971",
          received: 3635,
          total: 12753,
          totalIsEstimate: false,
          progressPercent: 29,
        }),
      ]);
    });
  });

  it("removes a server-backed generated item immediately when a realtime delete event arrives", async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: "https://sync.example.test",
      },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, authorized: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [
        {
          id: "generated-1",
          origin: "generated",
          source: "local",
          type: "file",
          title: "output.gif",
          subtitle: "local generated",
          date: new Date("2026-03-29T10:00:00.000Z").toISOString(),
          mimeType: "image/gif",
          isSynced: true,
          serverId: "generated-1",
        },
      ],
      incompleteItems: [],
    });
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          id: "generated-1",
          historyId: "generated-1",
          origin: "generated",
          title: "output.gif",
          filename: "output.gif",
          mimeType: "image/gif",
          size: 10,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
      etag: "etag-live-delete",
      totalCount: 1,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;
    expect(eventHandler).toBeTypeOf("function");

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: {
          origin: "generated",
          historyId: "generated-1",
        },
      });
    });

    await waitFor(() => {
      expect(useHistoryStore.getState().items).toEqual([]);
    });
    await waitFor(() => {
      expect(deleteHistoryItemMock).toHaveBeenCalledWith("generated-1");
    });
  });

  it("removes a server-backed scanned item and incomplete session immediately when a realtime delete event arrives", async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: "https://sync.example.test",
      },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, authorized: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [
        {
          id: "scan-remote-1",
          origin: "scanned",
          source: "local",
          type: "file",
          title: "capture.bin",
          subtitle: "remote scanned",
          date: new Date("2026-03-29T10:00:00.000Z").toISOString(),
          mimeType: "application/octet-stream",
          isSynced: true,
          serverId: "scan-remote-1",
        },
      ],
      incompleteItems: [
        {
          sessionId: "scan-remote-1",
          remoteSessionId: "scan-remote-1",
          filename: "capture.bin",
          received: 4,
          total: 10,
          date: "10:00",
          source: "server",
        },
      ],
    });
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          id: "scan-remote-1",
          sessionId: "scan-remote-1",
          origin: "scanned",
          filename: "capture.bin",
          mimeType: "application/octet-stream",
          size: 10,
          completed: true,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
      etag: "etag-scan-delete",
      totalCount: 1,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;
    expect(eventHandler).toBeTypeOf("function");

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: {
          origin: "scanned",
          sessionId: "scan-remote-1",
        },
      });
    });

    await waitFor(() => {
      expect(useHistoryStore.getState().items).toEqual([]);
      expect(useHistoryStore.getState().incompleteItems).toEqual([]);
    });
    await waitFor(() => {
      expect(deleteHistoryItemMock).toHaveBeenCalledWith("scan-remote-1");
      expect(deleteIncompleteScanMock).toHaveBeenCalledWith("scan-remote-1");
      expect(deleteScanSessionChunksMock).toHaveBeenCalledWith("scan-remote-1");
      expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith("scan-remote-1");
    });
  });

  it("does not resurrect a generated item when stale IndexedDB hydration resolves after its realtime deletion", async () => {
    const hydration = deferred<Array<Record<string, unknown>>>();
    loadHistoryFromIndexedDBMock.mockReturnValue(hydration.promise);
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [],
      incompleteItems: [],
    });

    render(<HistoryTab />);

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: { origin: "generated", historyId: "remote-generated-1" },
      });
    });

    await waitFor(() => {
      expect(deleteHistoryItemMock).toHaveBeenCalledWith("remote-generated-1");
    });

    await act(async () => {
      hydration.resolve([
        {
          id: "local-generated-shadow",
          serverId: "remote-generated-1",
          remoteHistoryId: "remote-generated-1",
          origin: "generated",
          source: "local",
          type: "file",
          title: "stale.gif",
          subtitle: "stale IndexedDB row",
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
      await hydration.promise;
    });

    await waitFor(() => {
      expect(useHistoryStore.getState().items.map((item) => item.id)).toEqual([
        "unrelated-local",
      ]);
    });
  });

  it("does not resurrect generated history when a stale server refresh resolves after realtime deletion", async () => {
    const refresh = deferred<{
      entries: Array<Record<string, unknown>>;
      etag: string;
      totalCount: number;
    }>();
    fetchServerHistoryMock.mockReturnValue(refresh.promise);
    loadHistoryFromIndexedDBMock.mockResolvedValue([
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
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [
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
      ],
      incompleteItems: [],
    });

    render(<HistoryTab />);

    await waitFor(() => expect(fetchServerHistoryMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: { origin: "generated", historyId: "remote-generated-1" },
      });
    });

    await act(async () => {
      refresh.resolve({
        entries: [
          {
            id: "remote-generated-1",
            historyId: "remote-generated-1",
            origin: "generated",
            filename: "stale.gif",
            size: 10,
            createdAt: "2026-03-29T10:00:00.000Z",
            updatedAt: "2026-03-29T10:00:00.000Z",
          },
        ],
        etag: "stale-etag",
        totalCount: 1,
      });
      await refresh.promise;
    });

    await waitFor(() => {
      expect(useHistoryStore.getState().items.map((item) => item.id)).toEqual([
        "unrelated-local",
      ]);
      expect(
        ((getHistoryProps() as { items?: Array<{ id: string }> })?.items ?? []).map(
          (item) => item.id
        )
      ).toEqual(["unrelated-local"]);
    });
  });

  it("does not resurrect completed or incomplete scans when a stale server refresh resolves after realtime deletion", async () => {
    const refresh = deferred<{
      entries: Array<Record<string, unknown>>;
      etag: string;
      totalCount: number;
    }>();
    fetchServerHistoryMock.mockReturnValue(refresh.promise);
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [],
      incompleteItems: [],
    });

    render(<HistoryTab />);

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: { origin: "scanned", sessionId: "remote-scan-1" },
      });
      eventHandler?.({
        type: "delete",
        payload: { origin: "scanned", sessionId: "remote-scan-complete" },
      });
    });

    await waitFor(() => {
      expect(deleteIncompleteScanMock).toHaveBeenCalledWith("remote-scan-1");
      expect(deleteScanSessionChunksMock).toHaveBeenCalledWith("remote-scan-1");
      expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith("remote-scan-1");
    });

    await act(async () => {
      refresh.resolve({
        entries: [
          {
            id: "remote-scan-1",
            sessionId: "remote-scan-1",
            origin: "scanned",
            filename: "stale.bin",
            completed: false,
            receivedPackets: 4,
            totalPackets: 10,
            createdAt: "2026-03-29T10:00:00.000Z",
            updatedAt: "2026-03-29T10:00:00.000Z",
          },
          {
            id: "remote-scan-complete",
            sessionId: "remote-scan-complete",
            origin: "scanned",
            filename: "completed.bin",
            completed: true,
            size: 20,
            createdAt: "2026-03-29T10:00:00.000Z",
            updatedAt: "2026-03-29T10:00:00.000Z",
          },
        ],
        etag: "stale-scan-etag",
        totalCount: 1,
      });
      await refresh.promise;
    });

    await waitFor(() => {
      const props = getHistoryProps() as {
        items?: Array<{ id: string }>;
        incompleteItems?: Array<{ sessionId: string }>;
      };
      expect(props.items ?? []).toEqual([]);
      expect(props.incompleteItems ?? []).toEqual([]);
    });
  });

  it("keeps a realtime deletion tombstoned across HistoryTab unmount and remount", async () => {
    fetchServerHistoryMock.mockResolvedValue({
      entries: [],
      etag: "before-delete",
      totalCount: 0,
    });
    const firstMount = render(<HistoryTab />);
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: { origin: "generated", historyId: "remote-generated-1" },
      });
    });
    await waitFor(() => expect(fetchServerHistoryMock).toHaveBeenCalledTimes(2));
    firstMount.unmount();

    subscribeMock.mockClear();
    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          id: "remote-generated-1",
          historyId: "remote-generated-1",
          origin: "generated",
          filename: "stale.gif",
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
      etag: "stale-after-remount",
      totalCount: 1,
    });

    render(<HistoryTab />);

    await waitFor(() => expect(fetchServerHistoryMock).toHaveBeenCalledTimes(3));
    await waitFor(() => {
      const props = getHistoryProps() as { items?: Array<{ id: string }> };
      expect(props.items ?? []).toEqual([]);
    });
  });

  it("does not apply server A tombstones or late refreshes after switching to server B", async () => {
    const serverARefresh = deferred<{
      entries: Array<Record<string, unknown>>;
      etag: string;
      totalCount: number;
    }>();
    const serverAAliasInspection = deferred<Array<Record<string, unknown>>>();
    loadHistoryFromIndexedDBMock
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(serverAAliasInspection.promise);
    fetchServerHistoryMock.mockImplementation((config: { url: string }) => {
      if (config.url === "https://server-a.example") {
        return serverARefresh.promise;
      }
      return Promise.resolve({
        entries: [
          {
            id: "shared-id",
            historyId: "shared-id",
            origin: "generated",
            filename: "server-b.gif",
            createdAt: "2026-03-29T10:00:00.000Z",
            updatedAt: "2026-03-29T10:00:00.000Z",
          },
        ],
        etag: "server-b-etag",
        totalCount: 1,
      });
    });
    useSettingsStore.setState((state) => ({
      uploadConfig: {
        ...state.uploadConfig,
        enabled: true,
        url: "https://server-a.example",
      },
    }));

    render(<HistoryTab />);
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const serverAEventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;
    act(() => {
      serverAEventHandler?.({
        type: "delete",
        payload: { origin: "generated", historyId: "shared-id" },
      });
      useSettingsStore.setState((state) => ({
        uploadConfig: {
          ...state.uploadConfig,
          url: "https://server-b.example",
        },
      }));
    });

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://server-b.example" }),
        expect.any(Object)
      );
    });
    await waitFor(() => {
      const props = getHistoryProps() as { items?: Array<{ id: string }> };
      expect(props.items?.map((item) => item.id)).toEqual(["shared-id"]);
    });

    await act(async () => {
      serverAAliasInspection.resolve([
        {
          id: "server-b-local-shadow",
          remoteHistoryId: "shared-id",
          origin: "generated",
          source: "local",
          type: "file",
          title: "server-b.gif",
          subtitle: "server B local shadow",
          date: "2026-03-29",
          isSynced: true,
        },
      ]);
      await serverAAliasInspection.promise;
    });
    expect(deleteHistoryItemMock).not.toHaveBeenCalledWith(
      "server-b-local-shadow"
    );

    await act(async () => {
      serverARefresh.resolve({
        entries: [
          {
            id: "late-a-item",
            historyId: "late-a-item",
            origin: "generated",
            filename: "late-a.gif",
            createdAt: "2026-03-29T10:00:00.000Z",
            updatedAt: "2026-03-29T10:00:00.000Z",
          },
        ],
        etag: "late-a-etag",
        totalCount: 1,
      });
      await serverARefresh.promise;
    });

    await waitFor(() => {
      const props = getHistoryProps() as { items?: Array<{ id: string }> };
      expect(props.items?.map((item) => item.id)).toEqual(["shared-id"]);
    });
  });

  it("keeps server A deletion authority after switching to B and returning offline", async () => {
    const acknowledgePurgeSpy = vi.spyOn(
      historyTombstones,
      "acknowledgeRemoteHistoryDurablePurge"
    );
    const serverAAliasInspection = deferred<Array<Record<string, unknown>>>();
    let serverARequestCount = 0;
    loadHistoryFromIndexedDBMock
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(serverAAliasInspection.promise);
    fetchServerHistoryMock.mockImplementation((config: { url: string }) => {
      if (config.url === "https://server-a.example") {
        serverARequestCount += 1;
        if (serverARequestCount >= 3) {
          return Promise.reject(new TypeError("server A offline"));
        }
      }
      return Promise.resolve({ entries: [], totalCount: 0 });
    });
    useSettingsStore.setState((state) => ({
      uploadConfig: {
        ...state.uploadConfig,
        enabled: true,
        url: "https://server-a.example",
      },
    }));

    render(<HistoryTab />);
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const serverAEventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;
    act(() => {
      serverAEventHandler?.({
        type: "delete",
        payload: { origin: "generated", historyId: "deleted-on-a" },
      });
      useSettingsStore.setState((state) => ({
        uploadConfig: {
          ...state.uploadConfig,
          url: "https://server-b.example",
        },
      }));
    });
    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://server-b.example" }),
        expect.any(Object)
      );
    });

    await act(async () => {
      serverAAliasInspection.reject(new Error("IndexedDB purge unavailable"));
      await serverAAliasInspection.promise.catch(() => undefined);
    });
    expect(acknowledgePurgeSpy).not.toHaveBeenCalled();

    act(() => {
      useSettingsStore.setState((state) => ({
        uploadConfig: {
          ...state.uploadConfig,
          url: "https://server-a.example",
        },
      }));
      useHistoryStore.setState({
        ...useHistoryStore.getState(),
        items: [
          {
            id: "stale-local-alias",
            remoteHistoryId: "deleted-on-a",
            origin: "generated",
            source: "local",
            type: "file",
            title: "stale.gif",
            subtitle: "stale durable alias",
            date: "2026-03-29",
            isSynced: true,
          },
        ],
      });
    });

    await waitFor(() => {
      const props = getHistoryProps() as { items?: Array<{ id: string }> };
      expect(props.items ?? []).toEqual([]);
    });
  });

  it("purges a generated IndexedDB alias even when it is absent from Zustand", async () => {
    const acknowledgePurgeSpy = vi.spyOn(
      historyTombstones,
      "acknowledgeRemoteHistoryDurablePurge"
    );
    loadHistoryFromIndexedDBMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
      ]);
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [],
      incompleteItems: [],
    });
    render(<HistoryTab />);
    await waitFor(() => expect(loadHistoryFromIndexedDBMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: { origin: "generated", historyId: "remote-generated-1" },
      });
    });

    await waitFor(() => {
      expect(deleteHistoryItemMock).toHaveBeenCalledWith("remote-generated-1");
      expect(deleteHistoryItemMock).toHaveBeenCalledWith("local-generated-shadow");
      expect(acknowledgePurgeSpy).toHaveBeenCalledWith(
        "https://sync.example.com",
        "generated",
        "remote-generated-1",
        expect.any(Number)
      );
    });
  });

  it("purges incomplete IndexedDB aliases and buffers even when they are absent from Zustand", async () => {
    loadIncompleteScansMock.mockResolvedValue([
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
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      items: [],
      incompleteItems: [],
    });
    render(<HistoryTab />);
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledTimes(1));
    const eventHandler = subscribeMock.mock.calls[0]?.[0] as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | undefined;

    act(() => {
      eventHandler?.({
        type: "delete",
        payload: { origin: "scanned", sessionId: "remote-scan-1" },
      });
    });

    await waitFor(() => {
      expect(deleteIncompleteScanMock).toHaveBeenCalledWith("local-scan-shadow");
      expect(deleteScanSessionChunksMock).toHaveBeenCalledWith("local-scan-shadow");
      expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith("local-scan-shadow");
    });
  });

  it("blocks manual history sync actions until server auth is ready", async () => {
    let resolveAuthProbe:
      | ((response: Response) => void)
      | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveAuthProbe = resolve;
        })
    );
    loadHistoryFromIndexedDBMock.mockResolvedValue([
      {
        id: "generated-1",
        origin: "generated",
        source: "local",
        type: "file",
        title: "output.gif",
        subtitle: "local file",
        date: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        mimeType: "image/gif",
        fileData: new Uint8Array([1, 2, 3]),
      },
    ]);
    getHistoryItemByIdMock.mockResolvedValue({
      id: "generated-1",
      origin: "generated",
      source: "local",
      type: "file",
      title: "output.gif",
      subtitle: "local file",
      date: new Date("2026-03-29T10:00:00.000Z").toISOString(),
      mimeType: "image/gif",
      fileData: new Uint8Array([1, 2, 3]),
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 2,
      total: 20,
      packets: [new Uint8Array([1, 2, 3])],
    });
    loadScanSessionPacketPagesMock.mockResolvedValue([
      {
        startIndex: 0,
        packets: [new Uint8Array([1, 2, 3])],
      },
    ]);
    useHistoryStore.setState({ incompleteItems: [] });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(getHistoryProps()).toBeDefined();
    });

    await act(async () => {
      await getHistoryProps()?.onSyncToServer?.();
      await getHistoryProps()?.onSyncItem?.({
        id: "generated-1",
        origin: "generated",
        title: "output.gif",
        subtitle: "local file",
        date: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        type: "file",
        mimeType: "image/gif",
      });
      await getHistoryProps()?.onSyncIncomplete?.({
        sessionId: "scan-1",
        filename: "archive.bin",
        received: 2,
        total: 20,
        date: "10:00",
        source: "local",
      });
    });

    expect(queueHistoryItemMock).not.toHaveBeenCalled();
    expect(queueScanCompleteMock).not.toHaveBeenCalled();
    expect(queueScanPacketMock).not.toHaveBeenCalled();
    expect(useToastStore.getState()).toEqual(
      expect.objectContaining({
        visible: true,
        type: "warning",
        message: "Server sync is unavailable right now.",
      })
    );

    await act(async () => {
      resolveAuthProbe?.(
        new Response(JSON.stringify({ enabled: true, authorized: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    await waitFor(() => {
      expect(getHistoryProps()?.syncStatusLabel).toBe("Connected");
    });

    await act(async () => {
      await getHistoryProps()?.onSyncItem?.({
        id: "generated-1",
        origin: "generated",
        title: "output.gif",
        subtitle: "local file",
        date: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        type: "file",
        mimeType: "image/gif",
      });
    });

    expect(queueHistoryItemMock).toHaveBeenCalledTimes(1);
  });

  it("queues eligible local history items during manual sync and skips the rest", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, authorized: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    loadHistoryFromIndexedDBMock.mockResolvedValue([
      {
        id: "generated-1",
        origin: "generated",
        source: "local",
        type: "file",
        title: "output.gif",
        subtitle: "local generated",
        date: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        mimeType: "image/gif",
        fileData: new Uint8Array([1, 2, 3]),
      },
      {
        id: "scanned-1",
        origin: "scanned",
        source: "local",
        type: "file",
        title: "archive.bin",
        subtitle: "local scanned",
        date: new Date("2026-03-29T10:05:00.000Z").toISOString(),
        mimeType: "application/octet-stream",
        fileData: new Uint8Array([4, 5, 6]),
      },
      {
        id: "server-1",
        origin: "generated",
        source: "server",
        type: "file",
        title: "remote.gif",
        subtitle: "remote",
        date: new Date("2026-03-29T10:10:00.000Z").toISOString(),
        mimeType: "image/gif",
        fileData: new Uint8Array([7, 8, 9]),
      },
      {
        id: "local-only-1",
        origin: "generated",
        source: "local",
        type: "file",
        title: "detached.gif",
        subtitle: "local only",
        date: new Date("2026-03-29T10:15:00.000Z").toISOString(),
        mimeType: "image/gif",
        fileData: new Uint8Array([10, 11, 12]),
        isLocalOnly: true,
      },
      {
        id: "synced-1",
        origin: "generated",
        source: "local",
        type: "file",
        title: "synced.gif",
        subtitle: "synced",
        date: new Date("2026-03-29T10:20:00.000Z").toISOString(),
        mimeType: "image/gif",
        fileData: new Uint8Array([13, 14, 15]),
        isSynced: true,
      },
      {
        id: "nofile-1",
        origin: "generated",
        source: "local",
        type: "file",
        title: "nofile.gif",
        subtitle: "missing file",
        date: new Date("2026-03-29T10:25:00.000Z").toISOString(),
        mimeType: "image/gif",
      },
    ]);

    render(<HistoryTab />);

    await waitFor(() => {
      expect(getHistoryProps()).toBeDefined();
    });
    await waitFor(() => {
      expect(getHistoryProps()?.syncStatusLabel).toBe("Connected");
    });

    await act(async () => {
      await getHistoryProps()?.onSyncToServer?.();
    });

    await waitFor(() => {
      expect(queueHistoryItemMock).toHaveBeenCalledTimes(1);
    });
    expect(queueHistoryItemMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        historyId: "generated-1",
        title: "output.gif",
      })
    );
    await waitFor(() => {
      expect(queueScanCompleteMock).toHaveBeenCalledTimes(1);
    });
    expect(queueScanCompleteMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        sessionId: "scanned-1",
        filename: "archive.bin",
      })
    );
  });

  it("clears local and remote history after confirmation", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    useHistoryStore.setState({
      items: [
        {
          id: "local-generated-1",
          origin: "generated",
          source: "local",
          type: "file",
          title: "local.gif",
          subtitle: "local file",
          date: "2026-03-29",
          mimeType: "image/gif",
        },
      ],
      incompleteItems: [
        {
          sessionId: "local-scan-1",
          filename: "archive.bin",
          received: 2,
          total: 20,
          date: "10:00",
          source: "local",
        },
      ],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    });

    fetchServerHistoryMock.mockResolvedValue({
      entries: [
        {
          origin: "generated",
          historyId: "remote-generated-1",
          title: "remote.gif",
          filename: "remote.gif",
          mimeType: "image/gif",
          size: 123,
          updatedAt: new Date("2026-03-29T10:00:00.000Z").toISOString(),
        },
        {
          origin: "scanned",
          sessionId: "remote-scan-1",
          filename: "remote.bin",
          completed: false,
          receivedPackets: 2,
          totalPackets: 20,
          updatedAt: new Date("2026-03-29T10:05:00.000Z").toISOString(),
        },
      ],
      etag: "etag-clear",
      totalCount: 2,
    });
    deleteServerHistoryItemMock.mockResolvedValue(undefined);
    deleteServerSessionMock.mockResolvedValue(undefined);

    render(<HistoryTab />);

    await waitFor(() => {
      expect(fetchServerHistoryMock).toHaveBeenCalled();
    });

    await act(async () => {
      await getHistoryProps()?.onClearHistory?.();
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(deleteServerHistoryItemMock).toHaveBeenCalledWith(
      expect.any(Object),
      "remote-generated-1"
    );
    expect(deleteServerSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      "remote-scan-1"
    );
    expect(useHistoryStore.getState().items).toEqual([]);
    expect(useHistoryStore.getState().incompleteItems).toEqual([]);

    confirmMock.mockRestore();
  });

  it("resumes a local packet-backed session without rewriting persisted packet pages", async () => {
    countScanSessionPacketsMock.mockResolvedValue(1);
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 6,
      total: 20,
    });
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        syncScanned: false,
      },
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(historyPropsMock).toHaveBeenCalled();
    });
    loadScanSessionPacketPagesMock.mockClear();
    countScanSessionPacketsMock.mockClear();

    await act(async () => {
      getHistoryProps()?.onResume?.({
        sessionId: "scan-1",
        filename: "archive.bin",
        received: 6,
        total: 20,
        date: "10:00",
        source: "local",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(countScanSessionPacketsMock).toHaveBeenCalledWith("scan-1");
    expect(loadScanSessionPacketPagesMock).not.toHaveBeenCalled();
    expect(loadScanSessionPacketsMock).not.toHaveBeenCalled();
    expect(replaceScanSessionPacketsMock).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().resumeSessionId).toBe("scan-1");
    expect(useHistoryStore.getState().resumePackets).toBeNull();
    expect(useHistoryStore.getState().resumeAuthority).toBe("local-cache");
    expect(saveIncompleteScanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "scan-1",
        filename: "archive.bin",
        received: 6,
        total: 20,
        date: "10:00",
      })
    );
  });

  it("resumes a server-backed session without hydrating packet pages first", async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal("WebSocket", class MockWebSocket {});
    useHistoryStore.setState({
      ...useHistoryStore.getState(),
      incompleteItems: [],
    });

    try {
      render(<HistoryTab />);

      await waitFor(() => {
        expect(historyPropsMock).toHaveBeenCalled();
      });
      countScanSessionPacketsMock.mockClear();

      await act(async () => {
        getHistoryProps()?.onResume?.({
          sessionId: "scan-1",
          filename: "archive.bin",
          received: 2,
          total: 20,
          date: "10:00",
          source: "server",
          remoteSessionId: "remote-scan-1",
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(useHistoryStore.getState().resumeSessionId).toBe("remote-scan-1");
      });

      expect(deleteScanSessionPacketsMock).not.toHaveBeenCalled();
      expect(fetchServerPacketsMock).not.toHaveBeenCalled();
      expect(appendScanSessionPacketsMock).not.toHaveBeenCalled();
      expect(replaceScanSessionPacketsMock).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().resumeSessionId).toBe("remote-scan-1");
      expect(useHistoryStore.getState().resumePackets).toBeNull();
      expect(useHistoryStore.getState().resumeAuthority).toBe("server");
      expect(saveIncompleteScanMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "scan-1",
          source: "server",
          remoteSessionId: "remote-scan-1",
        })
      );
    } finally {
      if (originalWebSocket) {
        vi.stubGlobal("WebSocket", originalWebSocket);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
      }
    }
  });

  it("keeps remote resume disabled when packet persistence fails", async () => {
    const originalWebSocket = globalThis.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    countScanSessionPacketsMock.mockResolvedValue(0);
    appendScanSessionPacketsMock.mockRejectedValueOnce(new Error("idb unavailable"));
    fetchServerPacketsMock
      .mockResolvedValueOnce({
        sessionId: "remote-scan-1",
        packets: [new Uint8Array([1, 2, 3])],
        offset: 0,
        packetCount: 1,
        totalCount: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        sessionId: "remote-scan-1",
        packets: [new Uint8Array([4, 5, 6])],
        offset: 1,
        packetCount: 1,
        totalCount: 2,
        hasMore: false,
      });

    try {
      render(<HistoryTab />);

      await waitFor(() => {
        expect(historyPropsMock).toHaveBeenCalled();
      });
      countScanSessionPacketsMock.mockClear();

      await act(async () => {
        getHistoryProps()?.onResume?.({
          sessionId: "scan-1",
          filename: "archive.bin",
          received: 2,
          total: 20,
          date: "10:00",
          source: "server",
          remoteSessionId: "remote-scan-1",
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(fetchServerPacketsMock).toHaveBeenCalledTimes(1);
      });

      expect(fetchServerPacketsMock).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        "remote-scan-1",
        { offset: 0, limit: 1024 }
      );
      expect(useHistoryStore.getState().resumeSessionId).toBeNull();
      expect(useHistoryStore.getState().resumePackets).toBeNull();
      expect(useToastStore.getState().visible).toBe(true);
      expect(useToastStore.getState().type).toBe("error");
    } finally {
      if (originalWebSocket) {
        vi.stubGlobal("WebSocket", originalWebSocket);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
      }
    }
  });

  it("keeps a server incomplete scan local without refetching when packet pages already exist", async () => {
    countScanSessionPacketsMock.mockResolvedValue(2);
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 2,
      total: 20,
      date: "10:00",
      source: "server",
      remoteSessionId: "remote-scan-1",
    });
    fetchServerSessionMock.mockResolvedValue({
      sessionId: "remote-scan-1",
      completed: false,
      status: "in_progress",
    });
    deleteServerSessionMock.mockResolvedValue(undefined);
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        syncScanned: false,
      },
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(historyPropsMock).toHaveBeenCalled();
    });
    loadScanSessionPacketPagesMock.mockClear();
    countScanSessionPacketsMock.mockClear();

    await act(async () => {
      await getHistoryProps()?.onKeepLocalIncomplete?.({
        sessionId: "scan-1",
        filename: "archive.bin",
        received: 2,
        total: 20,
        date: "10:00",
        source: "server",
        remoteSessionId: "remote-scan-1",
      });
    });

    expect(countScanSessionPacketsMock).toHaveBeenCalledWith("scan-1");
    expect(loadScanSessionPacketPagesMock).not.toHaveBeenCalled();
    expect(fetchServerPacketsMock).not.toHaveBeenCalled();
    expect(replaceScanSessionPacketsMock).not.toHaveBeenCalled();
    expect(deleteServerSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      "remote-scan-1"
    );
    expect(saveIncompleteScanMock).toHaveBeenCalledWith({
      sessionId: "scan-1",
      filename: "archive.bin",
      received: 2,
      total: 20,
      date: "10:00",
      source: "local",
    });
  });

  it("deletes the remote session when removing a local incomplete scan already linked to the server", async () => {
    fetchServerSessionMock.mockResolvedValue({
      sessionId: "remote-scan-1",
      completed: false,
      status: "in_progress",
    });
    deleteServerSessionMock.mockResolvedValue(undefined);
    useHistoryStore.setState({
      items: [],
      incompleteItems: [
        {
          sessionId: "scan-1",
          filename: "archive.bin",
          received: 6,
          total: 20,
          date: "10:00",
          source: "local",
          remoteSessionId: "remote-scan-1",
        },
      ],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    });

    render(<HistoryTab />);

    await waitFor(() => {
      expect(historyPropsMock).toHaveBeenCalled();
    });

    await act(async () => {
      await getHistoryProps()?.onDeleteIncomplete?.({
        sessionId: "scan-1",
        filename: "archive.bin",
        received: 6,
        total: 20,
        date: "10:00",
        source: "local",
        remoteSessionId: "remote-scan-1",
      });
    });

    expect(fetchServerSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      "remote-scan-1"
    );
    expect(deleteServerSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      "remote-scan-1"
    );
    expect(deleteIncompleteScanMock).toHaveBeenCalledWith("scan-1");
    expect(deleteScanSessionChunksMock).toHaveBeenCalledWith("scan-1");
    expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith("scan-1");
    expect(useHistoryStore.getState().incompleteItems).toEqual([]);
  });
});
