import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useScannerSyncProgress,
  type SessionProgressInfo,
} from '@web/hooks/useScannerSyncProgress';
import type { ScanUploadConfig } from '@web/types';

const {
  countScanSessionPacketsMock,
  connectMock,
  deleteIncompleteScanMock,
  deleteScanSessionChunksMock,
  deleteScanSessionPacketsMock,
  fetchServerFileMock,
  fetchServerSessionMock,
  getStateMock,
  queueScanPacketMock,
  subscribeMock,
  visitScanSessionPacketPagesMock,
  unsubscribeMock,
  websocketEventHandlerRef,
} = vi.hoisted(() => ({
  countScanSessionPacketsMock: vi.fn(),
  connectMock: vi.fn(),
  deleteIncompleteScanMock: vi.fn(),
  deleteScanSessionChunksMock: vi.fn(),
  deleteScanSessionPacketsMock: vi.fn(),
  fetchServerFileMock: vi.fn(),
  fetchServerSessionMock: vi.fn(),
  getStateMock: vi.fn(() => 'connected'),
  queueScanPacketMock: vi.fn(),
  subscribeMock: vi.fn(),
  visitScanSessionPacketPagesMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  websocketEventHandlerRef: {
    current: null as
      | ((event: { type: string; payload: Record<string, unknown> }) => void)
      | null,
  },
}));

vi.mock('@web/services/historyDB', () => ({
  deleteIncompleteScan: deleteIncompleteScanMock,
}));

vi.mock('@web/services/scanSessionDB', () => ({
  countScanSessionPackets: countScanSessionPacketsMock,
  deleteScanSessionChunks: deleteScanSessionChunksMock,
  deleteScanSessionPackets: deleteScanSessionPacketsMock,
  visitScanSessionPacketPages: visitScanSessionPacketPagesMock,
}));

vi.mock('@web/services/scanSyncService', () => ({
  fetchServerFile: fetchServerFileMock,
  fetchServerSession: fetchServerSessionMock,
}));

vi.mock('@web/services/scanUploadService', () => ({
  queueScanPacket: queueScanPacketMock,
}));

vi.mock('@web/services/websocketSyncService', () => ({
  getWebSocketSyncService: vi.fn(() => ({
    connect: connectMock,
    getState: getStateMock,
    subscribe: subscribeMock.mockImplementation(
      (handler: (event: { type: string; payload: Record<string, unknown> }) => void) => {
        websocketEventHandlerRef.current = handler;
        return unsubscribeMock;
      }
    ),
  })),
}));

const baseUploadConfig: ScanUploadConfig = {
  enabled: false,
  url: '',
  apiKey: '',
  username: '',
  password: '',
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: true,
};

function createArgs(overrides: Partial<Parameters<typeof useScannerSyncProgress>[0]> = {}) {
  const onScanProgress = vi.fn();
  const setSessionProgress = vi.fn();
  const setSyncSourceName = vi.fn();
  const setProgress = vi.fn();
  const setStatus = vi.fn();
  const setIsScanning = vi.fn();
  const setResultData = vi.fn();
  const onScanComplete = vi.fn();

  return {
    activeSessionId: null as string | null,
    uploadConfig: baseUploadConfig,
    serverAuthReady: false,
    resumeSessionId: undefined,
    onScanComplete,
    onScanProgressRef: { current: onScanProgress },
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'scanner.sessionProgressStatus') {
        return `Session progress: ${options?.received}/${options?.total}`;
      }
      if (key === 'common.unknownFile') {
        return 'Unknown File';
      }
      if (key === 'scanner.scanning') {
        return 'Scanning...';
      }
      return key;
    },
    getScanDurationSeconds: () => 7,
    chunksSavedRef: { current: 0 },
    filenameRef: { current: null as string | null },
    ignoredSessionAfterResetRef: { current: null as string | null },
    localDeviceName: 'This phone',
    remoteCompleteHandledRef: { current: null as string | null },
    resultDataRef: {
      current: null as
        | {
            kind: 'file' | 'note';
            filename: string;
            data: unknown;
            duration: number;
            noteContent?: string;
            sessionId?: string;
          }
        | null,
    },
    serverProgressSeenRef: { current: false },
    serverSnapshotInFlightRef: { current: false },
    sessionIdRef: { current: null as string | null },
    setIsScanning,
    setProgress,
    setResultData,
    setSessionProgress,
    setStatus,
    setSyncSourceName,
    suppressResetSessionRealtimeRef: { current: false },
    ...overrides,
  };
}

