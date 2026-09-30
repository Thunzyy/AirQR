import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Scanner from '@web/features/scanner/Scanner';
import { useScannerStore, useSettingsStore } from '@web/store';

const {
  countScanSessionPacketsMock,
  decodeStreamingPacketMock,
  deleteScanSessionChunksMock,
  deleteIncompleteScanMock,
  getIncompleteScanByIdMock,
  loadScanSessionChunksMock,
  queueScanPacketMock,
  queueScanCompleteMock,
  saveScanSessionChunkMock,
  serverAuthStateRef,
  visitScanSessionPacketPagesMock,
  websocketEventHandlerRef,
  workerRef,
} = vi.hoisted(() => ({
  countScanSessionPacketsMock: vi.fn(),
  decodeStreamingPacketMock: vi.fn(),
  deleteScanSessionChunksMock: vi.fn(),
  deleteIncompleteScanMock: vi.fn(),
  getIncompleteScanByIdMock: vi.fn(),
  loadScanSessionChunksMock: vi.fn(),
  queueScanPacketMock: vi.fn(),
  queueScanCompleteMock: vi.fn(),
  saveScanSessionChunkMock: vi.fn(),
  serverAuthStateRef: {
    current: {
      authEnabled: true,
      authorized: true,
      username: 'admin',
      checking: false,
      connectionError: false,
      authReady: true,
    },
  },
  visitScanSessionPacketPagesMock: vi.fn(),
  websocketEventHandlerRef: {
    current: null as ((event: { type: string; payload: Record<string, unknown> }) => void) | null,
  },
  workerRef: {
    current: null as {
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
      dispatchEvent: ReturnType<typeof vi.fn>;
      onmessage: ((event: { data: Record<string, unknown> }) => void) | null;
      onerror: ((event: unknown) => void) | null;
    } | null,
  },
}));

vi.mock('@web/wasm/airqrCoreTyped', () => ({
  default: vi.fn().mockResolvedValue(undefined),
  init_streaming_decoder: vi.fn(),
  decode_streaming_packet: decodeStreamingPacketMock,
  init_normal_decoder: vi.fn(),
  decode_normal_packet: vi.fn(),
}));

vi.mock('@web/services/historyDB', () => ({
  deleteIncompleteScan: deleteIncompleteScanMock,
  getIncompleteScanById: getIncompleteScanByIdMock,
}));

vi.mock('@web/services/scanSessionDB', () => ({
  appendScanSessionPackets: vi.fn(),
  countScanSessionPackets: countScanSessionPacketsMock,
  replaceScanSessionPackets: vi.fn(),
  saveScanSessionChunk: saveScanSessionChunkMock,
  loadScanSessionChunks: loadScanSessionChunksMock,
  visitScanSessionPacketPages: visitScanSessionPacketPagesMock,
  deleteScanSessionChunks: deleteScanSessionChunksMock,
  deleteScanSessionPackets: vi.fn(),
}));

vi.mock('@web/services/scanWorkerManager', () => ({
  initScanWorker: vi.fn().mockImplementation(async () => {
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    workerRef.current = worker;
    return worker;
  }),
}));

vi.mock('@web/services/scanUploadService', () => ({
  queueScanComplete: queueScanCompleteMock,
  queueScanPacket: queueScanPacketMock,
}));

vi.mock('@web/services/scanSyncService', () => ({
  fetchServerFile: vi.fn(),
}));

vi.mock('@web/hooks/useServerAuthState', () => ({
  useServerAuthState: vi.fn(() => serverAuthStateRef.current),
}));

vi.mock('@web/services/websocketSyncService', () => ({
  getWebSocketSyncService: vi.fn(() => ({
    sendBenchmarkEvent: vi.fn(),
    connect: vi.fn(),
    getState: vi.fn(() => 'connected'),
    subscribe: vi.fn((handler: (event: { type: string; payload: Record<string, unknown> }) => void) => {
      websocketEventHandlerRef.current = handler;
      return vi.fn(() => {
        if (websocketEventHandlerRef.current === handler) {
          websocketEventHandlerRef.current = null;
        }
      });
    }),
  })),
}));

