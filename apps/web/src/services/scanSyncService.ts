/**
 * Fetch history and files from the scan sync server.
 */

import {
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  isWireArray,
} from '../parse/wire';
import type { ScanUploadConfig } from '../types';
import type {
  ScanChunkState,
  ScanSessionState,
} from '../types/scanSessionState';
import {
  buildServerEndpoint,
  resolveFetchCredentials,
  resolveServerBaseUrl,
} from './syncUrl';

interface CanonicalScanStateFields {
  scanState?: ScanSessionState;
  stateVersion?: ScanSessionState['stateVersion'];
  receivedUnique?: ScanSessionState['receivedUnique'];
  decodeThreshold?: ScanSessionState['decodeThreshold'];
  decodeState?: ScanSessionState['decodeState'];
  completionPercent?: ScanSessionState['completionPercent'];
  isComplete?: ScanSessionState['isComplete'];
  fileAvailable?: ScanSessionState['fileAvailable'];
  chunksTotal?: ScanSessionState['chunksTotal'];
  chunksComplete?: ScanSessionState['chunksComplete'];
  chunksMissing?: ScanSessionState['chunksMissing'];
  chunks?: ScanChunkState[];
  assembly?: ScanSessionState['assembly'];
}

export interface ServerHistoryEntry extends CanonicalScanStateFields {
  id: string;
  origin: 'scanned' | 'generated';
  sessionId?: string;
  historyId?: string;
  filename?: string;
  title?: string;
  mimeType?: string;
  size?: number;
  completed?: boolean;
  createdAt?: string;
  updatedAt?: string;
  totalChunks?: number;
  chunksCompleted?: number;
  chunksSaved?: number;
  packetCount?: number;
  receivedPackets?: number;
  receivedCount?: number;
  expectedPackets?: number;
  totalPackets?: number;
  totalFrames?: number;
  minFrames?: number;
  chunkMinFrames?: number[];
  deviceId?: string;
  deviceName?: string;
}

export interface ServerHistoryResponse {
  entries: ServerHistoryEntry[];
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
  totalCount?: number;
}

export interface ServerHistoryOptions {
  etag?: string;
  limit?: number;
  origin?: 'scanned' | 'generated' | 'all';
  includeIncomplete?: boolean;
}

export interface ServerFileResponse {
  data: Uint8Array;
  filename?: string;
  mimeType?: string;
  size?: number;
}

export interface ServerPacketsResponse {
  sessionId: string;
  packets: Uint8Array[];
  offset: number;
  packetCount: number;
  totalCount: number;
  hasMore: boolean;
}

export interface ServerPacketFetchOptions {
  offset?: number;
  limit?: number;
}

export interface ServerSessionResponse extends CanonicalScanStateFields {
  sessionId: string;
  id?: string;
  status?: string;
  completed?: boolean;
  expectedPackets?: number;
  receivedCount?: number;
  receivedPackets?: number;
  packetCount?: number;
  totalPackets?: number;
  totalPacketsExact?: boolean;
  filename?: string;
  mimeType?: string;
  size?: number;
  filePath?: string | null;
  updatedAt?: string;
  duration?: number;
  deviceId?: string;
  deviceName?: string;
}

export interface ServerHistoryEvent extends CanonicalScanStateFields {
  type: string;
  origin?: 'scanned' | 'generated';
  sessionId?: string;
  historyId?: string;
  updatedAt?: string;
  completed?: boolean;
}

const PACKET_PAGE_CONTENT_TYPE = 'application/vnd.airqr.packet-page';
const PACKET_PAGE_MAGIC = [0x41, 0x51, 0x50, 0x4b] as const;
const PACKET_PAGE_VERSION = 1;

type ScanSyncAuthHeaders = {
  'X-AirQR-CSRF': string;
  'X-API-Key'?: string;
  Authorization?: string;
  'If-None-Match'?: string;
  'If-Modified-Since'?: string;
};

