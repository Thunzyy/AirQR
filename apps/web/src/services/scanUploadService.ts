/**
 * Upload decoded scan packets to a server endpoint.
 */

import { isWireString, type WireValue } from '../parse/wire';
import type { ScanUploadConfig } from '../types';

function isTextBody(body: BodyInit | undefined): body is string {
  // SAFETY: BodyInit strings are primitive strings recognized by the wire helper.
  return isWireString(body as WireValue);
}
import {
  buildServerEndpoint,
  resolveFetchCredentials,
  resolveServerBaseUrl,
} from './syncUrl';
import { createLogger } from '../utils/logger';
import { getDeviceInfo } from '../utils/deviceId';
import {
  getBinaryDataSize,
  toBinaryBlob,
  type BinaryData,
} from '../utils/binaryData';
import { getScanWebSocketSyncService } from './scanWebSocketSyncService';
import {
  canOptimisticallyAttemptServerSync,
  getCachedServerAuthStatus,
  hasServerCredentials,
  isServerSyncAuthorizedSnapshot,
} from './serverAuth';

const logger = createLogger('services:scanUpload');

export interface ScanUploadPacketMeta {
  sessionId: string | null;
  filename?: string;
  isStreaming: boolean;
  resultType?: string;
  packetIndex?: number;
  chunkId?: number;
  totalChunks?: number;
  chunksCompleted?: number;
  receivedPackets?: number;
  expectedPackets?: number;
  totalPackets?: number;
  totalPacketsExact?: boolean;
  chunksSaved?: number;
}

export interface QueueScanPacketOptions {
  replay?: boolean;
}

export interface ScanUploadCompleteMeta {
  sessionId: string | null;
  filename: string;
  mimeType?: string;
  fileSize?: number;
  duration?: number;
  totalChunks?: number;
  chunksCompleted?: number;
  completedAt?: string; // Optional: use original date instead of now
}

type UploadHeaders = {
  'Content-Type'?: string;
  'X-AirQR-CSRF'?: string;
  'X-API-Key'?: string;
  Authorization?: string;
};

interface UploadTask {
  endpoint: string;
  config: ScanUploadConfig;
  attempts: number;
  headers?: UploadHeaders;
  body?: BodyInit;
  bodyString?: string;
  buildBody?: () => Promise<BodyInit>;
  failureKey: string;
  estimatedPayloadSize?: number;
  onSuccess?: () => void | Promise<void>;
  onFailure?: (error: string) => void | Promise<void>;
}

const MAX_IN_FLIGHT = 2;
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 500;
const MAX_SEEN = 5000;
const MAX_COMPLETED_SESSIONS = 500;
const RETRY_BODY_CACHE_THRESHOLD = 256 * 1024;

const queue: UploadTask[] = [];
let inFlight = 0;
const seenPackets = new Map<string, number>();
const completedSessions = new Map<string, number>();

function shouldSyncScanned(config: ScanUploadConfig): boolean {
  return Boolean(config?.enabled && (config.syncScanned ?? true));
}

function shouldSyncGenerated(config: ScanUploadConfig): boolean {
  return Boolean(config?.enabled && (config.syncGenerated ?? true));
}

function canAttemptScannedSync(config: ScanUploadConfig): boolean {
  if (!canOptimisticallyAttemptServerSync(config)) {
    return false;
  }

  if (!isServerSyncAuthorizedSnapshot(config)) {
    const cachedAuth = getCachedServerAuthStatus(config);
    logger.info('Attempting optimistic scan sync while auth status is still warming up', {
      url: config.url,
      cachedAuthEnabled: cachedAuth?.enabled ?? null,
      hasCredentials: hasServerCredentials(config),
    });
  }
  return true;
}

