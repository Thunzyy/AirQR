import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useScannerCamera } from '@web/hooks/useScannerCamera';

type ScannerConfig = {
  enableTorch: boolean;
  resolution: '720p' | '1080p' | '1440p';
};

function createStream() {
  const track = {
    stop: vi.fn(),
    readyState: 'live',
    applyConstraints: vi.fn(),
    getCapabilities: vi.fn(() => ({})),
  };

  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

function createVideoElement() {
  const video = document.createElement('video');

  Object.defineProperty(video, 'play', {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  });

  Object.defineProperty(video, 'srcObject', {
    value: null,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(video, 'readyState', {
    get: () => 1,
    configurable: true,
  });

  return video;
}

function createArgs(overrides?: {
  scannerConfig?: Partial<ScannerConfig>;
  settingsDefaultCameraId?: string | null;
}) {
  const getUserMediaMock = vi.fn().mockResolvedValue(createStream());
  const enumerateDevicesMock = vi.fn().mockResolvedValue([
    { kind: 'videoinput', deviceId: 'front-camera', label: 'Front Camera' },
    { kind: 'videoinput', deviceId: 'rear-camera', label: 'Back Camera' },
  ]);
  const setStatus = vi.fn();
  const videoRef = { current: createVideoElement() };

  (navigator as Navigator & { mediaDevices: MediaDevices }).mediaDevices = {
    getUserMedia: getUserMediaMock,
    enumerateDevices: enumerateDevicesMock,
  } as MediaDevices;

  return {
    getUserMediaMock,
    enumerateDevicesMock,
    setStatus,
    args: {
      resultData: null,
      scannerConfig: {
        enableTorch: false,
        resolution: '1080p',
        ...overrides?.scannerConfig,
      } as ScannerConfig,
      settingsDefaultCameraId: overrides?.settingsDefaultCameraId ?? null,
      setStatus,
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'scanner.scanning') {
          return 'Scanning';
        }
        if (key === 'scanner.cameraError') {
          return 'Camera error';
        }
        if (key === 'scanner.camera') {
          return `Camera ${options?.index ?? ''}`.trim();
        }
        return key;
      },
      videoRef,
    },
  };
}

describe('useScannerCamera', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the camera once on mount, enumerates devices, and prefers the rear camera by default', async () => {
    const { args, enumerateDevicesMock, getUserMediaMock, setStatus } = createArgs();

    const { result } = renderHook(() => useScannerCamera(args));

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(enumerateDevicesMock).toHaveBeenCalledTimes(1);
    });

    expect(result.current.hasCamera).toBe(true);
    expect(result.current.availableCameras).toHaveLength(2);
    expect(result.current.selectedCameraId).toBe('rear-camera');
    expect(setStatus).toHaveBeenCalledWith('Scanning');
  });

  it('retries a selected camera with facingMode fallback when exact deviceId constraints fail', async () => {
    const { args, getUserMediaMock } = createArgs();
    const fallbackError = new DOMException('device busy', 'NotReadableError');

    const { result } = renderHook(() => useScannerCamera(args));

    await waitFor(() => {
      expect(result.current.selectedCameraId).toBe('rear-camera');
    });

    getUserMediaMock.mockReset();
    getUserMediaMock
      .mockRejectedValueOnce(fallbackError)
      .mockResolvedValueOnce(createStream());

    await act(async () => {
      await result.current.selectCamera('front-camera');
    });

    expect(getUserMediaMock).toHaveBeenNthCalledWith(1, {
      video: expect.objectContaining({
        deviceId: { exact: 'front-camera' },
      }),
    });

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenNthCalledWith(2, {
        video: expect.objectContaining({
          facingMode: { ideal: 'user' },
        }),
      });
    });

    expect(result.current.selectedCameraId).toBe('front-camera');
  });
});
