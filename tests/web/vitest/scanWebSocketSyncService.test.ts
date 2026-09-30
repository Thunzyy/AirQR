import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@web/utils/deviceId', () => ({
  getDeviceInfo: () => ({
    deviceId: 'device-1',
    deviceName: 'Test Device',
  }),
}));

const scanSessionDBMocks = vi.hoisted(() => ({
  clearPendingScanPacketOutboxSession: vi.fn(),
  deletePendingScanPacketOutboxRecord: vi.fn(),
  loadPendingScanPacketOutboxRecords: vi.fn(),
  prunePendingScanPacketOutboxRecords: vi.fn(),
  savePendingScanPacketOutboxRecord: vi.fn(),
}));

vi.mock('@web/services/scanSessionDB', () => scanSessionDBMocks);

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  public readyState = MockWebSocket.CONNECTING;
  public binaryType = 'blob';
  public bufferedAmount = 0;
  public onopen: ((event?: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event?: unknown) => void) | null = null;
  public onclose: ((event?: unknown) => void) | null = null;
  public readonly sent: Array<string | ArrayBuffer> = [];
  public autoCloseAfterBinaryFrames: number | null = null;
  private binaryFramesSent = 0;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sent.push(data);
    if (data instanceof ArrayBuffer) {
      this.binaryFramesSent += 1;
      if (
        this.autoCloseAfterBinaryFrames !== null &&
        this.binaryFramesSent >= this.autoCloseAfterBinaryFrames
      ) {
        this.autoCloseAfterBinaryFrames = null;
        this.triggerClose();
      }
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }

  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  triggerJsonMessage(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  triggerClose(event: { code?: number; reason?: string; wasClean?: boolean } = {}): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({
      code: event.code ?? 1000,
      reason: event.reason ?? '',
      wasClean: event.wasClean ?? true,
    });
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances.at(-1);
  }
}

function parseBinaryFrame(frame: ArrayBuffer): { packetIndex: number; chunkId: number; flags: number } {
  const view = new DataView(frame);
  return {
    flags: view.getUint8(1),
    chunkId: view.getUint16(2, false),
    packetIndex: view.getUint32(4, false),
  };
}

function parseJsonMessages(socket: MockWebSocket): Array<Record<string, unknown>> {
  return socket.sent
    .filter((message): message is string => typeof message === 'string')
    .map((message) => JSON.parse(message) as Record<string, unknown>);
}

function getBinaryFrames(socket: MockWebSocket): ArrayBuffer[] {
  return socket.sent.filter(
    (message): message is ArrayBuffer => message instanceof ArrayBuffer
  );
}

async function acknowledgeBinaryFrames(
  socket: MockWebSocket,
  count: number,
  options: {
    receivedCountStart?: number;
    startFrameIndex?: number;
    windowSize?: number;
  } = {}
): Promise<void> {
  const receivedCountStart = options.receivedCountStart ?? 0;
  const windowSize = options.windowSize ?? 32;
  let frameIndex = options.startFrameIndex ?? 0;

  for (let acknowledged = 0; acknowledged < count; acknowledged += 1) {
    const frames = getBinaryFrames(socket);
    expect(frames.length).toBeGreaterThan(frameIndex);
    const frame = parseBinaryFrame(frames[frameIndex]);
    socket.triggerJsonMessage({
      type: 'packetAck',
      receivedCount: receivedCountStart + acknowledged + 1,
      windowSize,
      acked: {
        chunkId: frame.chunkId,
        packetIndex: frame.packetIndex,
      },
    });
    frameIndex += 1;
    await vi.advanceTimersByTimeAsync(0);
  }
}

function triggerReadyScanSocket(
  socket: MockWebSocket,
  options: {
    lastContiguous?: number;
    receivedCount?: number;
    totalExpected?: number;
    windowSize?: number;
    packetAck?: boolean;
  } = {}
): void {
  socket.triggerOpen();
  socket.triggerJsonMessage({
    type: 'welcome',
    windowSize: options.windowSize,
    packetAck: options.packetAck ?? true,
  });
  socket.triggerJsonMessage({ type: 'producerClaimed' });
  socket.triggerJsonMessage({ type: 'metaAck' });
  socket.triggerJsonMessage({
    type: 'resumeState',
    lastContiguous: options.lastContiguous ?? -1,
    missing: [],
    receivedCount: options.receivedCount ?? 0,
    totalExpected: options.totalExpected ?? 1,
  });
}

