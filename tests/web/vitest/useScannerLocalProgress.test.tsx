import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useScannerLocalProgress } from '@web/hooks/useScannerLocalProgress';
import type { ResumeAuthority, ScanUploadConfig } from '@web/types';

const { queueScanPacketMock } = vi.hoisted(() => ({
  queueScanPacketMock: vi.fn(),
}));

vi.mock('@web/services/scanUploadService', () => ({
  queueScanPacket: queueScanPacketMock,
}));

const baseUploadConfig: ScanUploadConfig = {
  enabled: true,
  url: 'https://sync.example.test',
  apiKey: '',
  username: '',
  password: '',
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: true,
};

function createArgs() {
  let currentStats = {
    received: 0,
    min: 0,
    total: undefined as number | undefined,
    chunkReceived: undefined as number | undefined,
  };
  const onScanProgress = vi.fn();
  const setProgress = vi.fn();
  const setStatus = vi.fn();
  const setSyncSourceName = vi.fn();
  const setScanStats = vi.fn((updater: typeof currentStats | ((prev: typeof currentStats) => typeof currentStats)) => {
    currentStats =
      typeof updater === 'function'
        ? (updater as (prev: typeof currentStats) => typeof currentStats)(currentStats)
        : updater;
  });
  const updateActiveChunk = vi.fn();

  return {
    currentStats: () => currentStats,
    args: {
      chunkExactTotalsRef: { current: new Map<number, number>() },
      chunksSavedRef: { current: 0 },
      localDeviceName: 'This phone',
      onScanProgressRef: { current: onScanProgress },
      resumeAuthority: undefined as ResumeAuthority | undefined,
      resumeMode: false,
      scanStatsRef: { current: currentStats },
      serverProgressSeenRef: { current: false },
      setProgress,
      setScanStats,
      setStatus,
      setSyncSourceName,
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'scanner.progressStatus') {
          return `Progress: ${options?.percent}% (${options?.received}/${options?.total})`;
        }
        if (key === 'scanner.receiving') {
          return `Receiving: ${options?.percent}%`;
        }
        if (key === 'common.unknownFile') {
          return 'Unknown File';
        }
        return key;
      },
      updateActiveChunk,
      uploadConfigRef: { current: baseUploadConfig },
    },
    mocks: {
      onScanProgress,
      setProgress,
      setScanStats,
      setStatus,
      setSyncSourceName,
      updateActiveChunk,
    },
  };
}

