import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionTest } from '@web/hooks/useConnectionTest';
import * as serverAuth from '@web/services/serverAuth';
import type { TFunction } from 'i18next';
import type { ScanUploadConfig } from '@web/types';

const baseUploadConfig: ScanUploadConfig = {
  enabled: true,
  url: 'https://sync.example.test',
  apiKey: '',
  username: '',
  password: '',
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: false,
};

// SAFETY: the hook only interpolates translation keys; tests return the key unchanged.
const t: TFunction = ((key: string) => key) as TFunction;

function mockHttpsPageLocation() {
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    value: {
      origin: 'https://app.airqr.test',
      protocol: 'https:',
      host: 'app.airqr.test',
    },
    writable: true,
    configurable: true,
  });

  return () => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  };
}

describe('useConnectionTest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('persists typed draft credentials only after a successful connection probe', async () => {
    const restoreLocation = mockHttpsPageLocation();
    const setUploadConfig = vi.fn();
    const showToast = vi.fn();
    const sameOriginUploadConfig = {
      ...baseUploadConfig,
      url: 'https://app.airqr.test',
    };

    vi.spyOn(serverAuth, 'loginToServerSession').mockResolvedValue({
      enabled: true,
      authorized: true,
      username: 'admin',
    });
    const fetchSpy = vi
      .spyOn(serverAuth, 'fetchServerWithTimeout')
      .mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const { result } = renderHook(() =>
        useConnectionTest({
          uploadConfig: sameOriginUploadConfig,
          setUploadConfig,
          syncBaseUrl: 'https://app.airqr.test',
          authEnabled: true,
          authorized: false,
          authStatusChecking: false,
          authConnectionError: false,
          t,
          showToast,
        })
      );

      act(() => {
        result.current.setSyncUsernameDraft('admin');
        result.current.setSyncPasswordDraft('admin');
      });

      await act(async () => {
        await result.current.handleConnectionAction();
      });

      expect(serverAuth.loginToServerSession).toHaveBeenCalledWith(
        sameOriginUploadConfig,
        {
          username: 'admin',
          password: 'admin',
        }
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/history?limit=1'),
        expect.objectContaining({ method: 'GET' })
      );
      expect(setUploadConfig).toHaveBeenCalledWith({
        username: 'admin',
        password: 'admin',
      });
      expect(result.current.syncTestResult).toMatchObject({
        success: true,
        kind: 'connection',
      });
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      restoreLocation();
    }
  });

  it('uses Basic auth directly for external servers instead of a cookie login', async () => {
    const restoreLocation = mockHttpsPageLocation();
    const setUploadConfig = vi.fn();
    const showToast = vi.fn();
    const loginSpy = vi.spyOn(serverAuth, 'loginToServerSession');
    const fetchSpy = vi
      .spyOn(serverAuth, 'fetchServerWithTimeout')
      .mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const { result } = renderHook(() =>
        useConnectionTest({
          uploadConfig: baseUploadConfig,
          setUploadConfig,
          syncBaseUrl: 'https://sync.example.test',
          authEnabled: true,
          authorized: false,
          authStatusChecking: false,
          authConnectionError: false,
          t,
          showToast,
        })
      );

      act(() => {
        result.current.setSyncUsernameDraft('admin');
        result.current.setSyncPasswordDraft('secret');
      });

      await act(async () => {
        await result.current.handleConnectionAction();
      });

      expect(loginSpy).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/history?limit=1'),
        expect.objectContaining({
          method: 'GET',
          credentials: 'omit',
          headers: expect.objectContaining({
            Authorization: `Basic ${btoa('admin:secret')}`,
          }),
        })
      );
      expect(setUploadConfig).toHaveBeenCalledWith({
        username: 'admin',
        password: 'secret',
      });
      expect(result.current.syncTestResult).toMatchObject({
        success: true,
        kind: 'connection',
      });
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      restoreLocation();
    }
  });

  it('keeps the masked password draft when rechecking an authorized browser with saved credentials', async () => {
    const setUploadConfig = vi.fn();
    const logoutSpy = vi.spyOn(serverAuth, 'logoutFromServerSession').mockResolvedValue();
    vi.spyOn(serverAuth, 'loginToServerSession').mockResolvedValue({
      enabled: true,
      authorized: true,
      username: 'admin',
    });
    vi.spyOn(serverAuth, 'fetchServerWithTimeout').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() =>
      useConnectionTest({
        uploadConfig: {
          ...baseUploadConfig,
          username: 'admin',
          password: 'secret',
        },
        setUploadConfig,
        syncBaseUrl: 'https://sync.example.test',
        authEnabled: true,
        authorized: true,
        authStatusChecking: false,
        authConnectionError: false,
        t,
        showToast: vi.fn(),
      })
    );

    expect(result.current.syncPasswordDraft).toBe('secret');

    await act(async () => {
      await result.current.handleConnectionAction();
    });

    expect(logoutSpy).not.toHaveBeenCalled();
    expect(setUploadConfig).not.toHaveBeenCalledWith({ password: '' });
    expect(result.current.syncPasswordDraft).toBe('secret');
    expect(result.current.syncTestResult).toMatchObject({
      success: true,
      kind: 'connection',
    });
  });

  it('clears the local password draft after disconnecting a cookie-only authorized browser', async () => {
    const setUploadConfig = vi.fn();

    vi.spyOn(serverAuth, 'logoutFromServerSession').mockResolvedValue();

    const { result } = renderHook(() =>
      useConnectionTest({
        uploadConfig: baseUploadConfig,
        setUploadConfig,
        syncBaseUrl: 'https://sync.example.test',
        authEnabled: true,
        authorized: true,
        authStatusChecking: false,
        authConnectionError: false,
        t,
        showToast: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleConnectionAction();
    });

    expect(serverAuth.logoutFromServerSession).toHaveBeenCalledWith(baseUploadConfig);
    expect(setUploadConfig).toHaveBeenCalledWith({ password: '' });
    expect(result.current.syncPasswordDraft).toBe('');
    expect(result.current.syncTestResult).toMatchObject({
      success: true,
      kind: 'sign-out',
    });
  });

  it('allows disconnecting an authorized browser when an HTTPS page has an HTTP external server configured', async () => {
    const restoreLocation = mockHttpsPageLocation();
    const setUploadConfig = vi.fn();
    const showToast = vi.fn();
    const fetchSpy = vi.spyOn(serverAuth, 'fetchServerWithTimeout');
    const logoutSpy = vi.spyOn(serverAuth, 'logoutFromServerSession');

    try {
      const { result } = renderHook(() =>
        useConnectionTest({
          uploadConfig: {
            ...baseUploadConfig,
            url: 'http://airqr.pgnrd.fr:8081',
            username: 'admin',
            password: 'secret',
          },
          setUploadConfig,
          syncBaseUrl: 'http://airqr.pgnrd.fr:8081',
          authEnabled: true,
          authorized: true,
          authStatusChecking: false,
          authConnectionError: false,
          t,
          showToast,
        })
      );

      await act(async () => {
        await result.current.handleConnectionAction();
      });

      expect(logoutSpy).not.toHaveBeenCalled();
      expect(setUploadConfig).toHaveBeenCalledWith({
        apiKey: '',
        username: '',
        password: '',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.current.syncTestResult).toMatchObject({
        success: true,
        kind: 'sign-out',
        message: 'settings.signOutSuccess',
      });
      expect(showToast).not.toHaveBeenCalledWith('errors.connectionMixedContent', 'error');
    } finally {
      restoreLocation();
    }
  });

  it('clears stale inline results when the user edits draft credentials again', async () => {
    const { result } = renderHook(() =>
      useConnectionTest({
        uploadConfig: baseUploadConfig,
        setUploadConfig: vi.fn(),
        syncBaseUrl: 'https://sync.example.test',
        authEnabled: false,
        authorized: false,
        authStatusChecking: false,
        authConnectionError: false,
        t,
        showToast: vi.fn(),
      })
    );

    act(() => {
      result.current.setSyncTestResult({
        success: true,
        message: 'ok',
        kind: 'connection',
      });
    });

    expect(result.current.syncTestResult).toMatchObject({
      kind: 'connection',
    });

    act(() => {
      result.current.setSyncUsernameDraft('next-admin');
    });

    expect(result.current.syncTestResult).toBeNull();
  });

  it('maps external network failures to a CORS-oriented message', async () => {
    const showToast = vi.fn();
    vi.spyOn(serverAuth, 'fetchServerWithTimeout').mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );

    const { result } = renderHook(() =>
      useConnectionTest({
        uploadConfig: baseUploadConfig,
        setUploadConfig: vi.fn(),
        syncBaseUrl: 'https://airqr.pgnrd.fr',
        authEnabled: false,
        authorized: false,
        authStatusChecking: false,
        authConnectionError: false,
        t,
        showToast,
      })
    );

    await act(async () => {
      await result.current.handleConnectionAction();
    });

    expect(result.current.syncTestResult).toMatchObject({
      success: false,
      kind: 'error',
      message: 'errors.connectionFailedCors',
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('falls back to the trusted app origin for a local HTTPS server on another port', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://192.168.1.36:5173',
        protocol: 'https:',
        host: '192.168.1.36:5173',
        hostname: '192.168.1.36',
      },
      writable: true,
      configurable: true,
    });
    const setUploadConfig = vi.fn();
    const showToast = vi.fn();
    const fetchSpy = vi
      .spyOn(serverAuth, 'fetchServerWithTimeout')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    try {
      const localConfig = {
        ...baseUploadConfig,
        url: 'https://192.168.1.36:8081',
      };
      const { result } = renderHook(() =>
        useConnectionTest({
          uploadConfig: localConfig,
          setUploadConfig,
          syncBaseUrl: 'https://192.168.1.36:8081',
          authEnabled: false,
          authorized: true,
          authStatusChecking: false,
          authConnectionError: false,
          t,
          showToast,
        })
      );

      await act(async () => {
        await result.current.handleConnectionAction();
      });

      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://192.168.1.36:5173/api/history?limit=1',
        expect.objectContaining({ credentials: 'same-origin' })
      );
      expect(setUploadConfig).toHaveBeenCalledWith({
        url: 'same-origin',
        username: '',
        password: '',
      });
      expect(result.current.syncTestResult).toMatchObject({
        success: true,
        kind: 'connection',
      });
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  it('stops before fetching when an HTTPS page is configured to call an HTTP external server', async () => {
    const showToast = vi.fn();
    const fetchSpy = vi.spyOn(serverAuth, 'fetchServerWithTimeout');
    const restoreLocation = mockHttpsPageLocation();

    try {
      const { result } = renderHook(() =>
        useConnectionTest({
          uploadConfig: {
            ...baseUploadConfig,
            url: 'http://airqr.pgnrd.fr:8081',
          },
          setUploadConfig: vi.fn(),
          syncBaseUrl: 'http://airqr.pgnrd.fr:8081',
          authEnabled: false,
          authorized: false,
          authStatusChecking: false,
          authConnectionError: false,
          t,
          showToast,
        })
      );

      await act(async () => {
        await result.current.handleConnectionAction();
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.current.syncTestResult).toMatchObject({
        success: false,
        kind: 'error',
        message: 'errors.connectionMixedContent',
      });
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      restoreLocation();
    }
  });

  it('stops sync before fetching when an HTTPS page has an HTTP external server configured', async () => {
    const showToast = vi.fn();
    const fetchSpy = vi.spyOn(serverAuth, 'fetchServerWithTimeout');
    const restoreLocation = mockHttpsPageLocation();

    try {
      const { result } = renderHook(() =>
        useConnectionTest({
          uploadConfig: {
            ...baseUploadConfig,
            url: 'http://airqr.pgnrd.fr:8081',
          },
          setUploadConfig: vi.fn(),
          syncBaseUrl: 'http://airqr.pgnrd.fr:8081',
          authEnabled: false,
          authorized: false,
          authStatusChecking: false,
          authConnectionError: false,
          t,
          showToast,
        })
      );

      await act(async () => {
        await result.current.performSync();
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.current.syncTestResult).toMatchObject({
        success: false,
        kind: 'error',
        message: 'errors.connectionMixedContent',
      });
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      restoreLocation();
    }
  });
});
