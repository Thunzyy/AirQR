import { describe, expect, it, vi } from 'vitest';

import {
  configureSyncHttpProxy,
  forwardHttpProxyHeaders,
  configureSyncWebSocketProxy,
  extractWebSocketProxyLogContext,
  forwardWebSocketAuthHeaders,
  resolveSyncProxyTargets,
} from '../vite.syncProxy';

describe('vite.syncProxy', () => {
  it('defaults to the unified local dev target when no env override is provided', () => {
    expect(resolveSyncProxyTargets({})).toEqual({
      syncServerTarget: 'http://127.0.0.1:8081',
      syncServerWsTarget: 'ws://127.0.0.1:8081',
    });
  });

  it('derives the websocket proxy target from an explicit HTTP target when no WS override is provided', () => {
    expect(
      resolveSyncProxyTargets({
        VITE_SYNC_SERVER_URL: 'http://127.0.0.1:8081',
      }),
    ).toEqual({
      syncServerTarget: 'http://127.0.0.1:8081',
      syncServerWsTarget: 'ws://127.0.0.1:8081',
    });
  });

  it('derives a secure websocket target from an HTTPS server origin', () => {
    expect(
      resolveSyncProxyTargets({
        VITE_SYNC_SERVER_URL: 'https://sync.example.com:9443',
      }),
    ).toEqual({
      syncServerTarget: 'https://sync.example.com:9443',
      syncServerWsTarget: 'wss://sync.example.com:9443',
    });
  });

  it('keeps an explicit websocket override for split internal dev setups', () => {
    expect(
      resolveSyncProxyTargets({
        VITE_SYNC_SERVER_URL: 'http://127.0.0.1:8081',
        VITE_SYNC_WS_URL: 'ws://127.0.0.1:8082',
      }),
    ).toEqual({
      syncServerTarget: 'http://127.0.0.1:8081',
      syncServerWsTarget: 'ws://127.0.0.1:8082',
    });
  });

  it('prefers the explicit events websocket override when both legacy and explicit vars are set', () => {
    expect(
      resolveSyncProxyTargets({
        VITE_SYNC_SERVER_URL: 'http://127.0.0.1:8081',
        VITE_SYNC_WS_URL: 'ws://127.0.0.1:8082',
        VITE_SYNC_EVENTS_WS_TARGET: 'ws://127.0.0.1:8090',
      }),
    ).toEqual({
      syncServerTarget: 'http://127.0.0.1:8081',
      syncServerWsTarget: 'ws://127.0.0.1:8090',
    });
  });

  it('forwards cookie and auth headers to websocket upstream requests', () => {
    const setHeader = vi.fn();

    forwardWebSocketAuthHeaders(
      { setHeader },
      {
        headers: {
          cookie: 'airqr_session=session-token',
          authorization: 'Basic abc123',
          'x-api-key': 'test-key',
        },
      },
    );

    expect(setHeader).toHaveBeenCalledWith('Cookie', 'airqr_session=session-token');
    expect(setHeader).toHaveBeenCalledWith('Authorization', 'Basic abc123');
    expect(setHeader).toHaveBeenCalledWith('X-API-Key', 'test-key');
  });

  it('forwards the public host header to HTTP upstream requests', () => {
    const setHeader = vi.fn();

    forwardHttpProxyHeaders(
      { setHeader },
      {
        headers: {
          host: '192.168.1.36:5173',
        },
      },
    );

    expect(setHeader).toHaveBeenCalledWith('X-Forwarded-Host', '192.168.1.36:5173');
  });

  it('registers a websocket proxy hook that forwards auth headers', () => {
    type ProxyReq = {
      setHeader: (name: string, value: string | string[]) => void;
    };

    const listeners = new Map<
      string,
      (proxyReq: ProxyReq, req: { headers: Record<string, string | string[] | undefined> }) => void
    >();
    const proxy = {
      on: vi.fn((event: string, callback: (proxyReq: ProxyReq, req: { headers: Record<string, string | string[] | undefined> }) => void) => {
        listeners.set(event, callback);
      }),
    };

    configureSyncWebSocketProxy(proxy, {
      info: vi.fn(),
      warn: vi.fn(),
    });

    expect(proxy.on).toHaveBeenCalledTimes(3);
    expect(listeners.has('proxyReqWs')).toBe(true);
    expect(listeners.has('error')).toBe(true);
    expect(listeners.has('econnreset')).toBe(true);

    const setHeader = vi.fn();
    listeners.get('proxyReqWs')?.(
      { setHeader },
      {
        url: '/api/v1/ws/scan/session-123?connectionId=conn-1',
        headers: {
          cookie: 'airqr_session=session-token',
        },
      },
    );

    expect(setHeader).toHaveBeenCalledWith('Cookie', 'airqr_session=session-token');
  });

  it('extracts websocket proxy log context for scan channels', () => {
    expect(
      extractWebSocketProxyLogContext({
        url: '/api/v1/ws/scan/1775220640?connectionId=conn-7&deviceId=device-1',
        headers: {
          host: '192.168.1.36:5173',
          origin: 'https://192.168.1.36:5173',
        },
      }),
    ).toEqual({
      channel: 'scan',
      connectionId: 'conn-7',
      deviceId: 'device-1',
      host: '192.168.1.36:5173',
      origin: 'https://192.168.1.36:5173',
      path: '/api/v1/ws/scan/1775220640',
      sessionId: '1775220640',
      url: '/api/v1/ws/scan/1775220640?connectionId=conn-7&deviceId=device-1',
    });
  });

  it('falls back to console logging when vite passes proxy options instead of a logger', () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const proxy = {
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        listeners.set(event, callback);
      }),
    };
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      configureSyncWebSocketProxy(proxy, {
        rewriteWsOrigin: true,
      });

      listeners.get('error')?.(
        new Error('socket hang up'),
        {
          url: '/api/v1/ws/scan/1775220640?connectionId=conn-7&deviceId=device-1',
          headers: {
            host: '192.168.1.36:5173',
          },
        },
        null,
        'ws://127.0.0.1:8082',
      );

      expect(consoleWarn).toHaveBeenCalledWith(
        '[airqr][vite-ws-proxy] error',
        expect.objectContaining({
          channel: 'scan',
          connectionId: 'conn-7',
          deviceId: 'device-1',
          sessionId: '1775220640',
        }),
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('registers an HTTP proxy hook that forwards the original host', () => {
    type ProxyReq = {
      setHeader: (name: string, value: string | string[]) => void;
    };

    let listener:
      | ((proxyReq: ProxyReq, req: { headers: Record<string, string | string[] | undefined> }) => void)
      | null = null;
    const proxy = {
      on: vi.fn((event: string, callback: NonNullable<typeof listener>) => {
        expect(event).toBe('proxyReq');
        listener = callback;
      }),
    };

    configureSyncHttpProxy(proxy);

    expect(proxy.on).toHaveBeenCalledTimes(1);
    expect(listener).not.toBeNull();

    const setHeader = vi.fn();
    listener?.(
      { setHeader },
      {
        headers: {
          host: '192.168.1.36:5173',
        },
      },
    );

    expect(setHeader).toHaveBeenCalledWith('X-Forwarded-Host', '192.168.1.36:5173');
  });
});
