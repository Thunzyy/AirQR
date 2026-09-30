import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ScannerTab from "@web/components/tabs/ScannerTab";
import { useHistoryStore, useSettingsStore } from "@web/store";

const {
  appendScanSessionPacketsMock,
  loadScanSessionPacketsMock,
  latestScannerPropsRef,
  saveIncompleteScanMock,
  saveHistoryItemWithAutoSyncMock,
} =
  vi.hoisted(() => ({
    appendScanSessionPacketsMock: vi.fn(),
    loadScanSessionPacketsMock: vi.fn(),
    latestScannerPropsRef: { current: null as Record<string, unknown> | null },
    saveIncompleteScanMock: vi.fn(),
    saveHistoryItemWithAutoSyncMock: vi.fn(),
  }));

vi.mock("@web/features/scanner/Scanner", () => ({
  default: (props: Record<string, unknown>) => {
    latestScannerPropsRef.current = props;
    return <div data-testid="scanner-stub" />;
  },
}));

vi.mock("@web/services/scanSessionDB", () => ({
  appendScanSessionPackets: appendScanSessionPacketsMock,
  deleteScanSessionChunks: vi.fn(),
  deleteScanSessionPackets: vi.fn(),
  loadScanSessionPackets: loadScanSessionPacketsMock,
}));

vi.mock("@web/services/historyDB", () => ({
  saveHistoryItemWithAutoSync: saveHistoryItemWithAutoSyncMock,
  saveIncompleteScan: saveIncompleteScanMock,
}));