function buildAuthHeaders(config: ScanUploadConfig): ScanSyncAuthHeaders {
  const headers: ScanSyncAuthHeaders = {
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

function shouldFetchHistory(config: ScanUploadConfig): boolean {
  return Boolean(config?.enabled && config?.url);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isBinaryPacketPageResponse(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }

  return contentType.split(';', 1)[0].trim().toLowerCase() === PACKET_PAGE_CONTENT_TYPE;
}

function parseBinaryPacketPage(
  buffer: ArrayBuffer,
  sessionId: string
): ServerPacketsResponse {
  const bytes = new Uint8Array(buffer);
  const minimumHeaderLength = 17;
  if (bytes.length < minimumHeaderLength) {
    throw new Error('Invalid packet page payload');
  }

  for (let index = 0; index < PACKET_PAGE_MAGIC.length; index += 1) {
    if (bytes[index] !== PACKET_PAGE_MAGIC[index]) {
      throw new Error('Invalid packet page payload');
    }
  }

  if (bytes[4] !== PACKET_PAGE_VERSION) {
    throw new Error(`Unsupported packet page version: ${bytes[4]}`);
  }

  const view = new DataView(buffer);
  const offset = view.getUint32(5, false);
  const packetCount = view.getUint32(9, false);
  const totalCount = view.getUint32(13, false);
  const packets: Uint8Array[] = [];
  let cursor = minimumHeaderLength;

  for (let index = 0; index < packetCount; index += 1) {
    if (cursor + 4 > bytes.length) {
      throw new Error('Invalid packet page payload');
    }

    const packetLength = view.getUint32(cursor, false);
    cursor += 4;

    if (cursor + packetLength > bytes.length) {
      throw new Error('Invalid packet page payload');
    }

    packets.push(bytes.slice(cursor, cursor + packetLength));
    cursor += packetLength;
  }

  return {
    sessionId,
    packets,
    offset,
    packetCount,
    totalCount,
    hasMore: offset + packets.length < totalCount,
  };
}

export async function fetchServerHistory(
  config: ScanUploadConfig,
  options?: ServerHistoryOptions
): Promise<ServerHistoryResponse> {
  if (!shouldFetchHistory(config)) return { entries: [] };
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) return { entries: [] };

  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  if (options?.origin && options.origin !== 'all') {
    params.set('origin', options.origin);
  }
  if (options?.includeIncomplete === false) {
    params.set('includeIncomplete', '0');
  }
  const endpoint = params.toString()
    ? `${buildServerEndpoint(baseUrl, 'api/history')}?${params.toString()}`
    : buildServerEndpoint(baseUrl, 'api/history');
  const credentials = resolveFetchCredentials(endpoint);

  const headers = buildAuthHeaders(config);
  if (options?.etag) {
    headers['If-None-Match'] = options.etag;
  }

  const response = await fetch(endpoint, {
    headers,
    credentials,
    cache: 'no-store',
  });

  if (response.status === 304) {
    return {
      entries: [],
      etag: options?.etag,
      notModified: true,
    };
  }

  if (!response.ok) {
    throw new Error(`History fetch failed: ${response.status}`);
  }

  // SAFETY: /api/history returns an array of history entries.
  const data = (await response.json()) as ServerHistoryEntry[];
  const totalCountHeader = response.headers.get('X-Total-Count');
  const totalCount = totalCountHeader ? Number(totalCountHeader) : undefined;
  return {
    entries: Array.isArray(data) ? data : [],
    etag: response.headers.get('ETag') || undefined,
    lastModified: response.headers.get('Last-Modified') || undefined,
    totalCount: Number.isFinite(totalCount ?? NaN) ? totalCount : undefined,
  };
}

export async function fetchServerFile(
  config: ScanUploadConfig,
  sessionId: string
): Promise<ServerFileResponse> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const endpoint = buildServerEndpoint(
    baseUrl,
    `api/scan/session/${encodeURIComponent(sessionId)}/file`
  );
  const response = await fetch(endpoint, {
    headers: buildAuthHeaders(config),
    credentials: resolveFetchCredentials(endpoint),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`File fetch failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('Content-Type') || undefined;
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  const filename = filenameMatch?.[1];

  return {
    data: new Uint8Array(buffer),
    filename,
    mimeType: contentType || undefined,
    size: buffer.byteLength,
  };
}

export async function fetchServerHistoryFile(
  config: ScanUploadConfig,
  historyId: string
): Promise<ServerFileResponse> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const endpoint = buildServerEndpoint(
    baseUrl,
    `api/history/item/${encodeURIComponent(historyId)}/file`
  );
  const response = await fetch(endpoint, {
    headers: buildAuthHeaders(config),
    credentials: resolveFetchCredentials(endpoint),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`File fetch failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('Content-Type') || undefined;
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  const filename = filenameMatch?.[1];

  return {
    data: new Uint8Array(buffer),
    filename,
    mimeType: contentType || undefined,
    size: buffer.byteLength,
  };
}

export async function deleteServerSession(
  config: ScanUploadConfig,
  sessionId: string
): Promise<void> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const endpoint = buildServerEndpoint(baseUrl, `api/scan/session/${encodeURIComponent(sessionId)}`);
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: buildAuthHeaders(config),
    credentials: resolveFetchCredentials(endpoint),
    cache: 'no-store',
  });

  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status}`);
  }
}

export async function deleteServerHistoryItem(
  config: ScanUploadConfig,
  historyId: string
): Promise<void> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const endpoint = buildServerEndpoint(baseUrl, `api/history/item/${encodeURIComponent(historyId)}`);
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: buildAuthHeaders(config),
    credentials: resolveFetchCredentials(endpoint),
    cache: 'no-store',
  });

  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status}`);
  }
}

