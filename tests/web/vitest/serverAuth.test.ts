import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureServerSyncReady,
  fetchServerAuthStatus,
  loginToServerSession,
  logoutFromServerSession,
  resetServerAuthStatusCache,
  SERVER_REQUEST_TIMEOUT_MS,
  ServerRequestTimeoutError,
  updateServerCredentials,
} from '@web/services/serverAuth';
import type { ScanUploadConfig } from '@web/types';

describe('serverAuth service', () => {
  const fetchMock = vi.fn<typeof fetch>();

  const config: ScanUploadConfig = {
    enabled: true,
    url: 'https://sync.example.com',
    apiKey: '',
    username: 'admin',
    password: 'admin',
    syncScanned: true,
    syncGenerated: true,
    autoSyncHistory: false,
  };

  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetServerAuthStatusCache();
  });

  it('sends saved Basic auth headers when probing session auth status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, authorized: true, username: 'admin' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchServerAuthStatus(config);

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (options?.headers ?? {}) as Record<string, string>;

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/auth/status');
    expect(headers.Authorization).toBe('Basic YWRtaW46YWRtaW4=');
    expect(headers['X-AirQR-CSRF']).toBe('1');
  });

  it('omits browser credentials when probing an external server with Basic auth', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, authorized: true, username: 'admin' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchServerAuthStatus({
      ...config,
      url: 'https://airqr.pgnrd.fr',
    });

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (options?.headers ?? {}) as Record<string, string>;

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://airqr.pgnrd.fr/api/auth/status');
    expect(options?.credentials).toBe('omit');
    expect(headers.Authorization).toBe('Basic YWRtaW46YWRtaW4=');
    expect(headers['X-AirQR-CSRF']).toBe('1');
  });

  it('does not probe browser-blocked HTTP external URLs with saved auth headers', async () => {
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

    try {
      await expect(
        fetchServerAuthStatus({
          ...config,
          url: 'http://192.168.1.50:8081',
        })
      ).rejects.toThrow('Mixed content');
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses same-origin browser credentials when the configured server is the current origin', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://sync.example.com',
        protocol: 'https:',
        host: 'sync.example.com',
      },
      writable: true,
      configurable: true,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, authorized: true, username: 'admin' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    try {
      await fetchServerAuthStatus(config);
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(options?.credentials).toBe('same-origin');
  });

  it('bootstraps a cookie session from saved credentials when the server requires auth', async () => {
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
      );

    await expect(ensureServerSyncReady(config)).resolves.toBe(true);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/auth/status');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/auth/login');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/api/auth/status');
  });

  it('requests a remember-me login by default when bootstrapping a server session', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          enabled: true,
          authorized: true,
          username: 'admin',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    await expect(loginToServerSession(config)).resolves.toMatchObject({
      authorized: true,
      username: 'admin',
    });

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/auth/login');
    expect(options?.body).toBe(
      JSON.stringify({
        username: 'admin',
        password: 'admin',
        remember: true,
      })
    );
    expect((options?.headers as Record<string, string>)['X-AirQR-CSRF']).toBe('1');
  });

  it('sends the CSRF header when logging out of a cookie-backed server session', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(logoutFromServerSession(config)).resolves.toBeUndefined();

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/auth/logout');
    expect((options?.headers as Record<string, string>)['X-AirQR-CSRF']).toBe('1');
  });

  it('updates server credentials through the auth credentials endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          enabled: true,
          authorized: true,
          username: 'lucas',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    await expect(
      updateServerCredentials(config, {
        username: 'lucas',
        password: 'new-password',
      })
    ).resolves.toMatchObject({
      enabled: true,
      authorized: true,
      username: 'lucas',
    });

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/auth/credentials');
    expect(options?.method).toBe('POST');
    expect((options?.headers as Record<string, string>).Authorization).toBe(
      'Basic YWRtaW46YWRtaW4='
    );
    expect(options?.body).toBe(
      JSON.stringify({
        username: 'lucas',
        password: 'new-password',
      })
    );
  });

  it('times out hanging login requests and clears the in-flight login cache', async () => {
    vi.useFakeTimers();

    fetchMock.mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener(
          'abort',
          () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      });
    });

    const firstRequest = loginToServerSession(config);
    const firstRequestAssertion = expect(firstRequest).rejects.toBeInstanceOf(
      ServerRequestTimeoutError
    );
    await vi.advanceTimersByTimeAsync(SERVER_REQUEST_TIMEOUT_MS + 50);
    await firstRequestAssertion;

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          enabled: true,
          authorized: true,
          username: 'admin',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    await expect(loginToServerSession(config)).resolves.toMatchObject({
      authorized: true,
      username: 'admin',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
