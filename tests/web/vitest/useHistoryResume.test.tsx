import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHistoryResume } from '@web/hooks/useHistoryResume';
import type { IncompleteScanItem, ScanUploadConfig } from '@web/types';

const {
  countScanSessionPacketsMock,
  getIncompleteScanByIdMock,
  replaceScanSessionPacketPagesMock,
  saveIncompleteScanMock,
} = vi.hoisted(() => ({
  countScanSessionPacketsMock: vi.fn(),
  getIncompleteScanByIdMock: vi.fn(),
  replaceScanSessionPacketPagesMock: vi.fn(),
  saveIncompleteScanMock: vi.fn(),
}));

vi.mock('@web/services/historyDB', () => ({
  getIncompleteScanById: getIncompleteScanByIdMock,
  saveIncompleteScan: saveIncompleteScanMock,
}));

vi.mock('@web/services/scanSessionDB', () => ({
  countScanSessionPackets: countScanSessionPacketsMock,
  replaceScanSessionPacketPages: replaceScanSessionPacketPagesMock,
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

describe('useHistoryResume', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    countScanSessionPacketsMock.mockReset();
    getIncompleteScanByIdMock.mockReset();
    replaceScanSessionPacketPagesMock.mockReset();
    saveIncompleteScanMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens an eligible server-backed session immediately in server authority', async () => {
    countScanSessionPacketsMock.mockResolvedValue(0);
    const hydrateRemotePacketPages = vi.fn().mockResolvedValue(2);
    const updateIncompleteScan = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast,
        updateIncompleteScan,
      })
    );

    const item: IncompleteScanItem = {
      sessionId: 'scan-1',
      filename: 'archive.bin',
      received: 2,
      total: 20,
      date: '10:00',
      source: 'server',
      remoteSessionId: 'remote-scan-1',
    };

    act(() => {
      result.current.handleResume(item);
    });

    await waitFor(() => {
      expect(navigateToScanner).toHaveBeenCalledTimes(1);
    });

    expect(countScanSessionPacketsMock).not.toHaveBeenCalled();
    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(saveIncompleteScanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'scan-1',
        source: 'server',
        remoteSessionId: 'remote-scan-1',
      })
    );
    expect(updateIncompleteScan).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'scan-1',
        source: 'server',
        remoteSessionId: 'remote-scan-1',
      })
    );
    expect(setResumeScan).toHaveBeenCalledWith(
      'remote-scan-1',
      null,
      {
        received: 2,
        total: 20,
        filename: 'archive.bin',
      },
      { authority: 'server' }
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it('falls back to local-cache preparation when server resume transport is unavailable', async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', undefined);
    countScanSessionPacketsMock.mockResolvedValue(0);
    const hydrateRemotePacketPages = vi.fn().mockResolvedValue(2);
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast: vi.fn(),
        updateIncompleteScan: vi.fn(),
      })
    );

    act(() => {
      result.current.handleResume({
        sessionId: 'scan-1',
        filename: 'archive.bin',
        received: 2,
        total: 20,
        date: '10:00',
        source: 'server',
        remoteSessionId: 'remote-scan-1',
      });
    });

    await waitFor(() => {
      expect(hydrateRemotePacketPages).toHaveBeenCalledWith(
        'scan-1',
        'remote-scan-1',
        baseUploadConfig,
        { authority: 'local-cache' }
      );
    });

    expect(setResumeScan).toHaveBeenCalledWith(
      'scan-1',
      null,
      {
        received: 2,
        total: 20,
        filename: 'archive.bin',
      },
      { authority: 'local-cache' }
    );
    expect(navigateToScanner).toHaveBeenCalledTimes(1);

    vi.stubGlobal('WebSocket', originalWebSocket);
  });

  it('resumes a server-backed local-cache fallback from the local packet namespace', async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', undefined);
    countScanSessionPacketsMock.mockResolvedValue(8);
    const hydrateRemotePacketPages = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast: vi.fn(),
        updateIncompleteScan: vi.fn(),
      })
    );

    act(() => {
      result.current.handleResume({
        sessionId: 'local-shadow-scan-1',
        filename: 'cross-device-cache.bin',
        received: 8,
        total: 20,
        date: '10:00',
        source: 'server',
        remoteSessionId: 'remote-scan-1',
      });
    });

    await waitFor(() => {
      expect(setResumeScan).toHaveBeenCalledWith(
        'local-shadow-scan-1',
        null,
        {
          received: 8,
          total: 20,
          filename: 'cross-device-cache.bin',
        },
        { authority: 'local-cache' }
      );
    });

    expect(countScanSessionPacketsMock).toHaveBeenCalledWith('local-shadow-scan-1');
    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(navigateToScanner).toHaveBeenCalledTimes(1);

    vi.stubGlobal('WebSocket', originalWebSocket);
  });

  it('uses local-cache authority for server-backed scans when scanned packet sync is disabled', async () => {
    countScanSessionPacketsMock.mockResolvedValue(8);
    const hydrateRemotePacketPages = vi.fn();
    const updateIncompleteScan = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();
    const showToast = vi.fn();
    const uploadConfig: ScanUploadConfig = {
      ...baseUploadConfig,
      syncScanned: false,
    };

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast,
        updateIncompleteScan,
      })
    );

    act(() => {
      result.current.handleResume({
        sessionId: 'local-shadow-scan-1',
        filename: 'cross-device-cache.bin',
        received: 8,
        total: 20,
        date: '10:00',
        source: 'server',
        remoteSessionId: 'remote-scan-1',
      });
    });

    await waitFor(() => {
      expect(setResumeScan).toHaveBeenCalledWith(
        'local-shadow-scan-1',
        null,
        {
          received: 8,
          total: 20,
          filename: 'cross-device-cache.bin',
        },
        { authority: 'local-cache' }
      );
    });

    expect(countScanSessionPacketsMock).toHaveBeenCalledWith('local-shadow-scan-1');
    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(setResumeScan).not.toHaveBeenCalledWith(
      'remote-scan-1',
      expect.anything(),
      expect.anything(),
      { authority: 'server' }
    );
    expect(navigateToScanner).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('skips persisted packet checks for an eligible flutter-seeded server session', async () => {
    countScanSessionPacketsMock.mockResolvedValue(8);
    const hydrateRemotePacketPages = vi.fn();
    const updateIncompleteScan = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast,
        updateIncompleteScan,
      })
    );

    const item: IncompleteScanItem = {
      sessionId: 'local-shadow-scan-1',
      filename: 'cross-device-realtime.bin',
      received: 8,
      total: 86,
      date: '10:00',
      source: 'server',
      remoteSessionId: 'scan-flutter-1',
    };

    act(() => {
      result.current.handleResume(item);
    });

    await waitFor(() => {
      expect(navigateToScanner).toHaveBeenCalledTimes(1);
    });

    expect(countScanSessionPacketsMock).not.toHaveBeenCalled();
    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(saveIncompleteScanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'local-shadow-scan-1',
        filename: 'cross-device-realtime.bin',
        source: 'server',
        remoteSessionId: 'scan-flutter-1',
      })
    );
    expect(updateIncompleteScan).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'local-shadow-scan-1',
        source: 'server',
        remoteSessionId: 'scan-flutter-1',
      })
    );
    expect(setResumeScan).toHaveBeenCalledWith(
      'scan-flutter-1',
      null,
      {
        received: 8,
        total: 86,
        filename: 'cross-device-realtime.bin',
      },
      { authority: 'server' }
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it('uses the server resume path for a local item linked to a remote session', async () => {
    countScanSessionPacketsMock.mockResolvedValue(0);
    const hydrateRemotePacketPages = vi.fn().mockResolvedValue(2);
    const updateIncompleteScan = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast,
        updateIncompleteScan,
      })
    );

    act(() => {
      result.current.handleResume({
        sessionId: 'local-scan-1',
        filename: 'archive.bin',
        received: 2,
        total: 20,
        date: '10:00',
        source: 'local',
        remoteSessionId: 'remote-scan-1',
      });
    });

    await waitFor(() => {
      expect(navigateToScanner).toHaveBeenCalledTimes(1);
    });

    expect(countScanSessionPacketsMock).not.toHaveBeenCalled();
    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(getIncompleteScanByIdMock).not.toHaveBeenCalled();
    expect(setResumeScan).toHaveBeenCalledWith(
      'remote-scan-1',
      null,
      {
        received: 2,
        total: 20,
        filename: 'archive.bin',
      },
      { authority: 'server' }
    );
    expect(updateIncompleteScan).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'local-scan-1',
        source: 'server',
        remoteSessionId: 'remote-scan-1',
      })
    );
    expect(navigateToScanner).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('uses the session id as the remote id for server items without a remote alias', async () => {
    countScanSessionPacketsMock.mockResolvedValue(0);
    const hydrateRemotePacketPages = vi.fn().mockResolvedValue(2);
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast: vi.fn(),
        updateIncompleteScan: vi.fn(),
      })
    );

    act(() => {
      result.current.handleResume({
        sessionId: 'remote-scan-1',
        filename: 'archive.bin',
        received: 2,
        total: 20,
        date: '10:00',
        source: 'server',
      });
    });

    await waitFor(() => {
      expect(navigateToScanner).toHaveBeenCalledTimes(1);
    });

    expect(countScanSessionPacketsMock).not.toHaveBeenCalled();
    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(getIncompleteScanByIdMock).not.toHaveBeenCalled();
    expect(setResumeScan).toHaveBeenCalledWith(
      'remote-scan-1',
      null,
      {
        received: 2,
        total: 20,
        filename: 'archive.bin',
      },
      { authority: 'server' }
    );
  });

  it('reuses persisted packet pages when resuming a local session', async () => {
    countScanSessionPacketsMock.mockResolvedValue(1);
    getIncompleteScanByIdMock.mockResolvedValue({
      sessionId: 'scan-1',
      filename: 'stored.bin',
      received: 6,
      total: 20,
    });
    const hydrateRemotePacketPages = vi.fn();
    const updateIncompleteScan = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast: vi.fn(),
        updateIncompleteScan,
      })
    );

    const item: IncompleteScanItem = {
      sessionId: 'scan-1',
      filename: 'archive.bin',
      received: 4,
      total: 20,
      date: '10:00',
      source: 'local',
    };

    act(() => {
      result.current.handleResume(item);
    });

    await waitFor(() => {
      expect(saveIncompleteScanMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'scan-1',
          filename: 'stored.bin',
          received: 6,
          total: 20,
        })
      );
    });

    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(replaceScanSessionPacketPagesMock).not.toHaveBeenCalled();
    expect(setResumeScan).toHaveBeenCalledWith(
      'scan-1',
      null,
      {
        received: 6,
        total: 20,
        filename: 'stored.bin',
      },
      { authority: 'local-cache' }
    );
    expect(navigateToScanner).toHaveBeenCalledTimes(1);
  });

  it('opens the scanner when local resume storage is unavailable', async () => {
    getIncompleteScanByIdMock.mockRejectedValue(new Error('IndexedDB unavailable'));
    const hydrateRemotePacketPages = vi.fn();
    const updateIncompleteScan = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast,
        updateIncompleteScan,
      })
    );

    act(() => {
      result.current.handleResume({
        sessionId: 'scan-1',
        filename: 'archive.bin',
        received: 4,
        total: 20,
        date: '10:00',
        source: 'local',
      });
    });

    await waitFor(() => {
      expect(setResumeScan).toHaveBeenCalledWith(
        'scan-1',
        null,
        {
          received: 4,
          total: 20,
          filename: 'archive.bin',
        },
        { authority: 'local-cache' }
      );
    });

    expect(hydrateRemotePacketPages).not.toHaveBeenCalled();
    expect(updateIncompleteScan).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'scan-1',
        filename: 'archive.bin',
        received: 4,
        total: 20,
      })
    );
    expect(navigateToScanner).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows an error toast when local-cache remote resume preparation fails', async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', undefined);
    countScanSessionPacketsMock.mockResolvedValue(0);
    const hydrateRemotePacketPages = vi
      .fn()
      .mockRejectedValue(new Error('network unavailable'));
    const showToast = vi.fn();
    const setResumeScan = vi.fn();
    const navigateToScanner = vi.fn();

    const { result } = renderHook(() =>
      useHistoryResume({
        uploadConfig: baseUploadConfig,
        hydrateRemotePacketPages,
        navigateToScanner,
        resumePreparationFailedMessage: 'Resume failed',
        setResumeScan,
        showToast,
        updateIncompleteScan: vi.fn(),
      })
    );

    act(() => {
      result.current.handleResume({
        sessionId: 'scan-1',
        filename: 'archive.bin',
        received: 2,
        total: 20,
        date: '10:00',
        source: 'server',
        remoteSessionId: 'remote-scan-1',
      });
    });

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Resume failed', 'error');
    });

    expect(setResumeScan).not.toHaveBeenCalled();
    expect(navigateToScanner).not.toHaveBeenCalled();

    vi.stubGlobal('WebSocket', originalWebSocket);
  });
});
