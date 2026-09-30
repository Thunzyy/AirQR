import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useScannerChunkProgress } from '@web/hooks/useScannerChunkProgress';

function createArgs(
  initialStats: {
    received: number;
    min: number;
    total: number | undefined;
    chunkReceived?: number;
  } = {
    received: 0,
    min: 0,
    total: undefined,
  }
) {
  let currentStats = initialStats;
  const onScanProgress = vi.fn();
  const setProgress = vi.fn();
  const setStatus = vi.fn();
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
      serverProgressSeenRef: { current: false },
      setProgress,
      setScanStats,
      setStatus,
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'scanner.chunkComplete') {
          return `Chunk ${options?.current}/${options?.total} complete!`;
        }
        if (key === 'common.unknownFile') {
          return 'Unknown File';
        }
        return key;
      },
      updateActiveChunk,
    },
    mocks: {
      onScanProgress,
      setProgress,
      setScanStats,
      setStatus,
      updateActiveChunk,
    },
  };
}

describe('useScannerChunkProgress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applies chunk completion progress to UI state and emits local scan progress', () => {
    const { args, currentStats, mocks } = createArgs();
    const packetDelta = [new Uint8Array([1, 2, 3])];

    const { result } = renderHook(() => useScannerChunkProgress(args));

    let progressState;
    act(() => {
      progressState = result.current.applyChunkCompletedProgress({
        packetDelta,
        packetStartIndex: 7,
        resolvedSessionId: '123',
        result: {
          chunkData: new Uint8Array([4, 5, 6]),
          chunkId: 1,
          chunksCompleted: 1,
          filename: 'stream.bin',
          overallPercent: 55,
          packetsExpectedChunk: 394,
          packetsReceivedChunk: 84,
          packetsReceivedTotal: 401,
          packetsTotalChunk: 472,
          totalChunks: 3,
        },
      });
    });

    expect(mocks.updateActiveChunk).toHaveBeenCalledWith(1, 3);
    expect(mocks.setStatus).toHaveBeenCalledWith('Chunk 2/3 complete!');
    expect(mocks.setProgress).toHaveBeenCalledWith(55);
    expect(currentStats()).toEqual({
      received: 401,
      min: 1182,
      total: undefined,
      chunkTotal: 472,
      chunkReceived: 84,
    });
    expect(mocks.onScanProgress).toHaveBeenCalledWith({
      sessionId: '123',
      filename: 'stream.bin',
      received: 401,
      total: 1182,
      totalIsEstimate: true,
      progressPercent: 55,
      deviceName: 'This phone',
      source: 'local',
      packetStartIndex: 7,
      packetDelta,
      chunksCompleted: 1,
      totalChunks: 3,
      chunksSaved: 0,
    });
    expect(progressState).toEqual({
      filename: 'stream.bin',
      progressPercent: 55,
      received: 401,
      total: 1182,
      totalIsEstimate: true,
    });
  });

  it('suppresses visible chunk completion progress when server resume is authoritative', () => {
    const { args, currentStats, mocks } = createArgs();
    const packetDelta = [new Uint8Array([1, 2, 3])];

    const { result } = renderHook(() =>
      useScannerChunkProgress({
        ...args,
        resumeAuthority: 'server',
      })
    );

    let progressState;
    act(() => {
      progressState = result.current.applyChunkCompletedProgress({
        packetDelta,
        packetStartIndex: 7,
        resolvedSessionId: '123',
        result: {
          chunkData: new Uint8Array([4, 5, 6]),
          chunkId: 1,
          chunksCompleted: 1,
          filename: 'stream.bin',
          overallPercent: 55,
          packetsExpectedChunk: 394,
          packetsReceivedTotal: 401,
          packetsTotalChunk: 472,
          totalChunks: 3,
        },
      });
    });

    expect(mocks.updateActiveChunk).toHaveBeenCalledWith(1, 3);
    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(mocks.setProgress).not.toHaveBeenCalled();
    expect(currentStats()).toEqual({
      received: 0,
      min: 0,
      total: undefined,
    });
    expect(mocks.onScanProgress).not.toHaveBeenCalled();
    expect(progressState).toEqual({
      filename: 'stream.bin',
      progressPercent: 55,
      received: 401,
      total: 1182,
      totalIsEstimate: true,
    });
  });

  it('suppresses persisted chunk progress events when server resume is authoritative', () => {
    const { args, mocks } = createArgs();
    args.chunksSavedRef.current = 2;

    const { result } = renderHook(() =>
      useScannerChunkProgress({
        ...args,
        resumeAuthority: 'server',
      })
    );

    act(() => {
      result.current.emitPersistedChunkProgress({
        chunksCompleted: 2,
        chunksSaved: 2,
        filename: 'stream.bin',
        progressState: {
          filename: 'stream.bin',
          progressPercent: 55,
          received: 401,
          total: 1182,
          totalIsEstimate: true,
        },
        resolvedSessionId: '123',
        totalChunks: 3,
      });
    });

    expect(mocks.onScanProgress).not.toHaveBeenCalled();
  });

  it('emits a second progress update after chunk persistence changes chunksSaved', () => {
    const { args, mocks } = createArgs();
    args.chunksSavedRef.current = 2;

    const { result } = renderHook(() => useScannerChunkProgress(args));

    act(() => {
      result.current.emitPersistedChunkProgress({
        chunksCompleted: 2,
        chunksSaved: 2,
        filename: 'stream.bin',
        progressState: {
          filename: 'stream.bin',
          progressPercent: 55,
          received: 401,
          total: 1182,
          totalIsEstimate: true,
        },
        resolvedSessionId: '123',
        totalChunks: 3,
      });
    });

    expect(mocks.onScanProgress).toHaveBeenCalledWith({
      sessionId: '123',
      filename: 'stream.bin',
      received: 401,
      total: 1182,
      totalIsEstimate: true,
      progressPercent: 55,
      deviceName: 'This phone',
      source: 'local',
      chunksCompleted: 2,
      totalChunks: 3,
      chunksSaved: 2,
    });
  });

  it('keeps the global decode minimum while replacing the current chunk total', () => {
    const { args, currentStats } = createArgs({
      received: 401,
      min: 472,
      total: 580,
    });

    const { result } = renderHook(() => useScannerChunkProgress(args));

    act(() => {
      result.current.applyChunkCompletedProgress({
        packetDelta: [],
        packetStartIndex: 8,
        resolvedSessionId: '123',
        result: {
          chunkId: 2,
          chunksCompleted: 2,
          filename: 'stream.bin',
          overallPercent: 66,
          packetsExpectedChunk: 394,
          packetsReceivedTotal: 422,
          packetsTotalChunk: 472,
          totalChunks: 3,
        },
      });
    });

    expect(currentStats()).toEqual({
      received: 422,
      min: 1182,
      total: undefined,
      chunkTotal: 472,
      chunkReceived: undefined,
    });
  });

  it('promotes MAX to the global exact total once all chunk totals are known', () => {
    const { args, currentStats } = createArgs();

    const { result } = renderHook(() => useScannerChunkProgress(args));

    act(() => {
      result.current.applyChunkCompletedProgress({
        packetDelta: [],
        packetStartIndex: 0,
        resolvedSessionId: '123',
        result: {
          chunkId: 0,
          chunksCompleted: 1,
          filename: 'stream.bin',
          overallPercent: 33,
          packetsExpectedChunk: 394,
          packetsReceivedTotal: 394,
          packetsTotalChunk: 472,
          totalChunks: 3,
        },
      });
      result.current.applyChunkCompletedProgress({
        packetDelta: [],
        packetStartIndex: 1,
        resolvedSessionId: '123',
        result: {
          chunkId: 1,
          chunksCompleted: 2,
          filename: 'stream.bin',
          overallPercent: 66,
          packetsExpectedChunk: 394,
          packetsReceivedTotal: 788,
          packetsTotalChunk: 449,
          totalChunks: 3,
        },
      });
    });

    expect(currentStats()).toEqual({
      received: 788,
      min: 1182,
      total: undefined,
      chunkTotal: 449,
      chunkReceived: undefined,
    });

    act(() => {
      result.current.applyChunkCompletedProgress({
        packetDelta: [],
        packetStartIndex: 2,
        resolvedSessionId: '123',
        result: {
          chunkId: 2,
          chunksCompleted: 3,
          filename: 'stream.bin',
          overallPercent: 99,
          packetsExpectedChunk: 394,
          packetsReceivedTotal: 1182,
          packetsTotalChunk: 472,
          totalChunks: 3,
        },
      });
    });

    expect(currentStats()).toEqual({
      received: 1182,
      min: 1182,
      total: 1393,
      chunkTotal: 472,
      chunkReceived: undefined,
    });
  });
});
