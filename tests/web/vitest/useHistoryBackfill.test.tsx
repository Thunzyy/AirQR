import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useHistoryBackfill } from '@web/hooks/useHistoryBackfill';
import type { IncompleteScanItem, ScanUploadConfig } from '@web/types';

const {
  countScanSessionPacketsMock,
  deleteIncompleteScanMock,
  deleteScanSessionChunksMock,
  deleteScanSessionPacketsMock,
  getIncompleteScanByIdMock,
  queueScanPacketMock,
  visitScanSessionPacketPagesMock,
} = vi.hoisted(() => ({
  countScanSessionPacketsMock: vi.fn(),
  deleteIncompleteScanMock: vi.fn(),
  deleteScanSessionChunksMock: vi.fn(),
  deleteScanSessionPacketsMock: vi.fn(),
  getIncompleteScanByIdMock: vi.fn(),
  queueScanPacketMock: vi.fn(),
  visitScanSessionPacketPagesMock: vi.fn(),
}));

vi.mock('@web/services/historyDB', () => ({
  getIncompleteScanById: getIncompleteScanByIdMock,
  deleteIncompleteScan: deleteIncompleteScanMock,
}));

vi.mock('@web/services/scanSessionDB', () => ({
  countScanSessionPackets: countScanSessionPacketsMock,
  deleteScanSessionChunks: deleteScanSessionChunksMock,
  deleteScanSessionPackets: deleteScanSessionPacketsMock,
  visitScanSessionPacketPages: visitScanSessionPacketPagesMock,
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

const localIncomplete: IncompleteScanItem = {
  sessionId: 'scan-1',
  filename: 'archive.bin',
  received: 70,
  total: 70,
  date: '10:00',
  source: 'local',
};

const remoteIncomplete: IncompleteScanItem = {
  sessionId: 'scan-1',
  filename: 'archive.bin',
  received: 2,
  total: 70,
  date: '10:00',
  source: 'server',
};

describe('useHistoryBackfill', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    countScanSessionPacketsMock.mockReset();
    deleteIncompleteScanMock.mockReset();
    deleteScanSessionChunksMock.mockReset();
    deleteScanSessionPacketsMock.mockReset();
    getIncompleteScanByIdMock.mockReset();
    queueScanPacketMock.mockReset();
    visitScanSessionPacketPagesMock.mockReset();
  });

  it('backfills persisted packet pages with their original packet indexes', async () => {
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
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: 'scan-1',
      filename: 'archive.bin',
      received: 70,
      total: 70,
    });

    renderHook(() =>
      useHistoryBackfill({
        incompleteItems: [localIncomplete],
        remoteIncompleteItems: [remoteIncomplete],
        setRemoteIncompleteItems: vi.fn(),
        completedScannedSessionIds: new Set<string>(),
        shouldSync: true,
        remoteHistoryReady: true,
        uploadConfig: baseUploadConfig,
        removeIncompleteScan: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        'scan-1',
        expect.any(Function)
      );
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(4);
    });

    expect(
      queueScanPacketMock.mock.calls.map(([, metadata]) => metadata.packetIndex)
    ).toEqual([0, 1, 64, 65]);
  });

  it('retries a failed backfill when the same session is revisited with unchanged counts', async () => {
    countScanSessionPacketsMock.mockResolvedValue(1);
    visitScanSessionPacketPagesMock.mockImplementation(async (_sessionId, visitor) => {
      await visitor({
        startIndex: 0,
        packets: [new Uint8Array([1, 2, 3])],
      });
    });
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: 'scan-1',
      filename: 'archive.bin',
      received: 6,
      total: 20,
    });
    queueScanPacketMock
      .mockImplementationOnce(() => {
        throw new Error('temporary failure');
      })
      .mockImplementation(() => undefined);

    const initialProps = {
      incompleteItems: [
        {
          sessionId: 'scan-1',
          filename: 'archive.bin',
          received: 6,
          total: 20,
          date: '10:00',
          source: 'local' as const,
        },
      ],
      remoteIncompleteItems: [
        {
          sessionId: 'scan-1',
          filename: 'archive.bin',
          received: 2,
          total: 20,
          date: '10:00',
          source: 'server' as const,
        },
      ],
      setRemoteIncompleteItems: vi.fn(),
      completedScannedSessionIds: new Set<string>(),
      shouldSync: true,
      remoteHistoryReady: true,
      uploadConfig: baseUploadConfig,
      removeIncompleteScan: vi.fn(),
    };

    const { rerender } = renderHook((props: typeof initialProps) =>
      useHistoryBackfill(props),
      { initialProps }
    );

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(1);
    });

    rerender({
      ...initialProps,
      incompleteItems: initialProps.incompleteItems.map((item) => ({ ...item })),
    });

    await waitFor(() => {
      expect(queueScanPacketMock).toHaveBeenCalledTimes(2);
    });
  });
});
