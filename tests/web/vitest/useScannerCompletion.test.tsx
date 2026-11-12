import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useScannerCompletion } from '@web/hooks/useScannerCompletion';

const {
  deleteIncompleteScanMock,
  deleteScanSessionChunksMock,
  deleteScanSessionPacketsMock,
  getIncompleteScanByIdMock,
  loadScanSessionChunksMock,
  saveScanSessionChunkMock,
} = vi.hoisted(() => ({
  deleteIncompleteScanMock: vi.fn(),
  deleteScanSessionChunksMock: vi.fn(),
  deleteScanSessionPacketsMock: vi.fn(),
  getIncompleteScanByIdMock: vi.fn(),
  loadScanSessionChunksMock: vi.fn(),
  saveScanSessionChunkMock: vi.fn(),
}));

vi.mock('@web/services/historyDB', () => ({
  deleteIncompleteScan: deleteIncompleteScanMock,
  getIncompleteScanById: getIncompleteScanByIdMock,
}));

vi.mock('@web/services/scanSessionDB', () => ({
  deleteScanSessionChunks: deleteScanSessionChunksMock,
  deleteScanSessionPackets: deleteScanSessionPacketsMock,
  loadScanSessionChunks: loadScanSessionChunksMock,
  saveScanSessionChunk: saveScanSessionChunkMock,
}));

describe('useScannerCompletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    deleteIncompleteScanMock.mockReset();
    deleteScanSessionChunksMock.mockReset();
    deleteScanSessionPacketsMock.mockReset();
    getIncompleteScanByIdMock.mockReset();
    loadScanSessionChunksMock.mockReset();
    saveScanSessionChunkMock.mockReset();
  });

  it('persists a completed chunk and assembles the final file when all chunks are present', async () => {
    const onScanComplete = vi.fn();
    const setIsScanning = vi.fn();
    const setResultData = vi.fn();
    const packetIndexRef = { current: 9 };
    const remoteCompleteHandledRef = { current: null as string | null };
    const chunkData = new Uint8Array([1, 2, 3, 4]);

    saveScanSessionChunkMock.mockResolvedValue(undefined);
    loadScanSessionChunksMock.mockResolvedValue([{ id: 0, data: chunkData }]);
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: '123',
      filename: 'stored.bin',
    });

    const { result } = renderHook(() =>
      useScannerCompletion({
        getScanDurationSeconds: () => 12,
        onScanComplete,
        packetIndexRef,
        remoteCompleteHandledRef,
        setIsScanning,
        setResultData,
      })
    );

    let persisted;
    await act(async () => {
      persisted = await result.current.persistChunkAndMaybeAssemble({
        chunkData,
        chunkId: 0,
        filename: null,
        sessionId: '123',
        totalChunks: 1,
      });
    });

    expect(saveScanSessionChunkMock).toHaveBeenCalledWith('123', 0, chunkData);
    expect(loadScanSessionChunksMock).toHaveBeenCalledWith('123');
    expect(persisted).toEqual({ chunksSaved: 1, completed: true });
    expect(setIsScanning).toHaveBeenCalledWith(false);
    expect(setResultData).toHaveBeenCalledWith({
      kind: 'file',
      filename: 'stored.bin',
      data: expect.any(Blob),
      duration: 12,
    });
    expect(packetIndexRef.current).toBe(0);
    expect(remoteCompleteHandledRef.current).toBe('123');
    expect(onScanComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '123',
        title: 'stored.bin',
        origin: 'scanned',
      })
    );
    await waitFor(() => {
      expect(deleteIncompleteScanMock).toHaveBeenCalledWith('123');
      expect(deleteScanSessionChunksMock).toHaveBeenCalledWith('123');
      expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith('123');
    });
  });

  it('skips local chunk persistence when resume authority is server', async () => {
    const onScanComplete = vi.fn();
    const setIsScanning = vi.fn();
    const setResultData = vi.fn();
    const packetIndexRef = { current: 9 };
    const remoteCompleteHandledRef = { current: null as string | null };
    const chunkData = new Uint8Array([1, 2, 3, 4]);

    const { result } = renderHook(() =>
      useScannerCompletion({
        getScanDurationSeconds: () => 12,
        onScanComplete,
        packetIndexRef,
        remoteCompleteHandledRef,
        resumeAuthority: 'server',
        setIsScanning,
        setResultData,
      })
    );

    let persisted;
    await act(async () => {
      persisted = await result.current.persistChunkAndMaybeAssemble({
        chunkData,
        chunkId: 0,
        filename: 'stream.bin',
        sessionId: '123',
        totalChunks: 1,
      });
    });

    expect(saveScanSessionChunkMock).not.toHaveBeenCalled();
    expect(loadScanSessionChunksMock).not.toHaveBeenCalled();
    expect(persisted).toEqual({ chunksSaved: 0, completed: false });
    expect(onScanComplete).not.toHaveBeenCalled();
    expect(setResultData).not.toHaveBeenCalled();
  });

  it('finalizes a directly completed scan result and clears cached session state', async () => {
    const onScanComplete = vi.fn();
    const setIsScanning = vi.fn();
    const setResultData = vi.fn();
    const packetIndexRef = { current: 4 };
    const remoteCompleteHandledRef = { current: null as string | null };
    const fileData = new Uint8Array([5, 6, 7]);

    const { result } = renderHook(() =>
      useScannerCompletion({
        getScanDurationSeconds: () => 5,
        onScanComplete,
        packetIndexRef,
        remoteCompleteHandledRef,
        setIsScanning,
        setResultData,
      })
    );

    await act(async () => {
      await result.current.finalizeCompletedScan({
        data: fileData,
        filename: 'done.bin',
        sessionId: '321',
      });
    });

    expect(setIsScanning).toHaveBeenCalledWith(false);
    expect(setResultData).toHaveBeenCalledWith({
      kind: 'file',
      filename: 'done.bin',
      data: fileData,
      duration: 5,
    });
    expect(packetIndexRef.current).toBe(0);
    expect(remoteCompleteHandledRef.current).toBe('321');
    expect(onScanComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '321',
        title: 'done.bin',
      })
    );
    await waitFor(() => {
      expect(deleteIncompleteScanMock).toHaveBeenCalledWith('321');
      expect(deleteScanSessionChunksMock).toHaveBeenCalledWith('321');
      expect(deleteScanSessionPacketsMock).toHaveBeenCalledWith('321');
    });
  });
});
