import { globalHas } from '../parse/wire';

export type ServerAccessMode = 'same-origin' | 'external';

const SAME_ORIGIN_ALIASES = new Set(['', '/', 'self', 'same-origin']);

export class MixedContentServerUrlError extends Error {
  constructor(baseUrl: string) {
    super(`Mixed content server URL blocked: ${baseUrl}`);
    this.name = 'MixedContentServerUrlError';
  }
}

function getWindowOrigin(): string | null {
  if (globalHas('window') && window.location?.origin) {
    return window.location.origin;
  }
  return null;
}

function getWindowHostname(): string | null {
  if (!globalHas('window') || !window.location) {
    return null;
  }

  if (window.location.hostname) {
    return window.location.hostname;
  }

  if (window.location.origin) {
    try {
      return new URL(window.location.origin).hostname;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeRawServerUrl(rawUrl: string): string {
  return rawUrl.trim();
}

function isSameOriginAlias(rawUrl: string): boolean {
  return SAME_ORIGIN_ALIASES.has(normalizeRawServerUrl(rawUrl).toLowerCase());
}

export function resolveServerBaseUrl(rawUrl: string): string | null {
  const trimmed = normalizeRawServerUrl(rawUrl);
  if (isSameOriginAlias(trimmed)) {
    return getWindowOrigin();
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  const candidates = hasScheme ? [trimmed] : [`https://${trimmed}`, `http://${trimmed}`];

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      // Return the configured URL as-is, don't redirect to dev server
      return parsed.origin;
    } catch {
      continue;
    }
  }

  return null;
}

export function resolveServerAccessMode(rawUrl: string): ServerAccessMode {
  if (isSameOriginAlias(rawUrl)) {
    return 'same-origin';
  }

  const baseUrl = resolveServerBaseUrl(rawUrl);
  const origin = getWindowOrigin();
  if (baseUrl && origin && baseUrl === origin) {
    return 'same-origin';
  }

  return 'external';
}

export function isMixedContentBlocked(baseUrl: string): boolean {
  if (!globalHas('window') || !window.location?.protocol) {
    return false;
  }

  try {
    const url = new URL(baseUrl);
    return window.location.protocol === 'https:' && url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Build the full endpoint URL for API requests.
 *
 * HTTPS pages cannot safely call explicit HTTP sync-server origins. Keep that
 * blocked here so auth headers are never redirected to the app origin by an
 * implicit proxy fallback.
 */
export function buildServerEndpoint(baseUrl: string, path: string): string {
  if (isMixedContentBlocked(baseUrl)) {
    throw new MixedContentServerUrlError(baseUrl);
  }

  // Direct connection to server (same protocol or both insecure)
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path, normalized).toString();
}

export function resolveFetchCredentials(endpoint: string): RequestCredentials {
  if (!globalHas('window') || !window.location?.origin) {
    return 'omit';
  }

  try {
    const requestUrl = new URL(endpoint, window.location.origin);
    return requestUrl.origin === window.location.origin ? 'same-origin' : 'omit';
  } catch {
    return 'omit';
  }
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    return true;
  }
  const match172 = normalized.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const secondOctet = Number(match172[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
}

export function isLocalServerBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}

export function isLocalHttpsServerBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:' && isLocalServerBaseUrl(baseUrl);
  } catch {
    return false;
  }
}

/**
 * Return the current app origin when a legacy direct local HTTPS URL points to
 * the same device on another port. In dev and reverse-proxy deployments this
 * lets the browser reuse the already trusted app origin instead of requiring a
 * second mobile TLS exception for the sync listener.
 */
export function resolveSameOriginLocalFallback(baseUrl: string): string | null {
  const origin = getWindowOrigin();
  const pageHostname = getWindowHostname();
  if (!origin || !pageHostname || !isLocalHttpsServerBaseUrl(baseUrl)) {
    return null;
  }

  try {
    const serverUrl = new URL(baseUrl);
    if (
      serverUrl.hostname !== pageHostname ||
      serverUrl.origin === origin
    ) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
}

function shouldShowLocalHttpsCertificateHint(baseUrl: string): boolean {
  const pageHostname = getWindowHostname();
  return Boolean(
    pageHostname &&
      isPrivateHostname(pageHostname) &&
      isLocalHttpsServerBaseUrl(baseUrl)
  );
}

export function getConnectionFailureTranslationKey(baseUrl: string): string {
  if (shouldShowLocalHttpsCertificateHint(baseUrl)) {
    return 'errors.connectionFailedLocalHttps';
  }

  const mode = resolveServerAccessMode(baseUrl);
  if (mode === 'external') {
    return 'errors.connectionFailedCors';
  }

  return 'errors.connectionFailed';
}

export function getConnectionTimeoutTranslationKey(baseUrl: string): string {
  return shouldShowLocalHttpsCertificateHint(baseUrl)
    ? 'settings.connectionTimedOutLocalHttps'
    : 'settings.connectionTimedOut';
}

export function buildServerWebSocketUrl(baseUrl: string, path: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (globalHas('window')) {
      const sameOrigin = url.origin === window.location.origin;
      const mixedContent = window.location.protocol === 'https:' && url.protocol === 'http:';
      if (sameOrigin) {
        const pageWsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${pageWsProtocol}//${window.location.host}${normalizedPath}`;
      }
      if (mixedContent) {
        return null;
      }
    }

    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${wsProtocol}//${url.host}${normalizedPath}`;
  } catch {
    return null;
  }
}
