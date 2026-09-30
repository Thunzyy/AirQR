import {
  asWireString,
  globalHas,
  isWireArray,
  isWireBoolean,
  isWireNumber,
  isWireObject,
  isWireString,
  type JsonObject,
  type JsonValue,
  type WireValue,
} from '../parse/wire';
import type { ScanUploadConfig } from '../types';
import type { MultiScanDiagnosticsSnapshot } from './multiScanDiagnostics';
import {
  buildServerEndpoint,
  resolveFetchCredentials,
  resolveServerBaseUrl,
} from './syncUrl';
import { createLogger } from '../utils/logger';

const logger = createLogger('services:scanDebugTelemetry');

const SENSITIVE_KEYS = new Set([
  'apiKey',
  'authorization',
  'cookie',
  'headers',
  'password',
  'packet',
  'packetBase64',
  'packets',
  'secret',
  'token',
]);
const SENSITIVE_KEYS_NORMALIZED = new Set(
  Array.from(SENSITIVE_KEYS, (key) => key.toLowerCase())
);

const TOP_LEVEL_ALLOWED_KEYS = new Set([
  'at',
  'authSnapshot',
  'history',
  'online',
  'progressDiagnostics',
  'scanner',
  'server',
  'sessionId',
  'transport',
  'visibilityState',
]);

export function hasScanDebugShortcut(params: URLSearchParams): boolean {
  return params.has('Debug');
}

type DebugAuthHeaders = {
  'Content-Type': string;
  'X-AirQR-CSRF': string;
  'X-API-Key'?: string;
  Authorization?: string;
};

function toBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`;
  if (!globalHas('btoa')) {
    return '';
  }
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function buildAuthHeaders(config: ScanUploadConfig): DebugAuthHeaders {
  const headers: DebugAuthHeaders = {
    'Content-Type': 'application/json',
    'X-AirQR-CSRF': '1',
  };

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }
  if (config.username && config.password) {
    const token = toBasicAuth(config.username, config.password);
    if (token) {
      headers.Authorization = `Basic ${token}`;
    }
  }
  return headers;
}

function sanitizeValue(value: WireValue | undefined): JsonValue {
  if (value === null || isWireBoolean(value) || isWireString(value)) {
    return value ?? null;
  }
  if (isWireNumber(value)) {
    return value;
  }
  if (isWireArray(value)) {
    return value.slice(0, 120).map((item) => sanitizeValue(item));
  }
  if (isWireObject(value)) {
    const sanitized: { [key: string]: JsonValue } = {};
    Object.entries(value).forEach(([key, nested]) => {
      if (SENSITIVE_KEYS_NORMALIZED.has(key.toLowerCase())) {
        return;
      }
      sanitized[key] = sanitizeValue(nested);
    });
    return sanitized;
  }
  return asWireString(value) ?? String(value ?? '');
}

export function isScanDebugUploadEnabled(): boolean {
  if (!globalHas('window')) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return (
    hasScanDebugShortcut(params) ||
    (params.get('scanDebug') === '1' && params.get('debugUpload') === '1')
  );
}

export function sanitizeScanDebugSnapshot(
  snapshot: Partial<MultiScanDiagnosticsSnapshot> & { sessionId?: string | null }
): JsonObject {
  const sanitized: { [key: string]: JsonValue } = {};
  Object.entries(snapshot).forEach(([key, value]) => {
    if (
      !TOP_LEVEL_ALLOWED_KEYS.has(key) ||
      SENSITIVE_KEYS_NORMALIZED.has(key.toLowerCase())
    ) {
      return;
    }
    // SAFETY: diagnostic snapshot fields are JSON-serializable wire values.
    sanitized[key] = sanitizeValue(value as WireValue);
  });
  if (snapshot.sessionId) {
    sanitized.sessionId = snapshot.sessionId;
  }
  return sanitized;
}

export async function uploadScanDebugSnapshot(
  snapshot: Partial<MultiScanDiagnosticsSnapshot> & { sessionId?: string | null },
  config: ScanUploadConfig
): Promise<boolean> {
  if (!config.enabled || !config.url || !snapshot.sessionId) {
    return false;
  }

  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    return false;
  }

  try {
    const endpoint = buildServerEndpoint(
      baseUrl,
      `api/debug/scan-sessions/${encodeURIComponent(snapshot.sessionId)}/snapshots`
    );
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildAuthHeaders(config),
      credentials: resolveFetchCredentials(endpoint),
      cache: 'no-store',
      body: JSON.stringify(sanitizeScanDebugSnapshot(snapshot)),
    });

    return response.ok;
  } catch (error) {
    logger.debug('Failed to upload scan debug snapshot', {
      error: error instanceof Error ? error.message : String(error),
      sessionId: snapshot.sessionId,
    });
    return false;
  }
}
