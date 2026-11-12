import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsSync } from '@web/hooks/useSettingsSync';
import { useServerAuthState } from '@web/hooks/useServerAuthState';
import { resetServerAuthStatusCache } from '@web/services/serverAuth';
import { useEncoderStore, useScannerStore, useSettingsStore } from '@web/store';

describe('useSettingsSync', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetServerAuthStatusCache();

    useSettingsStore.setState({
      ...useSettingsStore.getInitialState(),
      uploadConfig: {
        ...useSettingsStore.getInitialState().uploadConfig,
        enabled: true,
        url: 'https://sync-default.test',
        apiKey: '',
        username: '',
        password: '',
      },
    });
    useEncoderStore.setState(useEncoderStore.getInitialState());
    useScannerStore.setState(useScannerStore.getInitialState());
  });

  it('does not fetch synced settings when the server requires auth and no credentials are configured', async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        url: 'https://auth-required.test',
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, authorized: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    renderHook(() => useSettingsSync());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/auth/status');
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/api/config/settings')
      )
    ).toBe(false);
  });

  it('marks server auth as ready when the server does not require credentials', async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        url: 'https://auth-open.test',
      },
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: false, authorized: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { result } = renderHook(() =>
      useServerAuthState(useSettingsStore.getState().uploadConfig)
    );

    await waitFor(() => {
      expect(result.current.authReady).toBe(true);
    });
  });

  it('marks server auth as unavailable when the auth status probe fails', async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        url: 'https://offline-sync.test',
      },
    });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const { result } = renderHook(() =>
      useServerAuthState(useSettingsStore.getState().uploadConfig)
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });

    expect(result.current.authReady).toBe(false);
    expect(result.current.connectionError).toBe(true);
  });

  it('auto-signs in with saved credentials before loading synced settings', async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        url: 'https://auth-required.test',
        username: 'admin',
        password: 'admin',
      },
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: true, authorized: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            enabled: true,
            authorized: true,
            username: 'admin',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: true, authorized: true, username: 'admin' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ theme: 'dark' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    renderHook(() => useSettingsSync());

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/api/config/settings')
        )
      ).toBe(true);
    });
  });

  it('upgrades the legacy synced encoder defaults to the Flutter profile', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: false, authorized: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            encoder: {
              fps: 10,
              packetSize: 800,
              ecc: 'MEDIUM',
              targetSize: 150,
              raptorqOverhead: 1.2,
              compressionEnabled: false,
              forceChunkMode: true,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    renderHook(() => useSettingsSync());

    await waitFor(() => {
      expect(useEncoderStore.getState().config).toMatchObject({
        fps: 10,
        packetSize: 1500,
        ecc: 'LOW',
        targetSize: 177,
        raptorqOverhead: 1.3,
        compressionEnabled: false,
        forceChunkMode: true,
      });
    });
  });
});
