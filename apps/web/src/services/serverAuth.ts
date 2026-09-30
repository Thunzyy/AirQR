import {
  asWireBoolean,
  asWireObject,
  asWireString,
  type WireValue,
} from '../parse/wire';
import type { ScanUploadConfig } from '../types';
import {
  buildServerEndpoint,
  resolveFetchCredentials,
  resolveServerBaseUrl,
} from './syncUrl';
import { createLogger } from '../utils/logger';
import {
  fetchServerWithTimeout,
  isServerRequestTimeoutError,
  SERVER_FETCH_TIMEOUT_MS,
  ServerRequestTimeoutError,
} from './serverFetch';

const logger = createLogger('services:serverAuth');
const AUTH_STATUS_TTL_MS = 15_000;
const authStatusListeners = new Set<() => void>();
const loginRequestCache = new Map<string, Promise<ServerAuthStatus>>();

export interface ServerAuthStatus {
  enabled: boolean;
  authorized: boolean;
  username?: string | null;
}

type CachedAuthStatus = {
  value?: ServerAuthStatus;
  promise?: Promise<ServerAuthStatus>;
  expiresAt: number;
};

const authStatusCache = new Map<string, CachedAuthStatus>();

export {
  fetchServerWithTimeout,
  isServerRequestTimeoutError,
  ServerRequestTimeoutError,
};
export const SERVER_REQUEST_TIMEOUT_MS = SERVER_FETCH_TIMEOUT_MS;

export type ServerAuthHeaders = {
  'X-AirQR-CSRF': string;
  'Content-Type'?: string;
  'X-API-Key'?: string;
  Authorization?: string;
};