describe('useScannerLocalProgress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    queueScanPacketMock.mockReset();
  });

  it('queues packet uploads with transport-derived metadata and marks the local sync source', () => {
    const { args, mocks } = createArgs();
    const packet = new Uint8Array([1, 2, 3]);

    const { result } = renderHook(() => useScannerLocalProgress(args));

    act(() => {
      result.current.queuePacketForSync({
        binaryData: packet,
        chunkId: 0,
        chunksCompleted: 1,
        expectedPackets: 394,
        filename: 'stream.bin',
        isStreaming: true,
        packetStartIndex: 2,
        receivedPackets: 10,
        resolvedSessionId: '123',
        resultType: 'progress',
        totalChunks: 3,
        totalExact: true,
        totalPackets: 472,
        transportIdentity: {
          chunkId: 2,
          packetIndex: 7,
        },
      });
    });

    expect(queueScanPacketMock).toHaveBeenCalledWith(
      packet,
      expect.objectContaining({
        sessionId: '123',
        filename: 'stream.bin',
        packetIndex: 7,
        chunkId: 2,
        totalChunks: 3,
        chunksCompleted: 1,
        receivedPackets: 10,
        expectedPackets: 394,
        totalPackets: 472,
        totalPacketsExact: true,
        chunksSaved: 0,
      }),
      baseUploadConfig
    );
    expect(mocks.setSyncSourceName).toHaveBeenCalledWith('This phone');
  });

  it('queues packet uploads without marking local source in server authority', () => {
    const { args, mocks } = createArgs();
    const packet = new Uint8Array([1, 2, 3]);
    args.resumeMode = true;
    args.resumeAuthority = 'server';

    const { result } = renderHook(() => useScannerLocalProgress(args));

    act(() => {
      result.current.queuePacketForSync({
        binaryData: packet,
        chunkId: 0,
        chunksCompleted: 1,
        expectedPackets: 394,
        filename: 'stream.bin',
        isStreaming: true,
        packetStartIndex: 2,
        receivedPackets: 10,
        resolvedSessionId: '123',
        resultType: 'server_authoritative',
        totalChunks: 3,
        totalExact: true,
        totalPackets: 472,
        transportIdentity: {
          chunkId: 2,
          packetIndex: 7,
        },
      });
    });

    expect(queueScanPacketMock).toHaveBeenCalledWith(
      packet,
      expect.objectContaining({
        sessionId: '123',
        packetIndex: 7,
        chunkId: 2,
        resultType: 'server_authoritative',
      }),
      baseUploadConfig
    );
    expect(mocks.setSyncSourceName).not.toHaveBeenCalled();
  });

  it('applies local decoder progress to UI state and emits History progress payloads', () => {
    const { args, currentStats, mocks } = createArgs();
    const packetDelta = [new Uint8Array([9, 9, 9])];

    const { result } = renderHook(() => useScannerLocalProgress(args));

    act(() => {
      result.current.applyProgressResult({
        expectedPackets: 1182,
        packetDelta,
        packetStartIndex: 4,
        receivedPackets: 10,
        resolvedSessionId: '123',
        result: {
          chunkId: 1,
          chunksCompleted: 1,
          filename: 'stream.bin',
          packetsExpectedChunk: 394,
          packetsReceivedChunk: 84,
          percent: 50,
          totalChunks: 3,
        },
        totalPackets: 472,
      });
    });

    expect(mocks.updateActiveChunk).toHaveBeenCalledWith(1, 3);
    expect(mocks.setProgress).toHaveBeenCalledWith(50);
    expect(mocks.setStatus).toHaveBeenCalledWith('Progress: 50.0% (10/1182)');
    expect(currentStats()).toEqual({
      received: 10,
      min: 1182,
      total: undefined,
      chunkTotal: 472,
      chunkReceived: 84,
    });
    expect(mocks.onScanProgress).toHaveBeenCalledWith({
      sessionId: '123',
      filename: 'stream.bin',
      received: 10,
      total: 1182,
      totalIsEstimate: false,
      progressPercent: 50,
      deviceName: 'This phone',
      source: 'local',
      packetStartIndex: 4,
      packetDelta,
      chunksCompleted: 1,
      totalChunks: 3,
      chunksSaved: 0,
    });
  });

  it('does not emit local UI or History progress in server authority', () => {
    const { args, currentStats, mocks } = createArgs();
    args.resumeMode = true;
    args.resumeAuthority = 'server';

    const { result } = renderHook(() => useScannerLocalProgress(args));

    act(() => {
      result.current.applyProgressResult({
        expectedPackets: 1182,
        packetDelta: [new Uint8Array([9, 9, 9])],
        packetStartIndex: 4,
        receivedPackets: 10,
        resolvedSessionId: '123',
        result: {
          chunkId: 1,
          chunksCompleted: 1,
          filename: 'stream.bin',
          packetsExpectedChunk: 394,
          percent: 50,
          totalChunks: 3,
        },
        totalPackets: 472,
      });
    });

    expect(mocks.updateActiveChunk).toHaveBeenCalledWith(1, 3);
    expect(mocks.setProgress).not.toHaveBeenCalled();
    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(mocks.onScanProgress).not.toHaveBeenCalled();
    expect(currentStats()).toEqual({
      received: 0,
      min: 0,
      total: undefined,
      chunkReceived: undefined,
    });
  });

  it('only exposes MAX after all exact chunk totals are known locally', () => {
    const { args, currentStats } = createArgs();

    const { result } = renderHook(() => useScannerLocalProgress(args));

    act(() => {
      result.current.applyProgressResult({
        expectedPackets: 1182,
        packetDelta: [],
        packetStartIndex: 0,
        receivedPackets: 120,
        resolvedSessionId: '123',
        result: {
          chunkId: 0,
          filename: 'stream.bin',
          packetsExpectedChunk: 394,
          percent: 10,
          totalChunks: 3,
        },
        totalPackets: 472,
      });
    });

    expect(currentStats()).toEqual({
      received: 120,
      min: 1182,
      total: undefined,
      chunkTotal: 472,
      chunkReceived: undefined,
    });

    act(() => {
      result.current.applyProgressResult({
        expectedPackets: 1182,
        packetDelta: [],
        packetStartIndex: 1,
        receivedPackets: 260,
        resolvedSessionId: '123',
        result: {
          chunkId: 1,
          filename: 'stream.bin',
          packetsExpectedChunk: 394,
          percent: 22,
          totalChunks: 3,
        },
        totalPackets: 449,
      });
      result.current.applyProgressResult({
        expectedPackets: 1182,
        packetDelta: [],
        packetStartIndex: 2,
        receivedPackets: 401,
        resolvedSessionId: '123',
        result: {
          chunkId: 2,
          filename: 'stream.bin',
          packetsExpectedChunk: 394,
          percent: 34,
          totalChunks: 3,
        },
        totalPackets: 472,
      });
    });

    expect(currentStats()).toEqual({
      received: 401,
      min: 1182,
      total: 1393,
      chunkTotal: 472,
      chunkReceived: undefined,
    });
  });
});