describe('Scanner camera lifecycle', () => {
  const getUserMediaMock = vi.fn();
  const enumerateDevicesMock = vi.fn();
  const originalUserAgent = navigator.userAgent;

  function createStreamingPacket(sessionId = 123, chunkId = 0, totalChunks = 1) {
    const packet = new Uint8Array(35);
    packet[0] = 2;
    packet.set([0, 0, 0, sessionId], 1);
    packet.set([0, 0, 0, chunkId], 5);
    packet.set([0, 0, 0, totalChunks], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);
    packet.set([0, 0, 0, 4], 31);
    return packet;
  }

  beforeEach(() => {
    countScanSessionPacketsMock.mockReset();
    countScanSessionPacketsMock.mockResolvedValue(0);
    decodeStreamingPacketMock.mockReset();
    deleteScanSessionChunksMock.mockReset();
    deleteIncompleteScanMock.mockReset();
    getIncompleteScanByIdMock.mockReset();
    loadScanSessionChunksMock.mockReset();
    queueScanPacketMock.mockReset();
    queueScanCompleteMock.mockReset();
    saveScanSessionChunkMock.mockReset();
    serverAuthStateRef.current = {
      authEnabled: true,
      authorized: true,
      username: 'admin',
      checking: false,
      connectionError: false,
      authReady: true,
    };
    visitScanSessionPacketPagesMock.mockReset();
    visitScanSessionPacketPagesMock.mockResolvedValue({ pageCount: 0, packetCount: 0 });
    websocketEventHandlerRef.current = null;
    workerRef.current = null;

    const stream = {
      getTracks: () => [
        {
          stop: vi.fn(),
          readyState: 'live',
          applyConstraints: vi.fn(),
          getCapabilities: vi.fn(() => ({})),
        },
      ],
      getVideoTracks: () => [
        {
          stop: vi.fn(),
          readyState: 'live',
          applyConstraints: vi.fn(),
          getCapabilities: vi.fn(() => ({})),
        },
      ],
    };

    getUserMediaMock.mockReset();
    getUserMediaMock.mockResolvedValue(stream);
    enumerateDevicesMock.mockReset();
    enumerateDevicesMock.mockResolvedValue([
      { kind: 'videoinput', deviceId: 'rear-camera', label: 'Back Camera' },
      { kind: 'videoinput', deviceId: 'front-camera', label: 'Front Camera' },
    ]);

    (navigator as Navigator & { mediaDevices: MediaDevices }).mediaDevices = {
      getUserMedia: getUserMediaMock,
      enumerateDevices: enumerateDevicesMock,
    } as MediaDevices;

    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      value: null,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      get: () => 1,
      configurable: true,
    });

    useScannerStore.setState({
      config: {
        ...useScannerStore.getState().config,
        enableTorch: false,
      },
    });
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      defaultCameraId: null,
    });

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the camera once on mount instead of restarting on internal rerenders', async () => {
    render(<Scanner />);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(enumerateDevicesMock).toHaveBeenCalled();
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });

  it('does not upload scan completion directly when a chunked scan finishes locally', async () => {
    const onScanComplete = vi.fn();
    const chunkData = new Uint8Array([1, 2, 3, 4]);
    const packet = new Uint8Array(31);
    packet[0] = 1;
    packet.set([0, 0, 0, 123], 1);
    packet.set([0, 0, 0, 0], 5);
    packet.set([0, 0, 0, 1], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'chunk_completed',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 0,
      totalChunks: 1,
      chunksCompleted: 1,
      overallPercent: 100,
      chunkData,
      packetsReceivedTotal: 1,
      packetsExpectedChunk: 1,
    });

    saveScanSessionChunkMock.mockResolvedValue(undefined);
    loadScanSessionChunksMock.mockResolvedValue([{ id: 0, data: chunkData }]);
    getIncompleteScanByIdMock.mockResolvedValue(null);

    render(<Scanner onScanComplete={onScanComplete} />);

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(onScanComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '123',
          title: 'stream.bin',
          fileData: expect.any(Blob),
        })
      );
    });

    expect(queueScanCompleteMock).not.toHaveBeenCalled();
    expect(saveScanSessionChunkMock).toHaveBeenCalledWith('123', 0, chunkData);
    expect(loadScanSessionChunksMock).toHaveBeenCalledWith('123');
    expect(deleteIncompleteScanMock).toHaveBeenCalledWith('123');
    expect(deleteScanSessionChunksMock).toHaveBeenCalledWith('123');
  });

  it('queues decoded server-authoritative chunk frames for upload without persisting local chunks', async () => {
    const chunkData = new Uint8Array([1, 2, 3, 4]);
    const packet = createStreamingPacket(123, 0, 2);

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'chunk_completed',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 0,
      totalChunks: 2,
      chunksCompleted: 1,
      overallPercent: 50,
      chunkData,
      packetsReceivedTotal: 394,
      packetsExpectedChunk: 394,
      packetsTotalChunk: 472,
    });

    saveScanSessionChunkMock.mockResolvedValue(undefined);
    loadScanSessionChunksMock.mockResolvedValue([{ id: 0, data: chunkData }]);

    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="123"
        resumeStats={{ received: 393, total: 788, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({
          sessionId: '123',
          resultType: 'chunk_completed',
          chunkId: 0,
          totalChunks: 2,
          chunksCompleted: 1,
        }),
        expect.any(Object)
      );
    });
    expect(saveScanSessionChunkMock).not.toHaveBeenCalled();
    expect(loadScanSessionChunksMock).not.toHaveBeenCalled();
  });

  it('restores resume packet pages from IndexedDB when store memory is empty', async () => {
    const storedPacket = new Uint8Array(31);
    storedPacket[0] = 1;
    storedPacket.set([0, 0, 0, 200], 1);

    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [storedPacket],
      });
      return { pageCount: 1, packetCount: 1 };
    });

    render(
      <Scanner
        resumeMode
        resumeSessionId="200"
        storedPackets={[]}
        resumeStats={{ received: 4, total: 10, filename: 'resume.bin' }}
      />
    );

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        '200',
        expect.any(Function)
      );
    });

    await waitFor(() => {
      expect(decodeStreamingPacketMock).toHaveBeenCalledWith(storedPacket);
    });
  });

  it('starts server-authoritative resume with neutral visible stats until server progress arrives', async () => {
    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="200"
        storedPackets={[]}
        resumeStats={{ received: 8308, total: 11192, filename: 'resume.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('0');
    expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('0');
    expect(screen.getByTestId('scanner-stat-max')).toHaveTextContent('-');
    expect(screen.queryByTestId('scanner-session-progress')).not.toBeInTheDocument();
  });

  it('retries a queued server-authoritative packet after server progress provides context', async () => {
    const packet = createStreamingPacket(123, 1, 3);

    decodeStreamingPacketMock
      .mockImplementationOnce(() => {
        throw new Error('missing chunk context for resumed server session');
      })
      .mockReturnValueOnce({
        type: 'progress',
        sessionId: 123,
        filename: 'stream.bin',
        chunkId: 1,
        totalChunks: 3,
        expectedPackets: 1182,
        totalPackets: 472,
        totalPacketsExact: true,
        overallPercent: 50,
        packetsReceivedTotal: 401,
        packetsExpectedChunk: 394,
        packetsTotalChunk: 472,
      });

    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="123"
        resumeStats={{ received: 400, total: 1182, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 401,
          expectedPackets: 1182,
          totalPackets: 1416,
          totalPacketsExact: true,
          deviceName: 'Other phone',
        },
      });
    });

    await waitFor(() => {
      expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(2);
    });
    expect(decodeStreamingPacketMock).toHaveBeenLastCalledWith(packet);
    expect(queueScanPacketMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: '123',
        resultType: 'progress',
      }),
      expect.any(Object)
    );
  });

  it('still syncs server-authoritative streaming packets when local decode reports a duplicate error', async () => {
    const packet = createStreamingPacket(123, 12, 13);

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'error',
      message: 'duplicate packet',
    });

    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="123"
        resumeStats={{ received: 11548, total: 10473, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    expect(queueScanPacketMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: '123',
        resultType: 'server_authoritative_decode_error',
        packetIndex: 4,
        chunkId: 12,
        isStreaming: true,
      }),
      expect.any(Object)
    );
  });

  it.each([
    'Internal decoder state missing for chunk abc',
    'Missing chunk abc',
  ])('retries a real core missing-context error: %s', async (message) => {
    const packet = createStreamingPacket(123, 1, 3);

    decodeStreamingPacketMock
      .mockImplementationOnce(() => {
        throw new Error(message);
      })
      .mockReturnValueOnce({
        type: 'progress',
        sessionId: 123,
        filename: 'stream.bin',
        chunkId: 1,
        totalChunks: 3,
        expectedPackets: 1182,
        totalPackets: 472,
        totalPacketsExact: true,
        overallPercent: 50,
        packetsReceivedTotal: 401,
        packetsExpectedChunk: 394,
        packetsTotalChunk: 472,
      });

    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="123"
        resumeStats={{ received: 400, total: 1182, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 401,
          expectedPackets: 1182,
          totalPackets: 1416,
          totalPacketsExact: true,
          deviceName: 'Other phone',
        },
      });
    });

    await waitFor(() => {
      expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(2);
    });
    expect(decodeStreamingPacketMock).toHaveBeenLastCalledWith(packet);
    expect(queueScanPacketMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: '123',
        resultType: 'progress',
      }),
      expect.any(Object)
    );
  });

  it('does not queue corrupt server-authoritative packets with generic chunk or state errors', async () => {
    const packet = createStreamingPacket(123, 1, 3);

    decodeStreamingPacketMock.mockImplementationOnce(() => {
      throw new Error('invalid chunk state: incomplete packet not found');
    });

    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="123"
        resumeStats={{ received: 400, total: 1182, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(1);
    expect(queueScanPacketMock).not.toHaveBeenCalled();

    await act(async () => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 401,
          expectedPackets: 1182,
          totalPackets: 1416,
          totalPacketsExact: true,
          deviceName: 'Other phone',
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(1);
  });

  it('retries a queued server-authoritative packet after a later local decode provides context', async () => {
    const queuedPacket = createStreamingPacket(123, 1, 3);
    const contextPacket = createStreamingPacket(123, 0, 3);

    decodeStreamingPacketMock
      .mockImplementationOnce(() => {
        throw new Error('missing chunk context for resumed server session');
      })
      .mockReturnValueOnce({
        type: 'progress',
        sessionId: 123,
        filename: 'stream.bin',
        chunkId: 0,
        totalChunks: 3,
        expectedPackets: 1182,
        totalPackets: 394,
        totalPacketsExact: true,
        overallPercent: 34,
        packetsReceivedTotal: 394,
        packetsExpectedChunk: 394,
        packetsTotalChunk: 394,
      })
      .mockReturnValueOnce({
        type: 'progress',
        sessionId: 123,
        filename: 'stream.bin',
        chunkId: 1,
        totalChunks: 3,
        expectedPackets: 1182,
        totalPackets: 472,
        totalPacketsExact: true,
        overallPercent: 50,
        packetsReceivedTotal: 401,
        packetsExpectedChunk: 394,
        packetsTotalChunk: 472,
      });

    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="123"
        resumeStats={{ received: 400, total: 1182, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: queuedPacket.buffer,
        },
      });
    });

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: contextPacket.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(3);
    });
    expect(decodeStreamingPacketMock).toHaveBeenNthCalledWith(2, contextPacket);
    expect(decodeStreamingPacketMock).toHaveBeenNthCalledWith(3, queuedPacket);
  });

  it('deduplicates repeated server-authoritative packets while waiting for retry context', async () => {
    const packet = createStreamingPacket(123, 1, 3);

    decodeStreamingPacketMock
      .mockImplementationOnce(() => {
        throw new Error('missing chunk context for resumed server session');
      })
      .mockImplementationOnce(() => {
        throw new Error('missing chunk context for resumed server session');
      })
      .mockReturnValueOnce({
        type: 'progress',
        sessionId: 123,
        filename: 'stream.bin',
        chunkId: 1,
        totalChunks: 3,
        expectedPackets: 1182,
        totalPackets: 472,
        totalPacketsExact: true,
        overallPercent: 50,
        packetsReceivedTotal: 401,
        packetsExpectedChunk: 394,
        packetsTotalChunk: 472,
      });

    render(
      <Scanner
        resumeMode
        resumeAuthority="server"
        resumeSessionId="123"
        resumeStats={{ received: 400, total: 1182, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 401,
          expectedPackets: 1182,
          totalPackets: 1416,
          totalPacketsExact: true,
          deviceName: 'Other phone',
        },
      });
    });

    await waitFor(() => {
      expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(3);
    });
  });

  it('does not retry locally unapplicable packets in local-cache resume mode', async () => {
    const packet = createStreamingPacket(123, 1, 3);

    decodeStreamingPacketMock.mockImplementationOnce(() => {
      throw new Error('missing chunk context for resumed server session');
    });

    render(
      <Scanner
        resumeMode
        resumeAuthority="local-cache"
        resumeSessionId="123"
        resumeStats={{ received: 400, total: 1182, filename: 'stream.bin' }}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 401,
          expectedPackets: 1182,
          totalPackets: 1416,
          totalPacketsExact: true,
          deviceName: 'Other phone',
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(1);
  });

  it('queues scan packets even if the auth hook is still warming up', async () => {
    const packet = new Uint8Array(35);
    packet[0] = 2;
    packet.set([0, 0, 0, 123], 1);
    packet.set([0, 0, 0, 0], 5);
    packet.set([0, 0, 0, 1], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);
    packet.set([0, 0, 0, 4], 31);

    serverAuthStateRef.current = {
      authEnabled: true,
      authorized: false,
      username: null,
      checking: true,
      connectionError: false,
      authReady: false,
    };

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'progress',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 0,
      totalChunks: 1,
      overallPercent: 50,
      packetsReceivedTotal: 1,
      packetsExpectedChunk: 1,
      packetsTotalChunk: 1,
    });

    render(<Scanner />);

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({
          sessionId: '123',
          isStreaming: true,
          packetIndex: 4,
        }),
        expect.any(Object)
      );
    });
  });

  it('shows the current chunk indicator during streaming scan progress', async () => {
    const packet = new Uint8Array(35);
    packet[0] = 2;
    packet.set([0, 0, 0, 123], 1);
    packet.set([0, 0, 0, 1], 5);
    packet.set([0, 0, 0, 3], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);
    packet.set([0, 0, 0, 4], 31);

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'progress',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 1,
      totalChunks: 3,
      overallPercent: 50,
      packetsReceivedTotal: 1,
      packetsExpectedChunk: 1,
      packetsTotalChunk: 1,
    });

    render(<Scanner />);

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('scanner-current-chunk')).toHaveTextContent('Chunk 2/3');
    });
  });

  it('keeps the local scanner counter stable when server session progress from another device arrives', async () => {
    const packet = new Uint8Array(35);
    packet[0] = 2;
    packet.set([0, 0, 0, 123], 1);
    packet.set([0, 0, 0, 1], 5);
    packet.set([0, 0, 0, 3], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);
    packet.set([0, 0, 0, 4], 31);

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'progress',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 1,
      totalChunks: 3,
      expectedPackets: 1182,
      totalPackets: 472,
      totalPacketsExact: true,
      overallPercent: 1,
      packetsReceivedTotal: 1,
      packetsExpectedChunk: 394,
      packetsTotalChunk: 472,
    });

    render(<Scanner />);

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('1');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('1182');
    });

    await act(async () => {
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 500,
          expectedPackets: 1182,
          totalPackets: 1416,
          totalPacketsExact: true,
          deviceName: 'Other phone',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('500');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('1182');
      expect(screen.getByTestId('scanner-stat-max')).toHaveTextContent('1416');
      expect(screen.getByTestId('scanner-session-progress')).toHaveTextContent(
        'Session 500/1182'
      );
      expect(screen.getByTestId('scanner-local-progress-summary')).toHaveTextContent(
        'Chunk'
      );
      expect(screen.getByTestId('scanner-local-progress-summary')).toHaveTextContent(
        '2/3'
      );
    });
  });

  it('resets in one click without reviving the previous session from a stale server event', async () => {
    const onScanProgress = vi.fn();
    const { rerender } = render(
      <Scanner
        resumeMode
        resumeSessionId="123"
        resumeStats={{
          received: 10,
          total: 394,
          filename: 'stream.bin',
        }}
        onScanProgress={onScanProgress}
      />
    );

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
      expect(websocketEventHandlerRef.current).toBeTypeOf('function');
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('10');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('394');
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Reset Scanner'));
      websocketEventHandlerRef.current?.({
        type: 'scan-progress',
        payload: {
          sessionId: '123',
          receivedCount: 500,
          expectedPackets: 1182,
          totalPacketsExact: false,
          deviceName: 'Other phone',
        },
      });
      rerender(<Scanner onScanProgress={onScanProgress} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('0');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('0');
      expect(screen.queryByTestId('scanner-session-progress')).not.toBeInTheDocument();
    });
  });

  it('resets in one click without decoding a stale worker scan result', async () => {
    const packet = new Uint8Array(35);
    packet[0] = 2;
    packet.set([0, 0, 0, 123], 1);
    packet.set([0, 0, 0, 0], 5);
    packet.set([0, 0, 0, 1], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);
    packet.set([0, 0, 0, 4], 31);

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'progress',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 0,
      totalChunks: 1,
      overallPercent: 50,
      packetsReceivedTotal: 1,
      packetsExpectedChunk: 1,
      packetsTotalChunk: 1,
    });

    render(<Scanner />);

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Reset Scanner'));
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    expect(decodeStreamingPacketMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('0');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('0');
    });
  });

  it('resets in one click without restarting the same visible session', async () => {
    const packet = new Uint8Array(35);
    packet[0] = 2;
    packet.set([0, 0, 0, 123], 1);
    packet.set([0, 0, 0, 0], 5);
    packet.set([0, 0, 0, 1], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);
    packet.set([0, 0, 0, 4], 31);

    decodeStreamingPacketMock.mockReturnValue({
      type: 'progress',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 0,
      totalChunks: 1,
      overallPercent: 50,
      packetsReceivedTotal: 1,
      packetsExpectedChunk: 1,
      packetsTotalChunk: 1,
    });

    render(<Scanner />);

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('1');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('1');
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Reset Scanner'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('0');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('0');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          requestId: 1,
          binaryData: packet.buffer,
        },
      });
    });

    expect(decodeStreamingPacketMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('scanner-stat-scanned')).toHaveTextContent('0');
      expect(screen.getByTestId('scanner-stat-min')).toHaveTextContent('0');
    });
  });

  it('hides the current chunk indicator for single-chunk scans', async () => {
    const packet = new Uint8Array(35);
    packet[0] = 2;
    packet.set([0, 0, 0, 123], 1);
    packet.set([0, 0, 0, 0], 5);
    packet.set([0, 0, 0, 1], 9);
    packet.set([0, 0, 0, 64], 21);
    packet.set([0, 16], 25);
    packet.set([0, 0, 0, 7], 27);
    packet.set([0, 0, 0, 4], 31);

    decodeStreamingPacketMock.mockReturnValueOnce({
      type: 'progress',
      sessionId: 123,
      filename: 'stream.bin',
      chunkId: 0,
      totalChunks: 1,
      overallPercent: 50,
      packetsReceivedTotal: 1,
      packetsExpectedChunk: 1,
      packetsTotalChunk: 1,
    });

    render(<Scanner />);

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf('function');
    });

    await act(async () => {
      workerRef.current?.onmessage?.({
        data: {
          found: true,
          binaryData: packet.buffer,
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('scanner-current-chunk')).not.toBeInTheDocument();
    });
  });

  it('does not initialize BarcodeDetector for AirQR binary QR payloads on Android', async () => {
    const barcodeDetectorCtor = vi.fn();

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 16; 2410CRP4CG) AppleWebKit/537.36 Chrome/135.0 Mobile Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(window, 'BarcodeDetector', {
      value: barcodeDetectorCtor,
      configurable: true,
      writable: true,
    });

    render(<Scanner />);

    await waitFor(() => {
      expect(workerRef.current).not.toBeNull();
    });

    expect(barcodeDetectorCtor).not.toHaveBeenCalled();
  });

});