function buildAuthHeaders(config: ScanUploadConfig): UploadHeaders {
  const headers: UploadHeaders = {
    'Content-Type': 'application/json',
    'X-AirQR-CSRF': '1',
  };
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey;
  }
  if (config.username && config.password) {
    const token = btoa(`${config.username}:${config.password}`);
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

function hashPacket(data: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data[i];
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function pruneSeenPackets(): void {
  if (seenPackets.size <= MAX_SEEN) return;
  const excess = seenPackets.size - MAX_SEEN;
  let removed = 0;
  for (const key of seenPackets.keys()) {
    seenPackets.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

function markSessionCompleted(sessionId: string): void {
  completedSessions.set(sessionId, Date.now());
  if (completedSessions.size <= MAX_COMPLETED_SESSIONS) return;
  const excess = completedSessions.size - MAX_COMPLETED_SESSIONS;
  let removed = 0;
  for (const key of completedSessions.keys()) {
    completedSessions.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

async function sendTask(task: UploadTask): Promise<void> {
  const headers = {
    ...buildAuthHeaders(task.config),
    ...task.headers,
  };
  const body =
    task.body ??
    task.bodyString ??
    (task.buildBody ? await task.buildBody() : '');
  task.body = body;
  if (isTextBody(body)) {
    task.bodyString = body;
  }
  const payloadSize = getBodySize(body, task.estimatedPayloadSize);
  const payloadSizeMB = payloadSize / (1024 * 1024);

  logger.info(`POST ${task.endpoint}`, {
    payloadSizeKB: (payloadSize / 1024).toFixed(1),
    payloadSizeMB: payloadSizeMB.toFixed(2),
  });

  // Warn about large payloads that might fail
  if (payloadSizeMB > 10) {
    logger.warn('Large payload detected, upload may timeout or be rejected by server', {
      payloadSizeMB: payloadSizeMB.toFixed(2),
      endpoint: task.endpoint,
    });
  }

  try {
    const credentials = resolveFetchCredentials(task.endpoint);
    const response = await fetch(task.endpoint, {
      method: 'POST',
      headers,
      body,
      credentials,
      keepalive: payloadSize < 64000, // keepalive only for small payloads
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error(`Upload failed: ${response.status}`, {
        endpoint: task.endpoint,
        responseText: text,
        payloadSizeMB: payloadSizeMB.toFixed(2),
      });
      throw new Error(`Upload failed: ${response.status} - ${text || 'Unknown error'}`);
    }
    logger.info(`Upload successful`, { endpoint: task.endpoint, payloadSizeMB: payloadSizeMB.toFixed(2) });
    if (task.onSuccess) {
      try {
        await task.onSuccess();
      } catch (error) {
        logger.warn('onSuccess handler failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Upload error', {
      error: errorMessage,
      endpoint: task.endpoint,
      payloadSizeMB: payloadSizeMB.toFixed(2),
    });
    throw error;
  }
}

// Track failed uploads for debugging
const failedUploads: Map<string, { endpoint: string; payloadSize: number; lastError: string }> = new Map();

function scheduleRetry(task: UploadTask): void {
  if (task.attempts >= MAX_RETRIES) {
    logger.error('Max retries reached', { endpoint: task.endpoint, maxRetries: MAX_RETRIES });
    // Track the failure for debugging
    const payloadSize =
      task.bodyString?.length ?? task.estimatedPayloadSize ?? 0;
    const historyId = task.failureKey || 'unknown';
    const errorMessage = `Max retries (${MAX_RETRIES}) exceeded. Payload size: ${(payloadSize / (1024 * 1024)).toFixed(2)}MB`;
    failedUploads.set(historyId, {
      endpoint: task.endpoint,
      payloadSize,
      lastError: errorMessage,
    });
    logger.error('Sync failed permanently', {
      historyId,
      payloadSizeMB: (payloadSize / (1024 * 1024)).toFixed(2),
      endpoint: task.endpoint,
    });
    // Call onFailure callback if provided
    if (task.onFailure) {
      try {
        task.onFailure(errorMessage);
      } catch (err) {
        logger.warn('onFailure handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return;
  }
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** task.attempts, 10000);
  if (
    task.buildBody &&
    task.bodyString &&
    task.bodyString.length >= RETRY_BODY_CACHE_THRESHOLD
  ) {
    task.bodyString = undefined;
    if (isTextBody(task.body)) {
      task.body = undefined;
    }
  }
  logger.warn(`Retry scheduled`, { attempt: task.attempts + 1, maxRetries: MAX_RETRIES, delayMs: delay, endpoint: task.endpoint });
  setTimeout(() => {
    queue.unshift(task);
    pumpQueue();
  }, delay);
}

function getBodySize(body: BodyInit, fallback = 0): number {
  if (isTextBody(body)) {
    return body.length;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  return fallback;
}

export function getFailedUploads(): Map<string, { endpoint: string; payloadSize: number; lastError: string }> {
  return new Map(failedUploads);
}

export function clearFailedUpload(historyId: string): void {
  failedUploads.delete(historyId);
}

function pumpQueue(): void {
  if (inFlight >= MAX_IN_FLIGHT) return;
  while (queue.length > 0 && inFlight < MAX_IN_FLIGHT) {
    const task = queue.shift();
    if (!task) break;
    inFlight += 1;
    sendTask(task)
      .catch(() => {
        scheduleRetry({
          ...task,
          attempts: task.attempts + 1,
        });
      })
      .finally(() => {
        inFlight -= 1;
        pumpQueue();
      });
  }
}

export function queueScanPacket(
  packet: Uint8Array,
  meta: ScanUploadPacketMeta,
  config: ScanUploadConfig,
  options: QueueScanPacketOptions = {}
): void {
  if (!shouldSyncScanned(config)) return;
  if (!canAttemptScannedSync(config)) return;
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) return;
  if (!meta.sessionId) return;
  if (completedSessions.has(meta.sessionId)) {
    return;
  }

  const packetHash = hashPacket(packet);
  const dedupeKey = `${meta.sessionId}:${packetHash}:${packet.length}`;
  if (!options.replay && seenPackets.has(dedupeKey)) return;

  const wsAccepted = getScanWebSocketSyncService().queuePacket(
    packet,
    meta,
    {
      ...config,
      url: baseUrl,
    }
  );

  if (!wsAccepted) {
    logger.warn('Scan WebSocket packet transport unavailable; skipping packet upload', {
      sessionId: meta.sessionId,
      packetIndex: meta.packetIndex,
    });
    return;
  }

  if (!options.replay) {
    seenPackets.set(dedupeKey, Date.now());
    pruneSeenPackets();
  }
}

export function queueScanComplete(
  fileData: BinaryData,
  meta: ScanUploadCompleteMeta,
  config: ScanUploadConfig,
  onSuccess?: () => void | Promise<void>,
  onFailure?: (error: string) => void | Promise<void>
): void {
  if (!shouldSyncScanned(config)) return;
  if (!canAttemptScannedSync(config)) return;
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) return;
  if (!meta.sessionId) return;
  const sessionId = meta.sessionId;
  const completedAt = meta.completedAt || new Date().toISOString();
  const fileSize = getBinaryDataSize(fileData);
  const normalizedConfig = {
    ...config,
    url: baseUrl,
  };
  const completeMeta: ScanUploadCompleteMeta = {
    ...meta,
    completedAt,
    fileSize,
  };
  const completeSuccess = async () => {
    markSessionCompleted(sessionId);
    if (onSuccess) {
      await onSuccess();
    }
  };

  const wsAccepted = getScanWebSocketSyncService().queueComplete(
    completeMeta,
    normalizedConfig,
    completeSuccess,
    onFailure
  );
  if (wsAccepted) {
    return;
  }

  void (async () => {
    try {
      const deviceInfo = getDeviceInfo();
      const body = toBinaryBlob(fileData, meta.mimeType || 'application/octet-stream');
      const endpoint = new URL(buildServerEndpoint(baseUrl, 'api/scan/complete'));
      endpoint.searchParams.set('sessionId', sessionId);
      endpoint.searchParams.set('filename', meta.filename);
      endpoint.searchParams.set('completedAt', completedAt);
      endpoint.searchParams.set('fileSize', String(fileSize));
      if (meta.mimeType) {
        endpoint.searchParams.set('mimeType', meta.mimeType);
      }
      if (meta.duration !== undefined) {
        endpoint.searchParams.set('duration', String(meta.duration));
      }
      if (meta.totalChunks !== undefined) {
        endpoint.searchParams.set('totalChunks', String(meta.totalChunks));
      }
      if (meta.chunksCompleted !== undefined) {
        endpoint.searchParams.set('chunksCompleted', String(meta.chunksCompleted));
      }
      if (deviceInfo.deviceId) {
        endpoint.searchParams.set('deviceId', deviceInfo.deviceId);
      }
      if (deviceInfo.deviceName) {
        endpoint.searchParams.set('deviceName', deviceInfo.deviceName);
      }

      queue.unshift({
        endpoint: endpoint.toString(),
        config: normalizedConfig,
        attempts: 0,
        headers: {
          'Content-Type': body.type || 'application/octet-stream',
        },
        body,
        failureKey: sessionId,
        estimatedPayloadSize: body.size,
        onSuccess: completeSuccess,
        onFailure,
      });
      pumpQueue();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to prepare scan completion upload';
      logger.error('Failed to prepare scan completion upload', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      if (onFailure) {
        void onFailure(message);
      }
    }
  })();
}

export function queueHistoryItem(
  fileData: BinaryData,
  meta: {
    historyId: string;
    title: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    totalFrames?: number;
    minFrames?: number;
    chunkMinFrames?: number[];
    createdAt?: string;
    updatedAt?: string;
  },
  config: ScanUploadConfig,
  onSuccess?: () => void | Promise<void>,
  onFailure?: (error: string) => void | Promise<void>
): void {
  const fileSize = getBinaryDataSize(fileData);

  logger.info(`[queueHistoryItem] Called`, {
    historyId: meta.historyId,
    title: meta.title,
    mimeType: meta.mimeType,
    fileDataLength: fileSize,
    configEnabled: config.enabled,
    syncGenerated: config.syncGenerated,
    serverUrl: config.url,
  });

  if (!shouldSyncGenerated(config)) {
    logger.info(`[queueHistoryItem] Skipping - shouldSyncGenerated is false`);
    return;
  }
  if (!isServerSyncAuthorizedSnapshot(config)) {
    logger.info(`[queueHistoryItem] Skipping - server auth not ready`);
    return;
  }
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    logger.info(`[queueHistoryItem] Skipping - no valid baseUrl from ${config.url}`);
    return;
  }
  if (!meta.historyId) {
    logger.info(`[queueHistoryItem] Skipping - no historyId`);
    return;
  }

  const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
  logger.info(`[queueHistoryItem] Creating payload`, {
    historyId: meta.historyId,
    fileSizeMB,
  });

  void (async () => {
    try {
      const body = toBinaryBlob(fileData, meta.mimeType || 'application/octet-stream');
      const endpoint = new URL(buildServerEndpoint(baseUrl, 'api/history/item'));
      endpoint.searchParams.set('historyId', meta.historyId);
      endpoint.searchParams.set('title', meta.title);
      if (meta.filename) {
        endpoint.searchParams.set('filename', meta.filename);
      }
      if (meta.mimeType) {
        endpoint.searchParams.set('mimeType', meta.mimeType);
      }
      endpoint.searchParams.set('size', String(meta.size ?? fileSize));
      if (meta.totalFrames !== undefined) {
        endpoint.searchParams.set('totalFrames', String(meta.totalFrames));
      }
      if (meta.minFrames !== undefined) {
        endpoint.searchParams.set('minFrames', String(meta.minFrames));
      }
      if (meta.chunkMinFrames !== undefined) {
        endpoint.searchParams.set('chunkMinFrames', JSON.stringify(meta.chunkMinFrames));
      }
      if (meta.createdAt) {
        endpoint.searchParams.set('createdAt', meta.createdAt);
      }
      if (meta.updatedAt) {
        endpoint.searchParams.set('updatedAt', meta.updatedAt);
      }

      logger.info(`[queueHistoryItem] Queued for upload`, {
        historyId: meta.historyId,
        fileSizeMB,
        endpoint: endpoint.toString(),
      });

      queue.push({
        endpoint: endpoint.toString(),
        config: {
          ...config,
          url: baseUrl,
        },
        attempts: 0,
        headers: {
          'Content-Type': body.type || 'application/octet-stream',
        },
        body,
        failureKey: meta.historyId,
        estimatedPayloadSize: body.size,
        onSuccess,
        onFailure,
      });
      pumpQueue();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to prepare history upload';
      logger.error('[queueHistoryItem] Failed to prepare payload', {
        error: error instanceof Error ? error.message : String(error),
        historyId: meta.historyId,
      });
      if (onFailure) {
        void onFailure(message);
      }
    }
  })();
}

/**
 * Delete a scan session (packets) from the server after successful completion.
 * This cleans up server storage once the complete file has been uploaded.
 */
export async function deleteServerSessionAfterComplete(
  sessionId: string,
  config: ScanUploadConfig
): Promise<void> {
  if (!shouldSyncScanned(config)) return;
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) return;

  try {
    const headers = buildAuthHeaders(config);
    const endpoint = buildServerEndpoint(
      baseUrl,
      `api/scan/session/${encodeURIComponent(sessionId)}`
    );
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers,
      credentials: resolveFetchCredentials(endpoint),
    });

    if (response.ok) {
      logger.info('Cleaned up server packets', { sessionId });
    } else {
      logger.warn('Failed to cleanup server session', { sessionId, status: response.status });
    }
  } catch (error) {
    logger.warn('Failed to cleanup server session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
