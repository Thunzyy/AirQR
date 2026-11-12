import { describe, expect, it, vi } from 'vitest';

import {
  cleanupServiceWorkers,
  isIpLiteralHostname,
  isLoopbackHostname,
  shouldDisableServiceWorkerForLocation,
} from '@web/utils/serviceWorker';

describe('service worker helpers', () => {
  it('detects loopback hostnames', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('test.localhost')).toBe(true);
    expect(isLoopbackHostname('airqr.example.com')).toBe(false);
  });

  it('detects IP literal hostnames', () => {
    expect(isIpLiteralHostname('192.168.1.100')).toBe(true);
    expect(isIpLiteralHostname('127.0.0.1')).toBe(true);
    expect(isIpLiteralHostname('[::1]')).toBe(true);
    expect(isIpLiteralHostname('airqr.example.com')).toBe(false);
  });

  it('disables service workers on loopback hosts, IP hosts, and vite dev port', () => {
    expect(
      shouldDisableServiceWorkerForLocation({ hostname: 'localhost', port: '8080' }),
    ).toBe(true);
    expect(
      shouldDisableServiceWorkerForLocation({ hostname: '192.168.1.100', port: '8081' }),
    ).toBe(true);
    expect(
      shouldDisableServiceWorkerForLocation({ hostname: '10.0.0.25', port: '5173' }),
    ).toBe(true);
    expect(
      shouldDisableServiceWorkerForLocation({ hostname: 'airqr.example.com', port: '443' }),
    ).toBe(false);
  });

  it('unregisters service workers, clears caches, and reloads once when controlled', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);
    const reloader = vi.fn();
    const getItem = vi.fn().mockReturnValue(null);
    const setItem = vi.fn();
    const removeItem = vi.fn();

    const result = await cleanupServiceWorkers({
      cacheStorage: {
        delete: deleteCache,
        keys: vi.fn().mockResolvedValue(['airqr-v2']),
      },
      reloader,
      serviceWorker: {
        controller: {} as ServiceWorker,
        getRegistrations: vi.fn().mockResolvedValue([
          { unregister } as ServiceWorkerRegistration,
        ]),
      },
      sessionStorage: { getItem, removeItem, setItem },
    });

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith('airqr-v2');
    expect(setItem).toHaveBeenCalledWith(
      'airqr:service-worker-cleanup-reload',
      '1',
    );
    expect(reloader).toHaveBeenCalledTimes(1);
    expect(removeItem).not.toHaveBeenCalled();
    expect(result).toEqual({
      didDeleteAnyCache: true,
      didUnregisterAny: true,
      reloaded: true,
    });
  });

  it('clears the reload guard once the page is no longer controlled', async () => {
    const result = await cleanupServiceWorkers({
      cacheStorage: {
        delete: vi.fn().mockResolvedValue(false),
        keys: vi.fn().mockResolvedValue([]),
      },
      reloader: vi.fn(),
      serviceWorker: {
        controller: null,
        getRegistrations: vi.fn().mockResolvedValue([]),
      },
      sessionStorage: {
        getItem: vi.fn().mockReturnValue('1'),
        removeItem: vi.fn(),
        setItem: vi.fn(),
      },
    });

    expect(result).toEqual({
      didDeleteAnyCache: false,
      didUnregisterAny: false,
      reloaded: false,
    });
  });
});