export function buildServerAuthHeaders(
  config: Pick<ScanUploadConfig, "apiKey" | "username" | "password">,
  contentType?: string,
  options: { includeBasic?: boolean; includeApiKey?: boolean } = {}
): ServerAuthHeaders {
  const includeBasic = options.includeBasic ?? true;
  const includeApiKey = options.includeApiKey ?? true;
  const headers: ServerAuthHeaders = {
    'X-AirQR-CSRF': '1',
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (includeApiKey && config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }
  if (includeBasic && config.username && config.password) {
    const token = btoa(`${config.username}:${config.password}`);
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

function buildCacheKey(config: ScanUploadConfig, baseUrl: string): string {
  return buildCacheKeyFromAuth(baseUrl, {
    apiKey: config.apiKey,
    username: config.username,
    password: config.password,
  });
}

function buildCacheKeyFromAuth(
  baseUrl: string,
  auth: Pick<ScanUploadConfig, 'apiKey' | 'username' | 'password'>
): string {
  return [
    baseUrl,
    auth.apiKey || '',
    auth.username || '',
    auth.password || '',
  ].join('::');
}

function resolveEffectiveAuth(
  config: Pick<ScanUploadConfig, 'apiKey' | 'username' | 'password'>,
  credentials?: { username?: string; password?: string }
): Pick<ScanUploadConfig, 'apiKey' | 'username' | 'password'> {
  return {
    apiKey: config.apiKey,
    username: credentials?.username ?? config.username,
    password: credentials?.password ?? config.password,
  };
}

function normalizeAuthStatus(payload: WireValue): ServerAuthStatus {
  const record = asWireObject(payload);
  const username = asWireString(record.username);

  return {
    enabled: asWireBoolean(record.enabled) === true || record.enabled === 1,
    authorized: record.authorized !== false,
    username: username && username.length > 0 ? username : null,
  };
}

export function clearServerAuthStatusCache(): void {
  authStatusCache.clear();
  for (const listener of authStatusListeners) {
    listener();
  }
}

export const resetServerAuthStatusCache = clearServerAuthStatusCache;

export function subscribeServerAuthStatus(listener: () => void): () => void {
  authStatusListeners.add(listener);
  return () => {
    authStatusListeners.delete(listener);
  };
}

export function hasServerCredentials(config: ScanUploadConfig): boolean {
  return Boolean(config.apiKey || (config.username && config.password));
}

export function getCachedServerAuthStatus(
  config: ScanUploadConfig
): ServerAuthStatus | null {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    return null;
  }

  const cacheKey = buildCacheKey(config, baseUrl);
  const cached = authStatusCache.get(cacheKey);
  if (!cached?.value || cached.expiresAt <= Date.now()) {
    return null;
  }
  return cached.value;
}

export function isServerSyncAuthorizedSnapshot(
  config: ScanUploadConfig
): boolean {
  if (!config.enabled || !config.url) {
    return false;
  }

  const cached = getCachedServerAuthStatus(config);
  if (cached) {
    return !cached.enabled || cached.authorized;
  }

  return hasServerCredentials(config);
}

export function canOptimisticallyAttemptServerSync(
  config: ScanUploadConfig
): boolean {
  if (!config.enabled || !config.url) {
    return false;
  }

  if (isServerSyncAuthorizedSnapshot(config)) {
    return true;
  }

  const cached = getCachedServerAuthStatus(config);
  if (cached && cached.enabled && !cached.authorized && !hasServerCredentials(config)) {
    return false;
  }

  return true;
}

export async function fetchServerAuthStatus(
  config: ScanUploadConfig,
  options: { force?: boolean } = {}
): Promise<ServerAuthStatus> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const cacheKey = buildCacheKey(config, baseUrl);
  const cached = authStatusCache.get(cacheKey);
  const now = Date.now();
  if (!options.force && cached?.value && cached.expiresAt > now) {
    return cached.value;
  }
  if (!options.force && cached?.promise) {
    return cached.promise;
  }

  const endpoint = buildServerEndpoint(baseUrl, 'api/auth/status');
  const request = (async () => {
    const response = await fetchServerWithTimeout(endpoint, {
      // Saved Basic credentials are the reliable auth proof for local/cross-origin AirQR clients.
      // Cookie sessions may be unavailable there because credentials are intentionally omitted.
      headers: buildServerAuthHeaders(config),
      credentials: resolveFetchCredentials(endpoint),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Auth status fetch failed: ${response.status}`);
    }

    const status = normalizeAuthStatus(await response.json());
    authStatusCache.set(cacheKey, {
      value: status,
      expiresAt: Date.now() + AUTH_STATUS_TTL_MS,
    });
    return status;
  })();

  authStatusCache.set(cacheKey, {
    promise: request,
    expiresAt: now + AUTH_STATUS_TTL_MS,
  });

  try {
    return await request;
  } catch (error) {
    authStatusCache.delete(cacheKey);
    throw error;
  }
}

export async function ensureServerSyncReady(
  config: ScanUploadConfig
): Promise<boolean> {
  if (!config.enabled || !config.url) {
    return false;
  }

  try {
    let status = await fetchServerAuthStatus(config);
    if (!status.enabled || status.authorized) {
      return true;
    }

    if (config.username && config.password) {
      await loginToServerSession(config, {
        username: config.username,
        password: config.password,
      });
      status = await fetchServerAuthStatus(config, { force: true });
      return !status.enabled || status.authorized;
    }

    return false;
  } catch (error) {
    logger.warn('Sync readiness check failed', {
      error: error instanceof Error ? error.message : String(error),
      url: config.url,
    });
    return false;
  }
}

export const canUseServerSync = ensureServerSyncReady;

export async function loginToServerSession(
  config: ScanUploadConfig,
  credentials?: { username?: string; password?: string }
): Promise<ServerAuthStatus> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const effectiveAuth = resolveEffectiveAuth(config, credentials);
  const username = effectiveAuth.username;
  const password = effectiveAuth.password;
  if (!username || !password) {
    throw new Error('Missing credentials');
  }

  const cacheKey = buildCacheKeyFromAuth(baseUrl, effectiveAuth);
  const cached = authStatusCache.get(cacheKey);
  if (cached?.value && cached.expiresAt > Date.now() && cached.value.authorized) {
    return cached.value;
  }

  const inFlightRequest = loginRequestCache.get(cacheKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const endpoint = buildServerEndpoint(baseUrl, 'api/auth/login');
  const request = (async () => {
    const response = await fetchServerWithTimeout(endpoint, {
      method: 'POST',
      headers: buildServerAuthHeaders(config, 'application/json', {
        includeBasic: false,
      }),
      credentials: resolveFetchCredentials(endpoint),
      body: JSON.stringify({ username, password, remember: true }),
    });

    if (!response.ok) {
      throw new Error(`Login failed: ${response.status}`);
    }

    const status = normalizeAuthStatus(await response.json());
    authStatusCache.set(cacheKey, {
      value: status,
      expiresAt: Date.now() + AUTH_STATUS_TTL_MS,
    });
    for (const listener of authStatusListeners) {
      listener();
    }
    return status;
  })();

  loginRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    loginRequestCache.delete(cacheKey);
  }
}

export async function logoutFromServerSession(
  config: ScanUploadConfig
): Promise<void> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const endpoint = buildServerEndpoint(baseUrl, 'api/auth/logout');
  const response = await fetchServerWithTimeout(endpoint, {
    method: 'POST',
    headers: buildServerAuthHeaders(config, 'application/json', {
      includeBasic: false,
    }),
    credentials: resolveFetchCredentials(endpoint),
  });

  if (!response.ok) {
    throw new Error(`Logout failed: ${response.status}`);
  }

  authStatusCache.delete(buildCacheKey(config, baseUrl));
  for (const listener of authStatusListeners) {
    listener();
  }
}

export async function updateServerCredentials(
  config: ScanUploadConfig,
  credentials: { username: string; password: string }
): Promise<ServerAuthStatus> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const username = credentials.username.trim();
  const password = credentials.password;
  if (!username || !password) {
    throw new Error('Missing credentials');
  }

  const endpoint = buildServerEndpoint(baseUrl, 'api/auth/credentials');
  const response = await fetchServerWithTimeout(endpoint, {
    method: 'POST',
    headers: buildServerAuthHeaders(config, 'application/json'),
    credentials: resolveFetchCredentials(endpoint),
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Credentials update failed: ${response.status}`);
  }

  const status = normalizeAuthStatus(await response.json());
  clearServerAuthStatusCache();
  const cacheKey = buildCacheKeyFromAuth(baseUrl, {
    apiKey: config.apiKey,
    username,
    password,
  });
  authStatusCache.set(cacheKey, {
    value: status,
    expiresAt: Date.now() + AUTH_STATUS_TTL_MS,
  });
  for (const listener of authStatusListeners) {
    listener();
  }
  return status;
}