describe('scanWebSocketSyncService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    MockWebSocket.reset();
    scanSessionDBMocks.clearPendingScanPacketOutboxSession.mockReset().mockResolvedValue(undefined);
    scanSessionDBMocks.deletePendingScanPacketOutboxRecord.mockReset().mockResolvedValue(undefined);
    scanSessionDBMocks.loadPendingScanPacketOutboxRecords.mockReset().mockResolvedValue([]);
    scanSessionDBMocks.prunePendingScanPacketOutboxRecords.mockReset().mockResolvedValue(undefined);
    scanSessionDBMocks.savePendingScanPacketOutboxRecord.mockReset().mockReturnValue(undefined);
    (globalThis as any).WebSocket = MockWebSocket as any;
  });

  afterEach(async () => {
    const { resetScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    resetScanWebSocketSyncService();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replays buffered packets through resume checkpoints before sending complete', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };
    const onSuccess = vi.fn();

    expect(
      service.queuePacket(new Uint8Array([1, 2, 3]), {
        sessionId: 'scan-1',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'progress',
      }, config)
    ).toBe(true);
    service.queuePacket(
      new Uint8Array([4, 5, 6]),
      {
        sessionId: 'scan-1',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 1,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const ws = MockWebSocket.getLastInstance()!;
    const firstConnectionUrl = new URL(ws.url);
    expect(`${firstConnectionUrl.origin}${firstConnectionUrl.pathname}`).toBe(
      'wss://sync.example.com/api/v1/ws/scan/scan-1'
    );
    expect(firstConnectionUrl.searchParams.get('deviceId')).toBe('device-1');
    expect(firstConnectionUrl.searchParams.get('connectionId')).toBeTruthy();

    ws.triggerOpen();
    expect(parseJsonMessages(ws)[0]).toMatchObject({
      type: 'hello',
      protocol: 'airqr-scan',
      clientId: 'device-1',
    });

    ws.triggerJsonMessage({ type: 'welcome', packetAck: true });
    expect(parseJsonMessages(ws).at(-1)).toMatchObject({ type: 'claimProducer' });

    ws.triggerJsonMessage({ type: 'producerClaimed' });
    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'meta',
      filename: 'archive.bin',
      totalPackets: 2,
      totalChunks: 1,
      packetSize: 3,
    });

    ws.triggerJsonMessage({ type: 'metaAck' });
    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'resume',
      fromPacketIndex: 0,
    });

    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 2,
    });

    const sentFrames = ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer);
    expect(sentFrames).toHaveLength(2);
    expect(parseBinaryFrame(sentFrames[0])).toMatchObject({ packetIndex: 0, chunkId: 0, flags: 0 });
    expect(parseBinaryFrame(sentFrames[1])).toMatchObject({ packetIndex: 1, chunkId: 0, flags: 1 });
    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'resume',
      fromPacketIndex: 0,
    });

    service.queueComplete(
      {
        sessionId: 'scan-1',
        filename: 'archive.bin',
        fileSize: 6,
      },
      config,
      onSuccess,
    );

    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 1,
      missing: [],
      receivedCount: 2,
      totalExpected: 2,
    });
    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'complete',
      filename: 'archive.bin',
    });

    ws.triggerJsonMessage({
      type: 'completed',
      success: true,
      filename: 'archive.bin',
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('persists a packet to the durable outbox before sending its binary frame', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    let resolveOutboxWrite: (() => void) | undefined;
    scanSessionDBMocks.savePendingScanPacketOutboxRecord.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveOutboxWrite = resolve;
      })
    );
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-outbox',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 1,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const ws = MockWebSocket.getLastInstance()!;
    triggerReadyScanSocket(ws, { totalExpected: 1, windowSize: 32 });

    expect(scanSessionDBMocks.savePendingScanPacketOutboxRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'scan-outbox',
        chunkId: 0,
        packetIndex: 0,
        packet: new Uint8Array([1, 2, 3]),
        filename: 'archive.bin',
        totalPackets: 1,
        totalChunks: 1,
        resultType: 'chunk_completed',
      })
    );
    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(0);

    resolveOutboxWrite?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(1);

    ws.triggerJsonMessage({
      type: 'packetAck',
      receivedCount: 1,
      windowSize: 32,
      acked: { chunkId: 0, packetIndex: 0 },
    });
    await Promise.resolve();

    expect(scanSessionDBMocks.deletePendingScanPacketOutboxRecord).toHaveBeenCalledWith(
      'scan-outbox',
      0,
      0
    );
  });

  it('does not send more binary frames than the acknowledged server window', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 3; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1]),
        {
          sessionId: 'scan-window',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 3,
          totalChunks: 1,
          resultType: packetIndex === 2 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    triggerReadyScanSocket(ws, { totalExpected: 3, windowSize: 2 });

    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(2);

    ws.triggerJsonMessage({
      type: 'packetAck',
      receivedCount: 1,
      windowSize: 2,
      acked: { chunkId: 0, packetIndex: 0 },
    });
    await vi.advanceTimersByTimeAsync(0);

    const sentFrames = ws.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(sentFrames).toHaveLength(3);
    expect(parseBinaryFrame(sentFrames[2])).toMatchObject({ chunkId: 0, packetIndex: 2 });
  });

  it('falls back to legacy flushing when the server does not advertise packet acknowledgements', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 64; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1]),
        {
          sessionId: 'scan-legacy-server',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 64,
          totalChunks: 1,
          resultType: packetIndex === 63 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    triggerReadyScanSocket(ws, {
      totalExpected: 64,
      windowSize: 32,
      packetAck: false,
    });
    await vi.advanceTimersByTimeAsync(0);

    const sentFrames = getBinaryFrames(ws);
    expect(sentFrames).toHaveLength(64);
    expect(parseBinaryFrame(sentFrames[0])).toMatchObject({ packetIndex: 0 });
    expect(parseBinaryFrame(sentFrames.at(-1)!)).toMatchObject({ packetIndex: 63 });
  });

  it('reconnects when websocket backpressure remains stuck with queued packets', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 40; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1]),
        {
          sessionId: 'scan-stuck-backpressure',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 40,
          totalChunks: 1,
          resultType: packetIndex === 39 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.bufferedAmount = 262_524;
    triggerReadyScanSocket(ws1, {
      totalExpected: 40,
      windowSize: 32,
      packetAck: false,
    });

    expect(getBinaryFrames(ws1)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3000);

    expect(ws1.readyState).toBe(MockWebSocket.CLOSED);

    await vi.advanceTimersByTimeAsync(500);

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);
    expect(ws2.url).toContain('/api/v1/ws/scan/scan-stuck-backpressure');
  });

  it('checkpoints legacy websocket replay before flooding a long backlog', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 96; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1]),
        {
          sessionId: 'scan-legacy-backlog',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 96,
          totalChunks: 1,
          resultType: packetIndex === 95 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    triggerReadyScanSocket(ws, {
      totalExpected: 96,
      windowSize: 32,
      packetAck: false,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(getBinaryFrames(ws)).toHaveLength(64);
    expect(
      parseJsonMessages(ws).filter((message) => message.type === 'resume')
    ).toHaveLength(2);

    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 63,
      missing: [],
      receivedCount: 64,
      totalExpected: 96,
    });
    await vi.advanceTimersByTimeAsync(0);

    const sentFrames = getBinaryFrames(ws);
    expect(sentFrames).toHaveLength(96);
    expect(parseBinaryFrame(sentFrames.at(-1)!)).toMatchObject({
      packetIndex: 95,
      flags: 1,
    });
  });

  it('reconnects and replays packets after an interrupted scan websocket session', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-2',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'progress',
      },
      config
    );
    service.queuePacket(
      new Uint8Array([4, 5, 6]),
      {
        sessionId: 'scan-2',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 1,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 2,
    });

    expect(
      ws1.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(2);

    ws1.triggerClose();
    await vi.advanceTimersByTimeAsync(500);

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);
    ws2.triggerOpen();
    ws2.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws2.triggerJsonMessage({ type: 'producerClaimed' });
    ws2.triggerJsonMessage({ type: 'metaAck' });
    ws2.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 0,
      missing: [],
      receivedCount: 1,
      totalExpected: 2,
    });

    const resentFrames = ws2.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer);
    expect(resentFrames).toHaveLength(1);
    expect(parseBinaryFrame(resentFrames[0])).toMatchObject({ packetIndex: 1 });
  });

  it('buffers same packetIndex values independently when they belong to different chunks', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-multichunk',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 158,
        totalChunks: 6,
        resultType: 'progress',
      },
      config
    );
    service.queuePacket(
      new Uint8Array([4, 5, 6]),
      {
        sessionId: 'scan-multichunk',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 1,
        totalPackets: 158,
        totalChunks: 6,
        resultType: 'progress',
      },
      config
    );

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 772,
    });

    const sentFrames = ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer);
    expect(sentFrames).toHaveLength(2);
    expect(parseBinaryFrame(sentFrames[0])).toMatchObject({ packetIndex: 0, chunkId: 0 });
    expect(parseBinaryFrame(sentFrames[1])).toMatchObject({ packetIndex: 0, chunkId: 1 });
  });

  it('replays only missing and unsent packet tails when chunk-aware resume state has early gaps', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (const [chunkId, packetIndexes] of [
      [0, [0, 1, 2, 3]],
      [1, [0, 1, 2, 3]],
    ] as const) {
      for (const packetIndex of packetIndexes) {
        service.queuePacket(
          new Uint8Array([chunkId, packetIndex, packetIndex + 1]),
          {
            sessionId: 'scan-gap-replay',
            filename: 'archive.bin',
            isStreaming: true,
            packetIndex,
            chunkId,
            totalPackets: 8,
            totalChunks: 2,
            resultType: 'progress',
          },
          config
        );
      }
    }

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      chunkStates: [],
      receivedCount: 0,
      totalExpected: 8,
    });

    expect(
      ws1.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(8);

    ws1.triggerClose({ code: 1006, reason: 'network reset', wasClean: false });
    await vi.advanceTimersByTimeAsync(500);

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);
    ws2.triggerOpen();
    ws2.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws2.triggerJsonMessage({ type: 'producerClaimed' });
    ws2.triggerJsonMessage({ type: 'metaAck' });
    ws2.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 0,
      missing: [[1, 1]],
      chunkStates: [
        {
          chunkId: 0,
          lastContiguous: 0,
          missing: [[1, 1]],
          receivedCount: 3,
        },
        {
          chunkId: 1,
          lastContiguous: 1,
          missing: [],
          receivedCount: 2,
        },
      ],
      receivedCount: 5,
      totalExpected: 8,
    });
    await vi.advanceTimersByTimeAsync(0);

    const resentFrames = ws2.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(
      resentFrames.map((frame) => {
        const parsed = parseBinaryFrame(frame);
        return `${parsed.chunkId}:${parsed.packetIndex}`;
      })
    ).toEqual(['0:1', '1:2', '1:3']);
  });

  it('drops replay packets for chunks that already reached their target frame count', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (const [chunkId, packetIndexes] of [
      [0, [0, 1, 2, 3]],
      [1, [0, 1, 2, 3]],
    ] as const) {
      for (const packetIndex of packetIndexes) {
        service.queuePacket(
          new Uint8Array([chunkId, packetIndex, packetIndex + 1]),
          {
            sessionId: 'scan-prune-satisfied-chunks',
            filename: 'archive.bin',
            isStreaming: true,
            packetIndex,
            chunkId,
            totalPackets: 8,
            totalChunks: 2,
            resultType: 'progress',
          },
          config
        );
      }
    }

    const ws1 = MockWebSocket.getLastInstance()!;
    triggerReadyScanSocket(ws1, {
      totalExpected: 8,
      windowSize: 32,
      packetAck: true,
    });

    expect(getBinaryFrames(ws1)).toHaveLength(8);

    ws1.triggerClose({ code: 1006, reason: 'network reset', wasClean: false });
    await vi.advanceTimersByTimeAsync(500);

    const ws2 = MockWebSocket.getLastInstance()!;
    ws2.triggerOpen();
    ws2.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws2.triggerJsonMessage({ type: 'producerClaimed' });
    ws2.triggerJsonMessage({ type: 'metaAck' });
    ws2.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 5,
      totalExpected: 8,
      chunkStates: [
        {
          chunkId: 0,
          lastContiguous: 0,
          missing: [[1, 1]],
          receivedCount: 3,
          targetFrameCount: 0,
        },
        {
          chunkId: 1,
          lastContiguous: 1,
          missing: [],
          receivedCount: 2,
          targetFrameCount: 2,
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      getBinaryFrames(ws2).map((frame) => {
        const parsed = parseBinaryFrame(frame);
        return `${parsed.chunkId}:${parsed.packetIndex}`;
      })
    ).toEqual(['1:2', '1:3']);
  });

  it('keeps sending packets even if a producerRevoked message is received unexpectedly', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-handoff',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'progress',
      },
      config
    );

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 2,
    });

    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(1);

    ws.triggerJsonMessage({
      type: 'producerRevoked',
      sessionId: 'scan-handoff',
      replacedByDeviceId: 'device-2',
    });

    service.queuePacket(
      new Uint8Array([4, 5, 6]),
      {
        sessionId: 'scan-handoff',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 1,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(2);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('retries buffered packets after a fatal scan websocket error instead of dropping the session', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-fatal-retry',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 1,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    expect(parseJsonMessages(ws1)[0]).toMatchObject({
      type: 'hello',
      protocol: 'airqr-scan',
    });

    ws1.triggerJsonMessage({
      type: 'error',
      fatal: true,
      message: 'Authentication required',
    });

    await vi.advanceTimersByTimeAsync(500);

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);
    ws2.triggerOpen();
    expect(parseJsonMessages(ws2)[0]).toMatchObject({
      type: 'hello',
      protocol: 'airqr-scan',
    });

    ws2.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws2.triggerJsonMessage({ type: 'producerClaimed' });
    expect(parseJsonMessages(ws2).at(-1)).toMatchObject({
      type: 'meta',
      filename: 'archive.bin',
      totalPackets: 1,
      totalChunks: 1,
    });

    ws2.triggerJsonMessage({ type: 'metaAck' });
    ws2.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 1,
    });

    const resentFrames = ws2.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(resentFrames).toHaveLength(1);
    expect(parseBinaryFrame(resentFrames[0])).toMatchObject({
      packetIndex: 0,
      chunkId: 0,
      flags: 1,
    });
  });

  it('does not reopen a websocket for every queued packet after fatal reconnect attempts are exhausted', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-fatal-limit',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'progress',
      },
      config
    );

    let socket = MockWebSocket.getLastInstance()!;
    for (const delay of [500, 1000, 2000, 4000, 8000]) {
      socket.triggerOpen();
      socket.triggerJsonMessage({
        type: 'error',
        fatal: true,
        message: 'Too many attempts. Try again later.',
      });
      await vi.advanceTimersByTimeAsync(delay);
      socket = MockWebSocket.getLastInstance()!;
    }

    const socketsBeforeLimit = MockWebSocket.instances.length;
    socket.triggerOpen();
    socket.triggerJsonMessage({
      type: 'error',
      fatal: true,
      message: 'Too many attempts. Try again later.',
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(MockWebSocket.instances).toHaveLength(socketsBeforeLimit);

    service.queuePacket(
      new Uint8Array([4, 5, 6]),
      {
        sessionId: 'scan-fatal-limit',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 1,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    expect(MockWebSocket.instances).toHaveLength(socketsBeforeLimit);
  });

  it('refreshes the scan websocket config on an existing session before reconnecting', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const initialConfig = {
      enabled: true,
      url: 'https://sync-a.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };
    const updatedConfig = {
      ...initialConfig,
      url: 'https://sync-b.example.com',
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-config-refresh',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'progress',
      },
      initialConfig
    );

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerClose();

    service.queuePacket(
      new Uint8Array([4, 5, 6]),
      {
        sessionId: 'scan-config-refresh',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 1,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      updatedConfig
    );

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);
    const refreshedConnectionUrl = new URL(ws2.url);
    expect(
      `${refreshedConnectionUrl.origin}${refreshedConnectionUrl.pathname}`
    ).toBe('wss://sync-b.example.com/api/v1/ws/scan/scan-config-refresh');
    expect(refreshedConnectionUrl.searchParams.get('deviceId')).toBe('device-1');
    expect(refreshedConnectionUrl.searchParams.get('connectionId')).toBeTruthy();
  });

  it('sends long sessions in 64-packet batches before requesting a resume checkpoint', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 64; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-3',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 64,
          totalChunks: 1,
          resultType: 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 64,
    });
    await vi.advanceTimersByTimeAsync(0);
    await acknowledgeBinaryFrames(ws, 64);

    const sentFrames = ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer);
    expect(sentFrames).toHaveLength(64);
    expect(parseBinaryFrame(sentFrames[0])).toMatchObject({ packetIndex: 0 });
    expect(parseBinaryFrame(sentFrames.at(-1)!)).toMatchObject({ packetIndex: 63 });
    expect(
      parseJsonMessages(ws).filter((message) => message.type === 'resume')
    ).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(250);

    expect(
      parseJsonMessages(ws).filter((message) => message.type === 'resume')
    ).toHaveLength(2);
  });

  it('reconnects when a final complete checkpoint stalls after queued packets drain', async () => {
    const {
      getScanWebSocketSyncService,
      getScanWebSocketSyncDebugSnapshot,
    } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 15; packetIndex < 79; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-stalled-checkpoint',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 1393,
          totalChunks: 3,
          resultType: 'progress',
        },
        config
      );
    }

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 14,
      missing: [],
      receivedCount: 15,
      totalExpected: 1162,
    });
    await vi.advanceTimersByTimeAsync(0);
    await acknowledgeBinaryFrames(ws1, 64, { receivedCountStart: 15 });

    const sentFrames = ws1.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(sentFrames).toHaveLength(64);
    expect(parseBinaryFrame(sentFrames[0])).toMatchObject({ packetIndex: 15 });
    expect(parseBinaryFrame(sentFrames.at(-1)!)).toMatchObject({ packetIndex: 78 });
    expect(
      parseJsonMessages(ws1).filter((message) => message.type === 'resume')
    ).toHaveLength(1);

    expect(
      service.queueComplete(
        {
          sessionId: 'scan-stalled-checkpoint',
          filename: 'archive.bin',
          fileSize: 192,
        },
        config
      )
    ).toBe(true);

    expect(parseJsonMessages(ws1).at(-1)).toMatchObject({
      type: 'metaUpdate',
      filename: 'archive.bin',
    });

    ws1.triggerJsonMessage({ type: 'metaUpdateAck' });

    expect(
      parseJsonMessages(ws1).filter((message) => message.type === 'resume')
    ).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(3500);

    expect(ws1.readyState).toBe(MockWebSocket.CLOSED);
    expect(MockWebSocket.instances).toHaveLength(2);

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);

    const debugSnapshot = getScanWebSocketSyncDebugSnapshot(
      'scan-stalled-checkpoint'
    ) as Record<string, unknown>;
    expect(debugSnapshot.resumeTimeouts).toBe(1);
    expect(Array.isArray(debugSnapshot.recentEvents)).toBe(true);
    expect(
      (debugSnapshot.recentEvents as Array<Record<string, unknown>>).some(
        (event) => event.type === 'resume-timeout'
      )
    ).toBe(true);
  });

  it('still allows complete after a checkpoint has purged already-acked packets', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };
    const onSuccess = vi.fn();

    for (let packetIndex = 0; packetIndex < 64; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-4',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 64,
          totalChunks: 1,
          resultType: 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 64,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'resume',
      fromPacketIndex: 0,
    });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 63,
      missing: [],
      receivedCount: 64,
      totalExpected: 64,
    });

    expect(
      service.queueComplete(
        {
          sessionId: 'scan-4',
          filename: 'archive.bin',
          fileSize: 192,
        },
        config,
        onSuccess,
      )
    ).toBe(true);

    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'metaUpdate',
      filename: 'archive.bin',
    });

    ws.triggerJsonMessage({ type: 'metaUpdateAck' });

    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'complete',
      filename: 'archive.bin',
    });

    ws.triggerJsonMessage({
      type: 'completed',
      success: true,
      filename: 'archive.bin',
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('waits for a brief idle gap before checkpointing a live session whose queue just drained', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 64; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-idle-checkpoint',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 64,
          totalChunks: 1,
          resultType: packetIndex === 63 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 64,
    });
    await acknowledgeBinaryFrames(ws, 64);

    await vi.advanceTimersByTimeAsync(249);
    expect(
      parseJsonMessages(ws).filter((message) => message.type === 'resume')
    ).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(
      parseJsonMessages(ws).filter((message) => message.type === 'resume')
    ).toHaveLength(2);
  });

  it('waits for an explicit resume ack before completing after a final partial window', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 33; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-4b',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 33,
          totalChunks: 1,
          resultType: packetIndex === 32 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 33,
    });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 31,
      missing: [],
      receivedCount: 32,
      totalExpected: 33,
    });

    service.queueComplete(
      {
        sessionId: 'scan-4b',
        filename: 'archive.bin',
        fileSize: 99,
      },
      config,
    );

    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'metaUpdate',
      filename: 'archive.bin',
    });

    ws.triggerJsonMessage({ type: 'metaUpdateAck' });
    ws.triggerJsonMessage({
      type: 'packetAck',
      receivedCount: 33,
      windowSize: 32,
      acked: { chunkId: 0, packetIndex: 32 },
    });

    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'resume',
      fromPacketIndex: 0,
    });

    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 32,
      missing: [],
      receivedCount: 33,
      totalExpected: 33,
    });

    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'complete',
      filename: 'archive.bin',
    });
  });

  it('waits for a final resume checkpoint when complete is queued before the initial packet flush is acknowledged', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-4c',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'progress',
      },
      config
    );
    service.queuePacket(
      new Uint8Array([4, 5, 6]),
      {
        sessionId: 'scan-4c',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 1,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    service.queueComplete(
      {
        sessionId: 'scan-4c',
        filename: 'archive.bin',
        fileSize: 6,
      },
      config
    );

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 2,
    });

    const binaryFrames = ws.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(binaryFrames).toHaveLength(2);
    expect(
      parseJsonMessages(ws).filter((message) => message.type === 'resume')
    ).toHaveLength(1);

    await acknowledgeBinaryFrames(ws, 2);

    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'resume',
      fromPacketIndex: 0,
    });

    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 1,
      missing: [],
      receivedCount: 2,
      totalExpected: 2,
    });

    expect(parseJsonMessages(ws).at(-1)).toMatchObject({
      type: 'complete',
      filename: 'archive.bin',
    });
  });

  it('replays later windows across repeated reconnects on a long scan session', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 96; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-5',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 96,
          totalChunks: 1,
          resultType: packetIndex === 95 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 96,
    });
    await vi.advanceTimersByTimeAsync(0);
    await acknowledgeBinaryFrames(ws1, 32);

    expect(
      ws1.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(64);

    ws1.triggerClose();
    await vi.advanceTimersByTimeAsync(500);

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);
    ws2.triggerOpen();
    ws2.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws2.triggerJsonMessage({ type: 'producerClaimed' });
    ws2.triggerJsonMessage({ type: 'metaAck' });
    ws2.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 31,
      missing: [],
      receivedCount: 32,
      totalExpected: 96,
    });
    await vi.advanceTimersByTimeAsync(0);
    await acknowledgeBinaryFrames(ws2, 32, { receivedCountStart: 32 });

    const resentFrames = ws2.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer);
    expect(resentFrames).toHaveLength(64);
    expect(parseBinaryFrame(resentFrames[0])).toMatchObject({ packetIndex: 32 });
    expect(parseBinaryFrame(resentFrames.at(-1)!)).toMatchObject({ packetIndex: 95, flags: 1 });

    ws2.triggerClose();
    await vi.advanceTimersByTimeAsync(500);

    const ws3 = MockWebSocket.getLastInstance()!;
    expect(ws3).not.toBe(ws2);
    ws3.triggerOpen();
    ws3.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws3.triggerJsonMessage({ type: 'producerClaimed' });
    ws3.triggerJsonMessage({ type: 'metaAck' });
    ws3.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: 63,
      missing: [],
      receivedCount: 64,
      totalExpected: 96,
    });
    await vi.advanceTimersByTimeAsync(0);

    const finalWindowFrames = ws3.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(finalWindowFrames).toHaveLength(32);
    expect(parseBinaryFrame(finalWindowFrames[0])).toMatchObject({ packetIndex: 64 });
    expect(parseBinaryFrame(finalWindowFrames.at(-1)!)).toMatchObject({ packetIndex: 95, flags: 1 });
  });

  it('replays unsent packets after repeated mid-window reconnects on a long scan session', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 96; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-6',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 96,
          totalChunks: 1,
          resultType: packetIndex === 95 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.autoCloseAfterBinaryFrames = 20;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 96,
    });

    await vi.advanceTimersByTimeAsync(500);

    const ws2 = MockWebSocket.getLastInstance()!;
    expect(ws2).not.toBe(ws1);
    ws2.autoCloseAfterBinaryFrames = 20;
    ws2.triggerOpen();
    ws2.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws2.triggerJsonMessage({ type: 'producerClaimed' });
    ws2.triggerJsonMessage({ type: 'resumeState', lastContiguous: 19, missing: [], receivedCount: 20, totalExpected: 96 });

    await vi.advanceTimersByTimeAsync(500);

    const ws3 = MockWebSocket.getLastInstance()!;
    expect(ws3).not.toBe(ws2);
    ws3.triggerOpen();
    ws3.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws3.triggerJsonMessage({ type: 'producerClaimed' });
    ws3.triggerJsonMessage({ type: 'resumeState', lastContiguous: 39, missing: [], receivedCount: 40, totalExpected: 96 });
    await vi.advanceTimersByTimeAsync(0);
    await acknowledgeBinaryFrames(ws3, 24, { receivedCountStart: 40 });

    const finalFrames = ws3.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(finalFrames).toHaveLength(56);
    expect(parseBinaryFrame(finalFrames[0])).toMatchObject({ packetIndex: 40 });
    expect(parseBinaryFrame(finalFrames.at(-1)!)).toMatchObject({ packetIndex: 95, flags: 1 });
  });

  it('keeps reconnecting after more than five interrupted closes while scan packets remain buffered', async () => {
    const {
      getScanWebSocketSyncService,
      getScanWebSocketSyncDebugSnapshot,
    } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-reconnect-6',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 1,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const reconnectDelays = [500, 1000, 2000, 4000, 8000, 10000];
    let socket = MockWebSocket.getLastInstance()!;

    for (const delay of reconnectDelays) {
      socket.triggerOpen();
      socket.triggerJsonMessage({ type: 'welcome', packetAck: true });
      socket.triggerJsonMessage({ type: 'producerClaimed' });
      socket.triggerJsonMessage({ type: 'metaAck' });
      socket.triggerJsonMessage({
        type: 'resumeState',
        lastContiguous: -1,
        missing: [],
        receivedCount: 0,
        totalExpected: 1,
      });

      expect(
        socket.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
      ).toHaveLength(1);

      socket.triggerClose();
      await vi.advanceTimersByTimeAsync(delay);
      socket = MockWebSocket.getLastInstance()!;
    }

    expect(MockWebSocket.instances).toHaveLength(7);

    const debugSnapshot = getScanWebSocketSyncDebugSnapshot('scan-reconnect-6');
    expect(debugSnapshot).toMatchObject({
      sessionId: 'scan-reconnect-6',
      reconnectsScheduled: 6,
    });
    expect(
      (debugSnapshot?.recentEvents as Array<Record<string, unknown>>).filter((event) => {
        const details =
          event && typeof event === 'object'
            ? (event.details as Record<string, unknown> | undefined)
            : undefined;
        return (
          event.type === 'socket-close' &&
          details?.reconnect === true &&
          details?.fatalReconnectPending === false
        );
      })
    ).toHaveLength(6);
    expect(
      (debugSnapshot?.recentEvents as Array<Record<string, unknown>>).some((event) => {
        const details =
          event && typeof event === 'object'
            ? (event.details as Record<string, unknown> | undefined)
            : undefined;
        return (
          event.type === 'socket-close' &&
          details?.reconnect === true &&
          details?.fatalReconnectPending === false &&
          details?.reconnectAttempt === 1
        );
      })
    ).toBe(true);
  });

  it('reconnects immediately when the browser comes back online during retry backoff', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-online',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 1,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 1,
    });

    ws1.triggerClose();
    expect(MockWebSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.getLastInstance()).not.toBe(ws1);
  });

  it('reconnects immediately when the tab becomes visible again during retry backoff', async () => {
    const originalVisibilityState = document.visibilityState;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    try {
      const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
      const service = getScanWebSocketSyncService();
      const config = {
        enabled: true,
        url: 'https://sync.example.com',
        apiKey: 'test-key',
        username: '',
        password: '',
        syncScanned: true,
        syncGenerated: true,
        autoSyncHistory: true,
      };

      service.queuePacket(
        new Uint8Array([1, 2, 3]),
        {
          sessionId: 'scan-visible',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex: 0,
          chunkId: 0,
          totalPackets: 1,
          totalChunks: 1,
          resultType: 'chunk_completed',
        },
        config
      );

      const ws1 = MockWebSocket.getLastInstance()!;
      ws1.triggerOpen();
      ws1.triggerJsonMessage({ type: 'welcome', packetAck: true });
      ws1.triggerJsonMessage({ type: 'producerClaimed' });
      ws1.triggerJsonMessage({ type: 'metaAck' });
      ws1.triggerJsonMessage({
        type: 'resumeState',
        lastContiguous: -1,
        missing: [],
        receivedCount: 0,
        totalExpected: 1,
      });

      ws1.triggerClose();
      expect(MockWebSocket.instances).toHaveLength(1);

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(MockWebSocket.instances).toHaveLength(1);

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);

      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.getLastInstance()).not.toBe(ws1);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: originalVisibilityState,
      });
    }
  });

  it('reconnects immediately on pageshow during retry backoff', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-pageshow',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 1,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 1,
    });

    ws1.triggerClose();
    expect(MockWebSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(0);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.getLastInstance()).not.toBe(ws1);
  });

  it('closes an active scan websocket on offline and waits for online before reconnecting', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-offline',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 1,
        totalChunks: 1,
        resultType: 'chunk_completed',
      },
      config
    );

    const ws1 = MockWebSocket.getLastInstance()!;
    ws1.triggerOpen();
    ws1.triggerJsonMessage({ type: 'welcome', packetAck: true });
    ws1.triggerJsonMessage({ type: 'producerClaimed' });
    ws1.triggerJsonMessage({ type: 'metaAck' });
    ws1.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 1,
    });

    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(ws1.readyState).toBe(MockWebSocket.CLOSED);
    expect(MockWebSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.getLastInstance()).not.toBe(ws1);
  });

  it('defers packet flushes while the websocket bufferedAmount stays above the mobile backpressure threshold', async () => {
    const { getScanWebSocketSyncService } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 4; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-backpressure',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 4,
          totalChunks: 1,
          resultType: packetIndex === 3 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.bufferedAmount = 300_000;
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 4,
    });

    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(25);
    expect(
      ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer)
    ).toHaveLength(0);

    ws.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(25);

    const sentFrames = ws.sent.filter((message): message is ArrayBuffer => message instanceof ArrayBuffer);
    expect(sentFrames).toHaveLength(4);
    expect(parseBinaryFrame(sentFrames[0])).toMatchObject({ packetIndex: 0, chunkId: 0 });
    expect(parseBinaryFrame(sentFrames.at(-1)!)).toMatchObject({ packetIndex: 3, chunkId: 0, flags: 1 });
  });

  it('keeps flushing queued packets instead of checkpointing while a backlog remains', async () => {
    const {
      getScanWebSocketSyncService,
      getScanWebSocketSyncDebugSnapshot,
    } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 96; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-backlog-flush',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: 0,
          totalPackets: 96,
          totalChunks: 1,
          resultType: packetIndex === 95 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      receivedCount: 0,
      totalExpected: 96,
    });
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await acknowledgeBinaryFrames(ws, 32);

    const sentFrames = ws.sent.filter(
      (message): message is ArrayBuffer => message instanceof ArrayBuffer
    );
    expect(sentFrames).toHaveLength(64);
    expect(parseBinaryFrame(sentFrames[0])).toMatchObject({ packetIndex: 0 });
    expect(parseBinaryFrame(sentFrames.at(-1)!)).toMatchObject({ packetIndex: 63 });
    expect(
      parseJsonMessages(ws).filter((message) => message.type === 'resume')
    ).toHaveLength(1);

    const debugSnapshot = getScanWebSocketSyncDebugSnapshot(
      'scan-backlog-flush'
    ) as Record<string, unknown>;
    expect(debugSnapshot.checkpointRequests).toBe(0);
  });

  it('exposes a per-session debug snapshot with checkpoints and server acknowledgements', async () => {
    const {
      getScanWebSocketSyncService,
      getScanWebSocketSyncDebugSnapshot,
    } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    for (let packetIndex = 0; packetIndex < 64; packetIndex += 1) {
      service.queuePacket(
        new Uint8Array([packetIndex, packetIndex + 1, packetIndex + 2]),
        {
          sessionId: 'scan-debug',
          filename: 'archive.bin',
          isStreaming: true,
          packetIndex,
          chunkId: packetIndex < 33 ? 0 : 1,
          totalPackets: 80,
          totalChunks: 2,
          resultType: packetIndex === 63 ? 'chunk_completed' : 'progress',
        },
        config
      );
    }

    const ws = MockWebSocket.getLastInstance()!;
    ws.triggerOpen();
    ws.triggerJsonMessage({ type: 'welcome', windowSize: 32, packetAck: true });
    ws.triggerJsonMessage({ type: 'producerClaimed' });
    ws.triggerJsonMessage({ type: 'metaAck' });
    ws.triggerJsonMessage({
      type: 'resumeState',
      lastContiguous: -1,
      missing: [],
      chunkStates: [],
      receivedCount: 0,
      totalExpected: 80,
    });
    await vi.advanceTimersByTimeAsync(0);
    await acknowledgeBinaryFrames(ws, 64);
    await vi.advanceTimersByTimeAsync(250);

    const debugSnapshot = getScanWebSocketSyncDebugSnapshot(
      'scan-debug'
    ) as Record<string, unknown>;

    expect(debugSnapshot.sessionId).toBe('scan-debug');
    expect(debugSnapshot.sentPackets).toBe(64);
    expect(debugSnapshot.resumeRequests).toBe(2);
    expect(debugSnapshot.resumeAcks).toBe(1);
    expect(debugSnapshot.checkpointRequests).toBe(1);
    expect(debugSnapshot.serverReceivedCount).toBe(64);
    expect(Array.isArray(debugSnapshot.recentEvents)).toBe(true);
    expect((debugSnapshot.recentEvents as Array<Record<string, unknown>>).some((event) => event.type === 'resume-checkpoint-requested')).toBe(true);
    expect((globalThis as any).__airqrScanSyncDebug.getSnapshot('scan-debug')).toMatchObject({
      sessionId: 'scan-debug',
      sentPackets: 64,
    });
  });

  it('annotates scan websocket connections with a connectionId and records close metadata in the debug snapshot', async () => {
    const {
      getScanWebSocketSyncService,
      getScanWebSocketSyncDebugSnapshot,
    } = await import('@web/services/scanWebSocketSyncService');
    const service = getScanWebSocketSyncService();
    const config = {
      enabled: true,
      url: 'https://sync.example.com',
      apiKey: 'test-key',
      username: '',
      password: '',
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    service.queuePacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: 'scan-close-debug',
        filename: 'archive.bin',
        isStreaming: true,
        packetIndex: 0,
        chunkId: 0,
        totalPackets: 2,
        totalChunks: 1,
        resultType: 'progress',
      },
      config
    );

    const ws = MockWebSocket.getLastInstance()!;
    const wsUrl = new URL(ws.url);
    expect(wsUrl.searchParams.get('connectionId')).toBeTruthy();
    expect(wsUrl.searchParams.get('deviceId')).toBe('device-1');

    ws.triggerClose({
      code: 1011,
      reason: 'upstream_reset',
      wasClean: false,
    });

    const debugSnapshot = getScanWebSocketSyncDebugSnapshot(
      'scan-close-debug'
    ) as Record<string, unknown>;

    expect(debugSnapshot.currentConnectionId).toBe(wsUrl.searchParams.get('connectionId'));
    expect(debugSnapshot.socketCloses).toBe(1);
    expect(debugSnapshot.lastCloseCode).toBe(1011);
    expect(debugSnapshot.lastCloseReason).toBe('upstream_reset');
    expect(debugSnapshot.lastCloseWasClean).toBe(false);
    expect(
      (debugSnapshot.recentEvents as Array<Record<string, unknown>>).some(
        (event) =>
          event.type === 'socket-close' &&
          (event.details as Record<string, unknown>)?.connectionId ===
            wsUrl.searchParams.get('connectionId')
      )
    ).toBe(true);
  });
});
