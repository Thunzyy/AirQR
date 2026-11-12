const DEV_SERVICE_WORKER_RELOAD_KEY = 'airqr:service-worker-cleanup-reload';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

type BrowserLocationLike = Pick<Location, 'hostname' | 'port'>;

type ServiceWorkerRegistrationLike = Pick<ServiceWorkerRegistration, 'unregister'>;

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'controller' | 'getRegistrations'>;

type CacheStorageLike = Pick<CacheStorage, 'keys' | 'delete'>;

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

interface CleanupServiceWorkersOptions {
  cacheStorage?: CacheStorageLike;
  reloader?: () => void;
  serviceWorker: ServiceWorkerContainerLike;
  sessionStorage?: StorageLike;
}

export interface CleanupServiceWorkersResult {
  didDeleteAnyCache: boolean;
  didUnregisterAny: boolean;
  reloaded: boolean;
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

export function isIpLiteralHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '');
  if (!normalized) {
    return false;
  }

  if (normalized.includes(':')) {
    return /^[0-9a-f:]+$/i.test(normalized);
  }

  const parts = normalized.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function shouldDisableServiceWorkerForLocation(
  location: BrowserLocationLike,
): boolean {
  return (
    isLoopbackHostname(location.hostname) ||
    isIpLiteralHostname(location.hostname) ||
    location.port === '5173'
  );
}

async function unregisterAllServiceWorkers(
  registrations: readonly ServiceWorkerRegistrationLike[],
): Promise<boolean> {
  const unregisterResults = await Promise.all(
    registrations.map(async (registration) => {
      try {
        return await registration.unregister();
      } catch {
        return false;
      }
    }),
  );

  return unregisterResults.some(Boolean);
}

async function clearAllCaches(cacheStorage?: CacheStorageLike): Promise<boolean> {
  if (!cacheStorage) {
    return false;
  }

  try {
    const keys = await cacheStorage.keys();
    if (keys.length === 0) {
      return false;
    }

    const deleteResults = await Promise.all(
      keys.map(async (key) => {
        try {
          return await cacheStorage.delete(key);
        } catch {
          return false;
        }
      }),
    );

    return deleteResults.some(Boolean);
  } catch {
    return false;
  }
}

export async function cleanupServiceWorkers({
  cacheStorage,
  reloader,
  serviceWorker,
  sessionStorage,
}: CleanupServiceWorkersOptions): Promise<CleanupServiceWorkersResult> {
  let didUnregisterAny = false;
  let didDeleteAnyCache = false;

  try {
    const registrations = await serviceWorker.getRegistrations();
    didUnregisterAny = await unregisterAllServiceWorkers(registrations);
  } catch {
    didUnregisterAny = false;
  }

  didDeleteAnyCache = await clearAllCaches(cacheStorage);

  const didChangeAnything = didUnregisterAny || didDeleteAnyCache;
  const hasController = serviceWorker.controller != null;
  const hasReloadGuard =
    sessionStorage?.getItem(DEV_SERVICE_WORKER_RELOAD_KEY) === '1';

  if (didChangeAnything && hasController && reloader && !hasReloadGuard) {
    sessionStorage?.setItem(DEV_SERVICE_WORKER_RELOAD_KEY, '1');
    reloader();
    return {
      didDeleteAnyCache,
      didUnregisterAny,
      reloaded: true,
    };
  }

  if (!didChangeAnything || !hasController) {
    sessionStorage?.removeItem(DEV_SERVICE_WORKER_RELOAD_KEY);
  }

  return {
    didDeleteAnyCache,
    didUnregisterAny,
    reloaded: false,
  };
}