describe("ScannerTab", () => {
  beforeEach(() => {
    latestScannerPropsRef.current = null;
    appendScanSessionPacketsMock.mockReset();
    loadScanSessionPacketsMock.mockReset();
    saveHistoryItemWithAutoSyncMock.mockReset();
    saveIncompleteScanMock.mockReset();
    saveIncompleteScanMock.mockResolvedValue(undefined);
    loadScanSessionPacketsMock.mockResolvedValue([]);

    useHistoryStore.setState({
      items: [],
      incompleteItems: [],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    });

    useSettingsStore.setState({
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: "https://sync.example.com",
      },
    });
  });

  it("passes the stored resume authority to Scanner", () => {
    useHistoryStore.setState({
      items: [],
      incompleteItems: [],
      resumeSessionId: "remote-scan-1",
      resumePackets: null,
      resumeStats: {
        received: 8000,
        total: 12000,
        filename: "large.bin",
      },
      resumeAuthority: "server",
    });

    render(<ScannerTab />);

    expect(latestScannerPropsRef.current).toMatchObject({
      resumeMode: true,
      resumeSessionId: "remote-scan-1",
      resumeAuthority: "server",
    });
  });

  it("preserves server resume authority when server progress updates resume stats", () => {
    useHistoryStore.setState({
      items: [],
      incompleteItems: [
        {
          sessionId: "remote-scan-1",
          filename: "large.bin",
          received: 8000,
          total: 12000,
          totalIsEstimate: true,
          date: "10:00",
          source: "server",
          remoteSessionId: "remote-scan-1",
        },
      ],
      resumeSessionId: "remote-scan-1",
      resumePackets: null,
      resumeStats: {
        received: 8000,
        total: 12000,
        filename: "large.bin",
      },
      resumeAuthority: "server",
    });

    render(<ScannerTab />);

    act(() => {
      (
        latestScannerPropsRef.current?.onScanProgress as
          | ((stats: unknown) => void)
          | undefined
      )?.({
        sessionId: "remote-scan-1",
        filename: "large.bin",
        received: 8100,
        total: 12000,
        source: "server",
      });
    });

    expect(useHistoryStore.getState().resumeAuthority).toBe("server");
    expect(useHistoryStore.getState().resumeStats).toMatchObject({
      received: 8100,
      total: 12000,
      filename: "large.bin",
    });
  });

  it("defaults omitted resume scan authority options to local cache", () => {
    useHistoryStore.getState().setResumeScan(
      "local-scan-1",
      null,
      {
        received: 4,
        total: 10,
        filename: "local.bin",
      }
    );

    expect(useHistoryStore.getState().resumeAuthority).toBe("local-cache");
  });

  it("clears resume authority when clearing resume scan state", () => {
    useHistoryStore.getState().setResumeScan(
      "remote-scan-1",
      null,
      {
        received: 4,
        total: 10,
        filename: "remote.bin",
      },
      { authority: "server" }
    );

    useHistoryStore.getState().clearResumeScan();

    expect(useHistoryStore.getState().resumeAuthority).toBeNull();
  });

  it("clears resume authority when clearing history state", () => {
    useHistoryStore.getState().setResumeScan(
      "remote-scan-1",
      null,
      {
        received: 4,
        total: 10,
        filename: "remote.bin",
      },
      { authority: "server" }
    );

    useHistoryStore.getState().clearHistory();

    expect(useHistoryStore.getState().resumeAuthority).toBeNull();
  });

  it("keeps packet buffers out of incomplete store state while persisting only new packet deltas", async () => {
    render(<ScannerTab />);

    expect(latestScannerPropsRef.current).not.toBeNull();

    const packetA = new Uint8Array([1, 2, 3]);
    const packetB = new Uint8Array([4, 5, 6]);
    const packetC = new Uint8Array([7, 8, 9]);
    const firstDelta = [packetA, packetB];

    act(() => {
      (latestScannerPropsRef.current?.onScanProgress as ((stats: unknown) => void) | undefined)?.({
        sessionId: "session-1",
        filename: "scan.bin",
        received: 2,
        total: 10,
        source: "local",
        packetStartIndex: 0,
        packetDelta: firstDelta,
        chunksSaved: 0,
      });
    });

    act(() => {
      (latestScannerPropsRef.current?.onScanProgress as ((stats: unknown) => void) | undefined)?.({
        sessionId: "session-1",
        filename: "scan.bin",
        received: 3,
        total: 10,
        source: "local",
        packetStartIndex: 2,
        packetDelta: [packetC],
        chunksSaved: 1,
      });
    });

    await waitFor(() => {
      expect(appendScanSessionPacketsMock).toHaveBeenNthCalledWith(
        1,
        "session-1",
        0,
        firstDelta
      );
    });

    await waitFor(() => {
      expect(appendScanSessionPacketsMock).toHaveBeenNthCalledWith(
        2,
        "session-1",
        2,
        [packetC]
      );
    });

    const state = useHistoryStore.getState();

    expect(state.incompleteItems).toHaveLength(1);
    expect(state.incompleteItems[0]).toMatchObject({
      sessionId: "session-1",
      received: 3,
      total: 10,
      filename: "scan.bin",
      source: "local",
      chunksSaved: 1,
    });
    expect(state.incompleteItems[0]).not.toHaveProperty("packets");
    expect(state.resumeSessionId).toBe("session-1");
    expect(state.resumePackets).toBeNull();
    expect(state.resumeStats).toMatchObject({
      received: 3,
      total: 10,
      filename: "scan.bin",
    });
  });

  it("persists incomplete metadata immediately alongside packet deltas", async () => {
    render(<ScannerTab />);

    act(() => {
      (latestScannerPropsRef.current?.onScanProgress as ((stats: unknown) => void) | undefined)?.({
        sessionId: "session-2",
        filename: "scan.bin",
        received: 2,
        total: 10,
        source: "local",
        packetStartIndex: 0,
        packetDelta: [new Uint8Array([1, 2, 3])],
        chunksSaved: 0,
      });
    });

    await waitFor(() => {
      expect(appendScanSessionPacketsMock).toHaveBeenCalledWith(
        "session-2",
        0,
        [new Uint8Array([1, 2, 3])]
      );
    });

    await waitFor(() => {
      expect(saveIncompleteScanMock).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: "session-2",
        filename: "scan.bin",
        received: 2,
        total: 10,
        totalIsEstimate: true,
        date: expect.any(String),
        chunksSaved: 0,
        source: "local",
      }));
    });
  });

  it("persists local packet deltas during server-authoritative resume progress", async () => {
    useHistoryStore.setState({
      items: [],
      incompleteItems: [
        {
          sessionId: "remote-scan-1",
          filename: "large.bin",
          received: 8000,
          total: 12000,
          totalIsEstimate: true,
          date: "10:00",
          source: "server",
          remoteSessionId: "remote-scan-1",
        },
      ],
      resumeSessionId: "remote-scan-1",
      resumePackets: null,
      resumeStats: {
        received: 8000,
        total: 12000,
        filename: "large.bin",
      },
      resumeAuthority: "server",
    });

    render(<ScannerTab />);

    const packet = new Uint8Array([1, 2, 3]);

    act(() => {
      (latestScannerPropsRef.current?.onScanProgress as ((stats: unknown) => void) | undefined)?.({
        sessionId: "remote-scan-1",
        filename: "large.bin",
        received: 8001,
        total: 12000,
        source: "local",
        packetStartIndex: 8000,
        packetDelta: [packet],
        chunksSaved: 1,
      });
    });

    await waitFor(() => {
      expect(saveIncompleteScanMock).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: "remote-scan-1",
        received: 8001,
        total: 12000,
        source: "server",
      }));
    });
    await waitFor(() => {
      expect(appendScanSessionPacketsMock).toHaveBeenCalledWith(
        "remote-scan-1",
        8000,
        [packet]
      );
    });
  });
});