describe('useScannerSyncProgress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    countScanSessionPacketsMock.mockReset();
    countScanSessionPacketsMock.mockResolvedValue(0);
    connectMock.mockReset();
    deleteIncompleteScanMock.mockReset();
    deleteScanSessionChunksMock.mockReset();
    deleteScanSessionPacketsMock.mockReset();
    fetchServerFileMock.mockReset();
    fetchServerSessionMock.mockReset();
    getStateMock.mockReset();
    getStateMock.mockReturnValue('connected');
    queueScanPacketMock.mockReset();
    subscribeMock.mockReset();
    subscribeMock.mockImplementation((handler) => {
      websocketEventHandlerRef.current = handler;
      return unsubscribeMock;
    });
    unsubscribeMock.mockReset();
    visitScanSessionPacketPagesMock.mockReset();
    visitScanSessionPacketPagesMock.mockResolvedValue({ pageCount: 0, packetCount: 0 });
    websocketEventHandlerRef.current = null;
  });

  it('adopts the resume session and applies matching realtime progress updates', async () => {
    const args = createArgs({
      resumeSessionId: '123',
    });

    renderHook(() => useScannerSyncProgress(args));

    expect(websocketEventHandlerRef.current).toBeTypeOf('function');

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 500,
          expectedPackets: 1182,
          totalPacketsExact: false,
          filename: 'remote.bin',
          deviceName: 'Other phone',
        },
      });
    });

    await waitFor(() => {
      expect(args.sessionIdRef.current).toBe('123');
    });

    expect(args.serverProgressSeenRef.current).toBe(true);
    expect(args.setSyncSourceName).toHaveBeenCalledWith('Other phone');
    expect(args.setSessionProgress).toHaveBeenCalledWith({
      received: 500,
      total: 1182,
      totalLabel: '1182',
      totalIsEstimate: true,
      min: 1182,
      minLabel: '1182',
      max: null,
      maxLabel: '-',
      percent: expect.closeTo((500 / 1182) * 100, 5),
    } satisfies SessionProgressInfo);
    expect(args.onScanProgressRef.current).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '123',
        filename: 'remote.bin',
        received: 500,
        total: 1182,
        totalIsEstimate: true,
        source: 'server',
      })
    );
  });

  it('applies matching realtime canonical scan-session-state updates', async () => {
    const chunks = [
      {
        chunkId: 0,
        receivedUnique: 250,
        decodeThreshold: 500,
        totalPackets: 600,
        totalPacketsExact: true,
        state: 'scanning',
        missingCount: 250,
        missingRanges: [[250, 499]],
        targetFrameCount: null,
        targetFrameRanges: [],
        unseenFrameCount: null,
        unseenFrameRanges: [],
      },
      {
        chunkId: 1,
        receivedUnique: 250,
        decodeThreshold: 500,
        totalPackets: 600,
        totalPacketsExact: true,
        state: 'scanning',
        missingCount: 250,
        missingRanges: [[250, 499]],
        targetFrameCount: null,
        targetFrameRanges: [],
        unseenFrameCount: null,
        unseenFrameRanges: [],
      },
    ];
    const args = createArgs({
      resumeSessionId: '123',
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-session-state',
        payload: {
          type: 'scan-session-state',
          stateVersion: 3,
          sessionId: '123',
          status: 'active',
          updatedAt: '2026-06-11T10:00:00.000Z',
          filename: 'remote.bin',
          receivedUnique: 500,
          decodeThreshold: 1000,
          totalPackets: 1200,
          totalPacketsExact: true,
          completionPercent: 50,
          decodeState: 'scanning',
          isComplete: false,
          fileAvailable: false,
          chunksTotal: 2,
          chunksComplete: 0,
          chunksMissing: 2,
          chunks,
          assembly: {
            inProgress: false,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
          },
        },
      });
    });

    await waitFor(() => {
      expect(args.sessionIdRef.current).toBe('123');
    });

    expect(args.setSessionProgress).toHaveBeenCalledWith({
      received: 500,
      total: 1000,
      totalLabel: '1000',
      totalIsEstimate: false,
      min: 1000,
      minLabel: '1000',
      max: 1200,
      maxLabel: '1200',
      percent: 50,
      decodeState: 'scanning',
      fileAvailable: false,
      chunksTotal: 2,
      chunksComplete: 0,
      chunksMissing: 2,
      chunks,
    } satisfies SessionProgressInfo);
    expect(args.setProgress).toHaveBeenCalledWith(50);
    expect(args.onScanProgressRef.current).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '123',
        filename: 'remote.bin',
        received: 500,
        total: 1000,
        progressPercent: 50,
        source: 'server',
        chunksCompleted: 0,
        totalChunks: 2,
      })
    );
  });

  it('does not regress progress from stale lower-version canonical state', async () => {
    const args = createArgs({
      resumeSessionId: '123',
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-session-state',
        payload: {
          type: 'scan-session-state',
          stateVersion: 3,
          sessionId: '123',
          status: 'active',
          updatedAt: '2026-06-11T10:00:00.000Z',
          filename: 'remote.bin',
          receivedUnique: 500,
          decodeThreshold: 1000,
          totalPackets: 1200,
          totalPacketsExact: true,
          completionPercent: 50,
          decodeState: 'scanning',
          isComplete: false,
          fileAvailable: false,
          chunksTotal: 1,
          chunksComplete: 0,
          chunksMissing: 1,
          chunks: [],
          assembly: {
            inProgress: false,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
          },
        },
      });
      websocketEventHandlerRef.current?.({
        type: 'scan-session-state',
        payload: {
          type: 'scan-session-state',
          stateVersion: 2,
          sessionId: '123',
          status: 'active',
          updatedAt: '2026-06-11T10:01:00.000Z',
          filename: 'remote.bin',
          receivedUnique: 300,
          decodeThreshold: 1000,
          totalPackets: 1200,
          totalPacketsExact: true,
          completionPercent: 30,
          decodeState: 'scanning',
          isComplete: false,
          fileAvailable: false,
          chunksTotal: 1,
          chunksComplete: 0,
          chunksMissing: 1,
          chunks: [],
          assembly: {
            inProgress: false,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
          },
        },
      });
    });

    await waitFor(() => {
      expect(args.setProgress).toHaveBeenCalled();
    });

    expect(args.setProgress).toHaveBeenLastCalledWith(50);
    expect(args.setSessionProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        received: 500,
        percent: 50,
      })
    );
  });

  it('does not regress canonical progress from a stale legacy scan-progress event', async () => {
    const args = createArgs({
      resumeSessionId: '123',
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-session-state',
        payload: {
          type: 'scan-session-state',
          stateVersion: 3,
          sessionId: '123',
          status: 'active',
          updatedAt: '2026-06-11T10:00:00.000Z',
          filename: 'remote.bin',
          receivedUnique: 500,
          decodeThreshold: 1000,
          totalPackets: 1200,
          totalPacketsExact: true,
          completionPercent: 50,
          decodeState: 'scanning',
          isComplete: false,
          fileAvailable: false,
          chunksTotal: 1,
          chunksComplete: 0,
          chunksMissing: 1,
          chunks: [],
          assembly: {
            inProgress: false,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
          },
        },
      });
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 300,
          expectedPackets: 1000,
          totalPackets: 1200,
          totalPacketsExact: true,
          filename: 'remote.bin',
        },
      });
    });

    await waitFor(() => {
      expect(args.setProgress).toHaveBeenCalled();
    });

    expect(args.setProgress).toHaveBeenLastCalledWith(50);
    expect(args.setSessionProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        received: 500,
        percent: 50,
      })
    );
  });

  it('keeps legacy scan-progress below 100 until completion is confirmed', async () => {
    const args = createArgs({
      resumeSessionId: '123',
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 1000,
          expectedPackets: 1000,
          totalPackets: 1200,
          totalPacketsExact: true,
          filename: 'remote.bin',
        },
      });
    });

    await waitFor(() => {
      expect(args.setSessionProgress).toHaveBeenCalled();
    });

    expect(args.setProgress).toHaveBeenLastCalledWith(99);
    expect(args.setSessionProgress).toHaveBeenLastCalledWith({
      received: 1000,
      total: 1000,
      totalLabel: '1000',
      totalIsEstimate: false,
      min: 1000,
      minLabel: '1000',
      max: 1200,
      maxLabel: '1200',
      percent: 99,
    } satisfies SessionProgressInfo);
  });

  it('displays canonical decode threshold as the UI target while replay metadata stays estimated', async () => {
    countScanSessionPacketsMock.mockResolvedValue(13);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([11]), new Uint8Array([22])],
      });
      return { pageCount: 1, packetCount: 2 };
    });
    const args = createArgs({
      activeSessionId: '123',
      sessionIdRef: { current: '123' },
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
      serverAuthReady: true,
      filenameRef: { current: 'remote.bin' },
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-session-state',
        payload: {
          type: 'scan-session-state',
          stateVersion: 4,
          sessionId: '123',
          status: 'active',
          updatedAt: '2026-06-11T10:02:00.000Z',
          filename: 'remote.bin',
          receivedUnique: 12,
          decodeThreshold: 52,
          totalPackets: null,
          totalPacketsExact: false,
          completionPercent: 23.1,
          decodeState: 'scanning',
          isComplete: false,
          fileAvailable: false,
          chunksTotal: 1,
          chunksComplete: 0,
          chunksMissing: 1,
          chunks: [],
          assembly: {
            inProgress: false,
            attempts: 0,
            lastAttemptAt: null,
            lastError: null,
          },
        },
      });
    });

    await waitFor(() => {
      expect(args.setSessionProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          total: 52,
          totalLabel: '52',
          totalIsEstimate: true,
          min: 52,
          minLabel: '52',
          max: null,
          maxLabel: '-',
        })
      );
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(2);
    });

    expect(queueScanPacketMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Uint8Array),
      expect.objectContaining({
        expectedPackets: 52,
        totalPackets: 52,
        totalPacketsExact: false,
      }),
      expect.objectContaining({
        url: 'https://sync.example.test',
      }),
      expect.objectContaining({
        replay: true,
      })
    );
  });

  it('refreshes the server snapshot when a connection-ready event arrives', async () => {
    fetchServerSessionMock.mockResolvedValue({
      sessionId: '123',
      receivedCount: 8,
      expectedPackets: 10,
      filename: 'remote.bin',
      deviceName: 'Other phone',
      totalPacketsExact: true,
    });
    const args = createArgs({
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
      serverAuthReady: true,
      sessionIdRef: { current: '123' },
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'history',
        payload: {
          kind: 'connection-ready',
        },
      });
    });

    await waitFor(() => {
      expect(fetchServerSessionMock).toHaveBeenCalledWith(
        args.uploadConfig,
        '123'
      );
    });

    expect(args.setSessionProgress).toHaveBeenCalledWith({
      received: 8,
      total: 10,
      totalLabel: '10',
      totalIsEstimate: false,
      min: 10,
      minLabel: '10',
      max: null,
      maxLabel: '-',
      percent: 80,
    } satisfies SessionProgressInfo);
  });

  it('ignores a server snapshot that resolves after the resumed session was reset', async () => {
    let resolveSession: (value: unknown) => void = () => {};
    fetchServerSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        })
    );

    const ignoredSessionAfterResetRef = { current: null as string | null };
    const sessionIdRef = { current: 'resume-123' as string | null };
    const suppressResetSessionRealtimeRef = { current: false };
    const args = createArgs({
      activeSessionId: 'resume-123',
      ignoredSessionAfterResetRef,
      sessionIdRef,
      suppressResetSessionRealtimeRef,
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
      serverAuthReady: true,
    });

    renderHook(() => useScannerSyncProgress(args));

    await waitFor(() => {
      expect(fetchServerSessionMock).toHaveBeenCalledWith(
        args.uploadConfig,
        'resume-123'
      );
    });

    act(() => {
      ignoredSessionAfterResetRef.current = 'resume-123';
      sessionIdRef.current = null;
      suppressResetSessionRealtimeRef.current = true;
    });

    resolveSession({
      sessionId: 'resume-123',
      receivedCount: 8308,
      expectedPackets: 11192,
      filename: 'remote.bin',
      totalPackets: 13430,
      totalPacketsExact: true,
    });

    await waitFor(() => {
      expect(args.serverSnapshotInFlightRef.current).toBe(false);
    });

    expect(sessionIdRef.current).toBeNull();
    expect(args.setSessionProgress).not.toHaveBeenCalled();
    expect(args.setProgress).not.toHaveBeenCalled();
    expect(args.onScanProgressRef.current).not.toHaveBeenCalled();
  });

  it('connects realtime sync when credentials exist even if the auth probe is not ready', async () => {
    fetchServerSessionMock.mockResolvedValue({
      sessionId: '123',
      receivedCount: 12,
      expectedPackets: 20,
      filename: 'remote.bin',
      deviceName: 'Other phone',
      totalPacketsExact: true,
    });
    const args = createArgs({
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
        username: 'admin',
        password: 'admin',
      },
      serverAuthReady: false,
      sessionIdRef: { current: '123' },
    });

    renderHook(() => useScannerSyncProgress(args));

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith(args.uploadConfig);
    });

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'history',
        payload: {
          kind: 'connection-ready',
        },
      });
    });

    await waitFor(() => {
      expect(fetchServerSessionMock).toHaveBeenCalledWith(
        args.uploadConfig,
        '123'
      );
    });

    expect(args.setSessionProgress).toHaveBeenCalledWith({
      received: 12,
      total: 20,
      totalLabel: '20',
      totalIsEstimate: false,
      min: 20,
      minLabel: '20',
      max: null,
      maxLabel: '-',
      percent: 60,
    } satisfies SessionProgressInfo);
  });

  it('connects realtime sync when only a cookie-backed server session is available and the auth probe is still cold', async () => {
    fetchServerSessionMock.mockResolvedValue({
      sessionId: '123',
      receivedCount: 520,
      expectedPackets: 1182,
      totalPackets: 1416,
      filename: 'remote.bin',
      deviceName: 'Other phone',
      totalPacketsExact: true,
    });
    const args = createArgs({
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
      serverAuthReady: false,
      sessionIdRef: { current: '123' },
    });

    renderHook(() => useScannerSyncProgress(args));

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith(args.uploadConfig);
    });

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'history',
        payload: {
          kind: 'connection-ready',
        },
      });
    });

    await waitFor(() => {
      expect(fetchServerSessionMock).toHaveBeenCalledWith(
        args.uploadConfig,
        '123'
      );
    });

    expect(args.setSessionProgress).toHaveBeenCalledWith({
      received: 520,
      total: 1182,
      totalLabel: '1182',
      totalIsEstimate: false,
      min: 1182,
      minLabel: '1182',
      max: 1416,
      maxLabel: '1416',
      percent: expect.closeTo((520 / 1182) * 100, 5),
    } satisfies SessionProgressInfo);
  });

  it('periodically replays local packets when server progress is stalled after startup probes', async () => {
    vi.useFakeTimers();
    try {
      let localPacketCount = 2;
      countScanSessionPacketsMock.mockImplementation(async () => localPacketCount);
      visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
        await visitor({
          startIndex: 0,
          packets: Array.from(
            { length: localPacketCount },
            (_, index) => new Uint8Array([index + 1])
          ),
        });
        return { pageCount: 1, packetCount: localPacketCount };
      });
      fetchServerSessionMock.mockResolvedValue({
        sessionId: '123',
        receivedCount: 1,
        expectedPackets: 10,
        totalPackets: 12,
        filename: 'remote.bin',
        deviceName: 'Other phone',
        totalPacketsExact: true,
      });
      const args = createArgs({
        activeSessionId: '123',
        resumeAuthority: 'server',
        sessionIdRef: { current: '123' },
        uploadConfig: {
          ...baseUploadConfig,
          enabled: true,
          url: 'https://sync.example.test',
        },
        serverAuthReady: true,
        filenameRef: { current: 'remote.bin' },
      });

      renderHook(() => useScannerSyncProgress(args));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      fetchServerSessionMock.mockClear();
      countScanSessionPacketsMock.mockClear();
      visitScanSessionPacketPagesMock.mockClear();
      queueScanPacketMock.mockClear();
      localPacketCount = 4;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });

      expect(fetchServerSessionMock).toHaveBeenCalledWith(
        args.uploadConfig,
        '123'
      );
      expect(countScanSessionPacketsMock).toHaveBeenCalledWith('123');
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        '123',
        expect.any(Function)
      );
      expect(queueScanPacketMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bootstraps the shared session progress when a fresh local session starts after websocket connect', async () => {
    const sessionIdRef = { current: null as string | null };
    fetchServerSessionMock.mockResolvedValue({
      sessionId: '123',
      receivedCount: 220,
      expectedPackets: 1182,
      totalPackets: 1416,
      totalPacketsExact: true,
      filename: 'remote.bin',
      deviceName: 'Other phone',
    });
    const args = createArgs({
      activeSessionId: null,
      sessionIdRef,
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
      serverAuthReady: true,
    });

    const { rerender } = renderHook(
      (props: Parameters<typeof useScannerSyncProgress>[0]) =>
        useScannerSyncProgress(props),
      {
        initialProps: args,
      }
    );

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith(args.uploadConfig);
    });

    act(() => {
      sessionIdRef.current = '123';
    });

    rerender({
      ...args,
      activeSessionId: '123',
      sessionIdRef,
    });

    await waitFor(() => {
      expect(fetchServerSessionMock).toHaveBeenCalledWith(
        args.uploadConfig,
        '123'
      );
    });

    expect(args.setSessionProgress).toHaveBeenCalledWith({
      received: 220,
      total: 1182,
      totalLabel: '1182',
      totalIsEstimate: false,
      min: 1182,
      minLabel: '1182',
      max: 1416,
      maxLabel: '1416',
      percent: expect.closeTo((220 / 1182) * 100, 5),
    } satisfies SessionProgressInfo);
  });

  it('fetches the remote file and clears cached packets on matching scan completion', async () => {
    const fileData = new Uint8Array([1, 2, 3]);
    fetchServerFileMock.mockResolvedValue({
      filename: 'done.bin',
      data: fileData,
    });
    const args = createArgs({
      sessionIdRef: { current: '123' },
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-complete',
        payload: {
          sessionId: '123',
          duration: 5,
          filename: 'done.bin',
        },
      });
    });

    await waitFor(() => {
      expect(fetchServerFileMock).toHaveBeenCalledWith(args.uploadConfig, '123');
    });

    expect(args.setIsScanning).toHaveBeenCalledWith(false);
    expect(args.setProgress).toHaveBeenCalledWith(100);
    expect(args.setResultData).toHaveBeenCalledWith({
      kind: 'file',
      filename: 'done.bin',
      data: fileData,
      duration: 5,
    });
    expect(args.onScanComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '123',
        title: 'done.bin',
        origin: 'scanned',
      })
    );
    expect(deleteIncompleteScanMock).toHaveBeenCalledWith('123');
    expect(deleteScanSessionChunksMock).toHaveBeenCalledWith('123');
    expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith('123');
  });

  it('treats remote text scan completions as note results and preserves text mime type in history', async () => {
    const fileData = new Uint8Array([35, 32, 104, 105]);
    fetchServerFileMock.mockResolvedValue({
      filename: 'note.md',
      mimeType: 'text/plain',
      data: fileData,
    });
    const args = createArgs({
      sessionIdRef: { current: 'note-session' },
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-complete',
        payload: {
          sessionId: 'note-session',
          duration: 2,
          filename: 'note.md',
        },
      });
    });

    await waitFor(() => {
      expect(fetchServerFileMock).toHaveBeenCalledWith(
        args.uploadConfig,
        'note-session'
      );
    });

    expect(args.setResultData).toHaveBeenCalledWith({
      kind: 'note',
      filename: 'note.md',
      data: fileData,
      duration: 2,
      noteContent: '# hi',
      sessionId: 'note-session',
    });
    expect(args.onScanComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'note-session',
        title: 'note.md',
        origin: 'scanned',
        type: 'text',
        mimeType: 'text/plain',
      })
    );
  });

  it('replays persisted local scan packets when shared server progress falls behind the active session', async () => {
    countScanSessionPacketsMock.mockResolvedValue(2);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([11]), new Uint8Array([22])],
      });
      return { pageCount: 1, packetCount: 2 };
    });

    const args = createArgs({
      activeSessionId: '123',
      sessionIdRef: { current: '123' },
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
      serverAuthReady: true,
      filenameRef: { current: 'remote.bin' },
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 1,
          expectedPackets: 10,
          totalPackets: 12,
          totalPacketsExact: true,
          filename: 'remote.bin',
          deviceName: 'Other phone',
        },
      });
    });

    await waitFor(() => {
      expect(countScanSessionPacketsMock).toHaveBeenCalledWith('123');
    });

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        '123',
        expect.any(Function)
      );
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(2);
    });

    expect(queueScanPacketMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: '123',
        packetIndex: 0,
        filename: 'remote.bin',
      }),
      expect.objectContaining({
        url: 'https://sync.example.test',
      }),
      expect.objectContaining({
        replay: true,
      })
    );
  });

  it('replays persisted packet backfill during server-authoritative resume while applying realtime progress', async () => {
    countScanSessionPacketsMock.mockResolvedValue(2);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([11]), new Uint8Array([22])],
      });
      return { pageCount: 1, packetCount: 2 };
    });

    const args = createArgs({
      activeSessionId: '123',
      resumeAuthority: 'server',
      sessionIdRef: { current: '123' },
      uploadConfig: {
        ...baseUploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
      },
      serverAuthReady: true,
      filenameRef: { current: 'remote.bin' },
    });

    renderHook(() => useScannerSyncProgress(args));

    act(() => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 1,
          expectedPackets: 10,
          totalPackets: 12,
          totalPacketsExact: true,
          filename: 'remote.bin',
          deviceName: 'Other phone',
        },
      });
    });

    await waitFor(() => {
      expect(args.serverProgressSeenRef.current).toBe(true);
    });

    expect(args.setSessionProgress).toHaveBeenCalledWith({
      received: 1,
      total: 10,
      totalLabel: '10',
      totalIsEstimate: false,
      min: 10,
      minLabel: '10',
      max: 12,
      maxLabel: '12',
      percent: 10,
    } satisfies SessionProgressInfo);
    expect(args.onScanProgressRef.current).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '123',
        filename: 'remote.bin',
        received: 1,
        total: 10,
        source: 'server',
      })
    );
    await waitFor(() => {
      expect(countScanSessionPacketsMock).toHaveBeenCalledWith('123');
    });
    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        '123',
        expect.any(Function)
      );
    });
    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(2);
    });
    expect(queueScanPacketMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: '123',
        packetIndex: 0,
        filename: 'remote.bin',
      }),
      expect.objectContaining({
        url: 'https://sync.example.test',
      }),
      expect.objectContaining({
        replay: true,
      })
    );
  });
});