export async function fetchServerPackets(
  config: ScanUploadConfig,
  sessionId: string,
  options: ServerPacketFetchOptions = {}
): Promise<ServerPacketsResponse> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit =
    options.limit != null ? Math.max(1, Math.trunc(options.limit)) : null;
  const query = new URLSearchParams();
  if (offset > 0) {
    query.set('offset', String(offset));
  }
  if (limit != null) {
    query.set('limit', String(limit));
  }
  query.set('format', 'binary');

  const endpoint = buildServerEndpoint(
    baseUrl,
    `api/scan/session/${encodeURIComponent(sessionId)}/packets${
      query.size > 0 ? `?${query.toString()}` : ''
    }`
  );
  const response = await fetch(endpoint, {
    headers: {
      ...buildAuthHeaders(config),
      Accept: `${PACKET_PAGE_CONTENT_TYPE}, application/json`,
    },
    credentials: resolveFetchCredentials(endpoint),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Packets fetch failed: ${response.status}`);
  }

  if (isBinaryPacketPageResponse(response.headers.get('Content-Type'))) {
    return parseBinaryPacketPage(await response.arrayBuffer(), sessionId);
  }

  const payload = asWireObject(await response.json());
  const packetValues = isWireArray(payload.packets) ? payload.packets : [];
  const packets = packetValues.flatMap((packet) => {
    const encoded = asWireString(packet);
    return encoded ? [fromBase64(encoded)] : [];
  });
  const parsedOffset = asWireFiniteNumber(payload.offset);
  const nextOffset =
    parsedOffset !== undefined ? Math.max(0, Math.trunc(parsedOffset)) : offset;
  const parsedTotalCount = asWireFiniteNumber(payload.totalCount);
  const totalCount =
    parsedTotalCount !== undefined
      ? Math.max(0, Math.trunc(parsedTotalCount))
      : packets.length;
  const parsedPacketCount = asWireFiniteNumber(payload.packetCount);

  return {
    sessionId: asWireString(payload.sessionId) || sessionId,
    packets,
    offset: nextOffset,
    packetCount:
      parsedPacketCount !== undefined
        ? Math.max(0, Math.trunc(parsedPacketCount))
        : packets.length,
    totalCount,
    hasMore: nextOffset + packets.length < totalCount,
  };
}

export async function fetchServerSession(
  config: ScanUploadConfig,
  sessionId: string
): Promise<ServerSessionResponse | null> {
  const baseUrl = resolveServerBaseUrl(config.url);
  if (!baseUrl) {
    throw new Error('Invalid server URL');
  }

  const endpoint = buildServerEndpoint(
    baseUrl,
    `api/scan/session/${encodeURIComponent(sessionId)}`
  );
  const response = await fetch(endpoint, {
    headers: buildAuthHeaders(config),
    credentials: resolveFetchCredentials(endpoint),
    cache: 'no-store',
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Session fetch failed: ${response.status}`);
  }

  // SAFETY: /api/scan/session/:id returns a ServerSessionResponse object.
  const payload = (await response.json()) as ServerSessionResponse;
  return payload;
}
