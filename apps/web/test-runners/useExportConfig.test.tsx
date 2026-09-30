import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useExportConfig } from '@web/hooks/useExportConfig';
import * as serverAuth from '@web/services/serverAuth';
import type { ScanUploadConfig } from '@web/types';

const baseUploadConfig: ScanUploadConfig = {
  enabled: true,
  url: 'https://sync.example.test',
  apiKey: '',
  username: 'admin',
  password: 'secret',
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: false,
};

describe('useExportConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads the export config once sync is enabled and auth is ready', async () => {
    const fetchSpy = vi
      .spyOn(serverAuth, 'fetchServerWithTimeout')
      .mockImplementation(async () =>
        new Response(
          JSON.stringify({
            enabled: true,
            exportDir: '/exports',
            exportScanned: false,
            exportGenerated: true,
            effectiveDir: '/exports',
            exportDirValid: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    const { result } = renderHook(() =>
      useExportConfig({
        uploadConfig: baseUploadConfig,
        storedSyncAuthConfig: {
          apiKey: '',
          username: 'admin',
          password: 'secret',
        },
        syncBaseUrl: 'https://sync.example.test',
        serverAuthReady: true,
      })
    );

    await waitFor(() => {
      expect(result.current.exportConfig.exportDir).toBe('/exports');
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/config/export'),
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.current.exportDirInput).toBe('/exports');
    expect(result.current.exportConfig.exportScanned).toBe(false);
    expect(result.current.exportConfigError).toBeNull();
  });

  it('saves export config updates and clears the saved badge after the timeout', async () => {
    vi.useFakeTimers();

    vi.spyOn(serverAuth, 'fetchServerWithTimeout').mockResolvedValue(
      new Response(
        JSON.stringify({
          config: {
            enabled: true,
            exportDir: '/updated',
            exportScanned: true,
            exportGenerated: false,
            effectiveDir: '/updated',
            exportDirValid: true,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const { result } = renderHook(() =>
      useExportConfig({
        uploadConfig: baseUploadConfig,
        storedSyncAuthConfig: {
          apiKey: '',
          username: 'admin',
          password: 'secret',
        },
        syncBaseUrl: 'https://sync.example.test',
        serverAuthReady: false,
      })
    );

    await act(async () => {
      await result.current.saveExportConfig({ exportGenerated: false });
    });

    expect(result.current.exportConfig.exportGenerated).toBe(false);
    expect(result.current.exportDirInput).toBe('/updated');
    expect(result.current.exportConfigSaved).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.exportConfigSaved).toBe(false);
  });

  it('reports an invalid server URL without issuing export config requests', async () => {
    const fetchSpy = vi.spyOn(serverAuth, 'fetchServerWithTimeout');

    const { result } = renderHook(() =>
      useExportConfig({
        uploadConfig: {
          ...baseUploadConfig,
          url: 'not-a-valid-url',
        },
        storedSyncAuthConfig: {
          apiKey: '',
          username: 'admin',
          password: 'secret',
        },
        syncBaseUrl: null,
        serverAuthReady: true,
      })
    );

    await waitFor(() => {
      expect(result.current.exportConfigError).toBe('Invalid server URL');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
