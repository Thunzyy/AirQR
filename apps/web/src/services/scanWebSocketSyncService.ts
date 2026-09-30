import {
  asWireBoolean,
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  errorMessage,
  globalHas,
  isWireArray,
  isWireBoolean,
  isWireObject,
  isWireString,
  parseJsonText,
  type WireObject,
  type WireValue,
} from '../parse/wire';
import type { ScanUploadConfig } from '../types';
import { getDeviceInfo, type DeviceInfo } from '../utils/deviceId';
import { createLogger } from '../utils/logger';
import { buildServerWebSocketUrl, resolveServerBaseUrl } from './syncUrl';
import type {
  ScanUploadCompleteMeta,
  ScanUploadPacketMeta,
} from './scanUploadService';
import {
  clearPendingScanPacketOutboxSession,
  deletePendingScanPacketOutboxRecord,
  loadPendingScanPacketOutboxRecords,
  savePendingScanPacketOutboxRecord,
} from './scanSessionDB';

const logger = createLogger('services:scanWebSocketSync');

const WS_PROTOCOL = 'airqr-scan';
const WS_VERSION = 1;
const HEADER_SIZE = 12;
const FLAG_LAST_OF_CHUNK = 0x01;
const MAX_FATAL_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 10000;
const FATAL_RECONNECT_COOLDOWN_MS = 60000;
const DEFAULT_WINDOW_SIZE = 32;
const RESUME_CHECKPOINT_PACKET_INTERVAL = 64;
const IDLE_RESUME_CHECKPOINT_DELAY_MS = 250;
const RESUME_RESPONSE_TIMEOUT_MS = 3000;
const FLUSH_RETRY_DELAY_MS = 25;
const SOCKET_BUFFER_HIGH_WATER_MARK_BYTES = 256 * 1024;
const SOCKET_BUFFER_STALL_RECONNECT_MS = 3000;
const DEBUG_EVENT_LIMIT = 120;

interface PendingPacket {
  packetKey: string;
  packet: Uint8Array;
  packetIndex: number;
  chunkId: number;
  flags: number;
}

interface PendingComplete {
  meta: ScanUploadCompleteMeta;
  onSuccess?: () => void | Promise<void>;
  onFailure?: (error: string) => void | Promise<void>;
}

interface SessionMetadata {
  filename?: string;
  mimeType?: string;
  fileSize?: number;
  expectedPackets?: number;
  totalPackets?: number;
  totalPacketsExact?: boolean;
  totalChunks?: number;
  packetSize?: number;
}

type MaybePromise<T> = T | PromiseLike<T>;

type SessionState =
  | 'disconnected'
  | 'connecting'
  | 'awaiting-producer'
  | 'awaiting-resume'
  | 'ready';

type ResumeRange = [number, number];

interface ResumeChunkState {
  chunkId: number;
  lastContiguous: number;
  missing: ResumeRange[];
  receivedCount: number;
  targetFrameCount?: number;
}

interface ScanSyncDebugEvent {
  at: string;
  type: string;
  details?: WireObject;
}

interface ScanHelloMessage {
  type: 'hello';
  protocol: string;
  version: number;
  clientId: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

type CloseMetadata = {
  code: number | null;
  reason: string | null;
  wasClean: boolean | null;
};

type ScanSyncDebugGlobal = {
  __airqrScanSyncDebug?: {
    sessions: { [sessionId: string]: ScanSessionTransportDebugSnapshot };
    getSnapshot?: (
      sessionId?: string
    ) =>
      | ScanSessionTransportDebugSnapshot
      | { [sessionId: string]: ScanSessionTransportDebugSnapshot }
      | undefined;
  };
};

export interface ScanSessionTransportDebugSnapshot {
  sessionId: string;
  state: SessionState;
  currentConnectionId: string | null;
  queuedPackets: number;
  bufferedPackets: number;
  sentPackets: number;
  sentSinceResume: number;
  resumeRequests: number;
  resumeAcks: number;
  resumeTimeouts: number;
  checkpointRequests: number;
  reconnectAttempts: number;
  reconnectsScheduled: number;
  serverReceivedCount: number;
  socketCloses: number;
  socketErrors: number;
  socketOpens: number;
  windowSize: number;
  pendingComplete: boolean;
  lastCloseAt: string | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  lastCloseWasClean: boolean | null;
  lastConnectUrl: string | null;
  lastErrorMessage: string | null;
  lastMessageAt: string | null;
  lastMessageType: string | null;
  lastOpenAt: string | null;
  recentEvents: ScanSyncDebugEvent[];
}

function buildHelloMessage(config: ScanUploadConfig, deviceInfo: DeviceInfo): ScanHelloMessage {
  const message: ScanHelloMessage = {
    type: 'hello',
    protocol: WS_PROTOCOL,
    version: WS_VERSION,
    clientId: deviceInfo.deviceId,
  };
  if (config.apiKey) {
    message.apiKey = config.apiKey;
  }
  if (config.username) {
    message.username = config.username;
  }
  if (config.password) {
    message.password = config.password;
  }
  return message;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildBinaryFrame(
  packet: Uint8Array,
  packetIndex: number,
  chunkId: number,
  flags: number
): ArrayBuffer {
  const frame = new Uint8Array(HEADER_SIZE + packet.length);
  const view = new DataView(frame.buffer);
  view.setUint8(0, WS_VERSION);
  view.setUint8(1, flags);
  view.setUint16(2, chunkId, false);
  view.setUint32(4, packetIndex, false);
  view.setUint32(8, computeCrc32(packet), false);
  frame.set(packet, HEADER_SIZE);
  return frame.buffer;
}

function buildPacketKey(chunkId: number, packetIndex: number): string {
  return `${chunkId}:${packetIndex}`;
}

function parsePacketKey(packetKey: string): { chunkId: number; packetIndex: number } | null {
  const [chunkIdRaw, packetIndexRaw] = packetKey.split(':');
  const chunkId = Number(chunkIdRaw);
  const packetIndex = Number(packetIndexRaw);
  if (!Number.isFinite(chunkId) || !Number.isFinite(packetIndex)) {
    return null;
  }
  return {
    chunkId,
    packetIndex,
  };
}

function isPromiseLike<T>(value: MaybePromise<T>): value is PromiseLike<T> {
  if (value instanceof Promise) {
    return true;
  }
  return value !== null && value !== undefined && 'then' in Object(value);
}

function buildConnectionId(deviceId: string, sessionId: string, sequence: number): string {
  const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeDeviceId}-${safeSessionId}-${sequence}-${Date.now()}`;
}

function annotateScanWebSocketUrl(
  wsUrl: string,
  deviceId: string,
  connectionId: string,
): string {
  const url = new URL(wsUrl);
  url.searchParams.set('deviceId', deviceId);
  url.searchParams.set('connectionId', connectionId);
  return url.toString();
}

function extractCloseMetadata(event: Event | CloseEvent | WireValue): CloseMetadata {
  if (event instanceof CloseEvent) {
    return {
      code: Number.isFinite(event.code) ? event.code : null,
      reason: event.reason.length > 0 ? event.reason : null,
      wasClean: event.wasClean,
    };
  }
  if (event instanceof Event) {
    return {
      code: null,
      reason: null,
      wasClean: null,
    };
  }
  if (isWireObject(event)) {
    const reason = asWireString(event.reason);
    return {
      code: asWireFiniteNumber(event.code) ?? null,
      reason: reason && reason.length > 0 ? reason : null,
      wasClean: asWireBoolean(event.wasClean) ?? null,
    };
  }
  return {
    code: null,
    reason: null,
    wasClean: null,
  };
}

function extractErrorMessage(error: WireValue | Event): string {
  if (error instanceof Event) {
    return error.type || 'unknown_error';
  }
  if (isWireObject(error)) {
    const message = asWireString(error.message);
    if (message && message.length > 0) {
      return message;
    }
    const type = asWireString(error.type);
    if (type && type.length > 0) {
      return type;
    }
  }
  return errorMessage(error);
}

function createEmptyDebugSnapshot(sessionId: string): ScanSessionTransportDebugSnapshot {
  return {
    sessionId,
    state: 'disconnected',
    currentConnectionId: null,
    queuedPackets: 0,
    bufferedPackets: 0,
    sentPackets: 0,
    sentSinceResume: 0,
    resumeRequests: 0,
    resumeAcks: 0,
    resumeTimeouts: 0,
    checkpointRequests: 0,
    reconnectAttempts: 0,
    reconnectsScheduled: 0,
    serverReceivedCount: 0,
    socketCloses: 0,
    socketErrors: 0,
    socketOpens: 0,
    windowSize: DEFAULT_WINDOW_SIZE,
    pendingComplete: false,
    lastCloseAt: null,
    lastCloseCode: null,
    lastCloseReason: null,
    lastCloseWasClean: null,
    lastConnectUrl: null,
    lastErrorMessage: null,
    lastMessageAt: null,
    lastMessageType: null,
    lastOpenAt: null,
    recentEvents: [],
  };
}

function appendDebugEvent(
  snapshot: ScanSessionTransportDebugSnapshot,
  type: string,
  details?: WireObject
): void {
  snapshot.recentEvents.push({
    at: new Date().toISOString(),
    type,
    details,
  });
  if (snapshot.recentEvents.length > DEBUG_EVENT_LIMIT) {
    snapshot.recentEvents.splice(0, snapshot.recentEvents.length - DEBUG_EVENT_LIMIT);
  }
}

function cloneDebugSnapshot(
  snapshot: ScanSessionTransportDebugSnapshot
): ScanSessionTransportDebugSnapshot {
  return {
    ...snapshot,
    recentEvents: snapshot.recentEvents.map((event) => ({ ...event })),
  };
}

function publishDebugSnapshot(snapshot: ScanSessionTransportDebugSnapshot): void {
  // SAFETY: this module owns the debug bag attached to globalThis.
  const globalRecord = globalThis as ScanSyncDebugGlobal;
  const existing = globalRecord.__airqrScanSyncDebug;
  if (!existing) {
    globalRecord.__airqrScanSyncDebug = {
      sessions: {
        [snapshot.sessionId]: cloneDebugSnapshot(snapshot),
      },
    };
    return;
  }
  existing.sessions[snapshot.sessionId] = cloneDebugSnapshot(snapshot);
}

function clearPublishedDebugSnapshot(sessionId: string): void {
  // SAFETY: this module owns the debug bag attached to globalThis.
  const globalRecord = globalThis as ScanSyncDebugGlobal;
  if (globalRecord.__airqrScanSyncDebug?.sessions) {
    delete globalRecord.__airqrScanSyncDebug.sessions[sessionId];
  }
}

class ScanSessionTransport {
  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manualClose = false;
  private fatalReconnectPending = false;
  private browserOffline = false;
  private resumeResponseTimeout: ReturnType<typeof setTimeout> | null = null;
  private state: SessionState = 'disconnected';
  private readonly packetStore = new Map<string, PendingPacket>();
  private readonly queuedPacketKeys = new Set<string>();
  private readonly inFlightPacketKeys = new Set<string>();
  private readonly outboxWritePendingPacketKeys = new Set<string>();
  private sendQueue: string[] = [];
  private pendingComplete: PendingComplete | null = null;
  private metadata: SessionMetadata = {};
  private metaSent = false;
  private metaDirty = false;
  private resumePending = false;
  private packetsSinceResume = 0;
  private serverReceivedCount = 0;
  private windowSize = DEFAULT_WINDOW_SIZE;
  private packetAckSupported = false;
  private resumeRequestReason: 'handshake' | 'checkpoint' = 'handshake';
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private idleResumeCheckpointTimeout: ReturnType<typeof setTimeout> | null = null;
  private bufferedAmountHighSince: number | null = null;
  private readonly debugSnapshot: ScanSessionTransportDebugSnapshot;
  private readonly sessionId: string;
  private config: ScanUploadConfig;
  private connectionSequence = 0;
  private currentConnectionId: string | null = null;
  private readonly deviceInfo: DeviceInfo;
  private readonly onIdle: (sessionId: string) => void;

  constructor(
    sessionId: string,
    config: ScanUploadConfig,
    deviceInfo: DeviceInfo,
    onIdle: (sessionId: string) => void
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.deviceInfo = deviceInfo;
    this.onIdle = onIdle;
    this.debugSnapshot = createEmptyDebugSnapshot(sessionId);
    publishDebugSnapshot(this.debugSnapshot);
    this.hydrateOutbox();
  }

  updateConfig(config: ScanUploadConfig): void {
    this.config = config;
    this.recordDebugEvent('config-updated', {
      url: config.url,
      enabled: config.enabled,
    });
  }

  getDebugSnapshot(): ScanSessionTransportDebugSnapshot {
    return cloneDebugSnapshot(this.debugSnapshot);
  }

  private hydrateOutbox(): void {
    void loadPendingScanPacketOutboxRecords(this.sessionId)
      .then((records) => {
        if (records.length === 0 || this.manualClose) {
          return;
        }
        let hydratedPackets = 0;
        for (const record of records) {
          const packetKey = buildPacketKey(record.chunkId, record.packetIndex);
          if (!this.packetStore.has(packetKey)) {
            const packet: PendingPacket = {
              packetKey,
              packet: record.packet,
              packetIndex: record.packetIndex,
              chunkId: record.chunkId,
              flags: record.resultType === 'chunk_completed' ? FLAG_LAST_OF_CHUNK : 0,
            };
            this.packetStore.set(packetKey, packet);
            this.applyMetadata({
              filename: record.filename,
              expectedPackets: record.expectedPackets,
              totalPackets: record.totalPackets,
              totalPacketsExact: record.totalPacketsExact,
              totalChunks: record.totalChunks,
              packetSize: record.packetSize ?? record.packet.byteLength,
            });
            hydratedPackets += 1;
          }
          this.enqueuePacketKey(packetKey);
        }
        this.recordDebugEvent('outbox-hydrated', {
          packets: hydratedPackets,
          records: records.length,
        });
        this.ensureConnected();
        this.flush();
      })
      .catch((error) => {
        logger.warn('Failed to hydrate scan packet outbox', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: this.sessionId,
        });
        this.recordDebugEvent('outbox-hydrate-failed', {
          error: extractErrorMessage(error),
        });
      });
  }

  private persistPacketToOutboxBeforeSending(
    pendingPacket: PendingPacket,
    meta: ScanUploadPacketMeta
  ): void {
    this.outboxWritePendingPacketKeys.add(pendingPacket.packetKey);
    let result: MaybePromise<void>;
    try {
      result = savePendingScanPacketOutboxRecord({
        sessionId: this.sessionId,
        chunkId: pendingPacket.chunkId,
        packetIndex: pendingPacket.packetIndex,
        packet: pendingPacket.packet,
        filename: meta.filename,
        expectedPackets: meta.expectedPackets,
        totalPackets: meta.totalPackets,
        totalPacketsExact: meta.totalPacketsExact,
        totalChunks: meta.totalChunks,
        packetSize: pendingPacket.packet.byteLength,
        resultType: meta.resultType,
      });
    } catch (error) {
      this.outboxWritePendingPacketKeys.delete(pendingPacket.packetKey);
      logger.warn('Failed to start scan packet outbox write', {
        error: error instanceof Error ? error : String(error),
        sessionId: this.sessionId,
        packetIndex: pendingPacket.packetIndex,
        chunkId: pendingPacket.chunkId,
      });
      this.recordDebugEvent('outbox-write-failed', {
        error: extractErrorMessage(error instanceof Error ? error : String(error)),
        packetIndex: pendingPacket.packetIndex,
        chunkId: pendingPacket.chunkId,
      });
      this.enqueuePacketKey(pendingPacket.packetKey);
      this.flush();
      return;
    }

    const markReady = () => {
      this.outboxWritePendingPacketKeys.delete(pendingPacket.packetKey);
      if (!this.packetStore.has(pendingPacket.packetKey)) {
        return;
      }
      this.enqueuePacketKey(pendingPacket.packetKey);
      this.recordDebugEvent('outbox-write-ok', {
        packetIndex: pendingPacket.packetIndex,
        chunkId: pendingPacket.chunkId,
      });
      this.ensureConnected();
      this.flush();
    };

    const markFailed = (error: WireValue) => {
      this.outboxWritePendingPacketKeys.delete(pendingPacket.packetKey);
      logger.warn('Failed to persist scan packet outbox record', {
        error: errorMessage(error),
        sessionId: this.sessionId,
        packetIndex: pendingPacket.packetIndex,
        chunkId: pendingPacket.chunkId,
      });
      this.recordDebugEvent('outbox-write-failed', {
        error: extractErrorMessage(error),
        packetIndex: pendingPacket.packetIndex,
        chunkId: pendingPacket.chunkId,
      });
      if (this.packetStore.has(pendingPacket.packetKey)) {
        this.enqueuePacketKey(pendingPacket.packetKey);
        this.flush();
      }
    };

    if (isPromiseLike(result)) {
      void Promise.resolve(result)
        .then(markReady)
        .catch((error) => {
          markFailed(error instanceof Error ? error : String(error));
        });
      return;
    }
    markReady();
  }

  enqueuePacket(packet: Uint8Array, meta: ScanUploadPacketMeta): void {
    const packetIndex = Number(meta.packetIndex);
    if (!Number.isFinite(packetIndex) || packetIndex < 0) {
      logger.warn('Refusing to send scan packet without a stable packet index', {
        sessionId: this.sessionId,
        packetIndex: meta.packetIndex,
      });
      return;
    }

    const chunkId = Number.isFinite(Number(meta.chunkId)) ? Number(meta.chunkId) : 0;
    const packetKey = buildPacketKey(chunkId, packetIndex);
    this.updateMetadataFromPacket(meta, packet.length);
    const pendingPacket: PendingPacket = {
      packetKey,
      packet,
      packetIndex,
      chunkId,
      flags: meta.resultType === 'chunk_completed' ? FLAG_LAST_OF_CHUNK : 0,
    };
    this.packetStore.set(packetKey, pendingPacket);
    this.clearIdleResumeCheckpoint();
    this.recordDebugEvent('packet-queued', {
      packetIndex,
      chunkId,
      resultType: meta.resultType,
    });
    this.persistPacketToOutboxBeforeSending(pendingPacket, meta);
    this.ensureConnected();
    this.flush();
  }

  enqueueComplete(
    meta: ScanUploadCompleteMeta,
    config: ScanUploadConfig,
    onSuccess?: () => void | Promise<void>,
    onFailure?: (error: string) => void | Promise<void>
  ): boolean {
    if (!this.hasSessionData()) {
      return false;
    }

    this.config = config;
    this.updateMetadataFromComplete(meta);
    this.pendingComplete = { meta, onSuccess, onFailure };
    this.clearIdleResumeCheckpoint();
    this.recordDebugEvent('complete-queued', {
      filename: meta.filename,
    });
    this.ensureConnected();
    this.flush();
    return true;
  }

  hasSessionData(): boolean {
    return this.packetStore.size > 0 || this.serverReceivedCount > 0;
  }

  nudgeReconnect(): void {
    if (!this.hasPendingWork() || this.manualClose || this.browserOffline) {
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.state === 'disconnected') {
      this.recordDebugEvent('reconnect-nudged');
      this.ensureConnected();
      return;
    }

    if (this.state === 'ready') {
      this.recordDebugEvent('flush-nudged');
      this.flush();
    }
  }

  setOffline(isOffline: boolean): void {
    this.browserOffline = isOffline;
    if (!isOffline) {
      this.recordDebugEvent('browser-online');
      return;
    }

    this.clearScheduledFlush();
    this.clearIdleResumeCheckpoint();
    this.clearResumeResponseTimeout();
    this.recordDebugEvent('browser-offline');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
    }
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearScheduledFlush();
    this.clearIdleResumeCheckpoint();
    this.clearResumeResponseTimeout();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.state = 'disconnected';
    this.packetStore.clear();
    this.queuedPacketKeys.clear();
    this.inFlightPacketKeys.clear();
    this.outboxWritePendingPacketKeys.clear();
    this.sendQueue = [];
    this.pendingComplete = null;
    this.metadata = {};
    this.metaSent = false;
    this.metaDirty = false;
    this.resumePending = false;
    this.packetsSinceResume = 0;
    this.fatalReconnectPending = false;
    this.serverReceivedCount = 0;
    this.windowSize = DEFAULT_WINDOW_SIZE;
    this.packetAckSupported = false;
    this.bufferedAmountHighSince = null;
    this.debugSnapshot.state = this.state;
    this.debugSnapshot.queuedPackets = 0;
    this.debugSnapshot.bufferedPackets = 0;
    this.debugSnapshot.pendingComplete = false;
    this.debugSnapshot.serverReceivedCount = 0;
    this.debugSnapshot.sentSinceResume = 0;
    this.debugSnapshot.windowSize = this.windowSize;
    this.recordDebugEvent('disconnect');
    this.onIdle(this.sessionId);
  }

  private clearScheduledFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
  }

  private clearIdleResumeCheckpoint(): void {
    if (this.idleResumeCheckpointTimeout) {
      clearTimeout(this.idleResumeCheckpointTimeout);
      this.idleResumeCheckpointTimeout = null;
    }
  }

  private clearResumeResponseTimeout(): void {
    if (this.resumeResponseTimeout) {
      clearTimeout(this.resumeResponseTimeout);
      this.resumeResponseTimeout = null;
    }
  }

  private resetBufferedAmountBackpressure(): void {
    this.bufferedAmountHighSince = null;
  }

  private armResumeResponseTimeout(): void {
    this.clearResumeResponseTimeout();
    this.resumeResponseTimeout = setTimeout(() => {
      this.resumeResponseTimeout = null;
      if (
        !this.resumePending ||
        !this.hasPendingWork() ||
        this.manualClose ||
        this.browserOffline
      ) {
        return;
      }

      this.debugSnapshot.resumeTimeouts += 1;
      logger.warn('Scan WebSocket resume checkpoint stalled; forcing reconnect', {
        sessionId: this.sessionId,
        reason: this.resumeRequestReason,
        queuedPackets: this.sendQueue.length,
        bufferedPackets: this.packetStore.size,
        pendingComplete: this.pendingComplete !== null,
      });
      this.recordDebugEvent('resume-timeout', {
        reason: this.resumeRequestReason,
        queuedPackets: this.sendQueue.length,
        bufferedPackets: this.packetStore.size,
        pendingComplete: this.pendingComplete !== null,
      });

      if (this.ws) {
        try {
          this.ws.close();
          return;
        } catch (error) {
          logger.warn('Failed to close scan WebSocket after stalled resume checkpoint', {
            error: error instanceof Error ? error.message : String(error),
            sessionId: this.sessionId,
          });
        }
      }

      this.state = 'disconnected';
      this.ensureConnected();
    }, RESUME_RESPONSE_TIMEOUT_MS);
  }

  private scheduleFlush(delayMs = 0): void {
    if (this.flushTimeout) {
      return;
    }
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      this.flush();
    }, delayMs);
  }

  private scheduleFatalReconnectCooldown(): void {
    if (
      this.reconnectTimeout ||
      this.manualClose ||
      this.browserOffline ||
      !this.hasPendingWork()
    ) {
      return;
    }

    this.recordDebugEvent('fatal-reconnect-cooldown-scheduled', {
      delayMs: FATAL_RECONNECT_COOLDOWN_MS,
      reconnectAttempt: this.reconnectAttempts,
      queuedPackets: this.sendQueue.length,
    });
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.hasPendingWork() || this.manualClose || this.browserOffline) {
        return;
      }

      this.fatalReconnectPending = false;
      this.reconnectAttempts = 0;
      this.debugSnapshot.reconnectAttempts = 0;
      this.recordDebugEvent('fatal-reconnect-cooldown-fired');
      this.ensureConnected();
    }, FATAL_RECONNECT_COOLDOWN_MS);
  }

  private scheduleIdleResumeCheckpoint(): void {
    if (
      this.idleResumeCheckpointTimeout ||
      this.resumePending ||
      this.pendingComplete !== null ||
      this.sendQueue.length > 0 ||
      this.packetsSinceResume < RESUME_CHECKPOINT_PACKET_INTERVAL
    ) {
      return;
    }

    this.recordDebugEvent('resume-checkpoint-idle-scheduled', {
      delayMs: IDLE_RESUME_CHECKPOINT_DELAY_MS,
      sentSinceResume: this.packetsSinceResume,
    });
    this.idleResumeCheckpointTimeout = setTimeout(() => {
      this.idleResumeCheckpointTimeout = null;
      if (
        this.resumePending ||
        this.pendingComplete !== null ||
        this.sendQueue.length > 0 ||
        this.state !== 'ready' ||
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN ||
        this.packetsSinceResume < RESUME_CHECKPOINT_PACKET_INTERVAL
      ) {
        return;
      }

      this.recordDebugEvent('resume-checkpoint-idle-fired', {
        sentSinceResume: this.packetsSinceResume,
      });
      this.requestResumeCheckpoint();
    }, IDLE_RESUME_CHECKPOINT_DELAY_MS);
  }

  private recordDebugEvent(type: string, details?: WireObject): void {
    this.debugSnapshot.state = this.state;
    this.debugSnapshot.currentConnectionId = this.currentConnectionId;
    this.debugSnapshot.queuedPackets = this.sendQueue.length;
    this.debugSnapshot.bufferedPackets = this.packetStore.size;
    this.debugSnapshot.pendingComplete = this.pendingComplete !== null;
    this.debugSnapshot.serverReceivedCount = this.serverReceivedCount;
    this.debugSnapshot.sentSinceResume = this.packetsSinceResume;
    this.debugSnapshot.windowSize = this.windowSize;
    appendDebugEvent(this.debugSnapshot, type, details);
    publishDebugSnapshot(this.debugSnapshot);
  }

  private updateMetadataFromPacket(meta: ScanUploadPacketMeta, packetSize: number): void {
    const nextMeta: SessionMetadata = {
      filename: meta.filename || this.metadata.filename,
      expectedPackets: meta.expectedPackets ?? this.metadata.expectedPackets,
      totalPackets: meta.totalPackets ?? this.metadata.totalPackets,
      totalPacketsExact:
        meta.totalPacketsExact ?? this.metadata.totalPacketsExact,
      totalChunks: meta.totalChunks ?? this.metadata.totalChunks,
      packetSize,
    };
    this.applyMetadata(nextMeta);
  }

  private updateMetadataFromComplete(meta: ScanUploadCompleteMeta): void {
    const nextMeta: SessionMetadata = {
      filename: meta.filename || this.metadata.filename,
      mimeType: meta.mimeType || this.metadata.mimeType,
      fileSize: meta.fileSize ?? this.metadata.fileSize,
      totalChunks: meta.totalChunks ?? this.metadata.totalChunks,
    };
    this.applyMetadata(nextMeta);
  }

  private applyMetadata(nextMeta: SessionMetadata): void {
    const merged: SessionMetadata = {
      ...this.metadata,
      ...Object.fromEntries(
        Object.entries(nextMeta).filter(([, value]) => value !== undefined)
      ),
    };

    const changed =
      merged.filename !== this.metadata.filename ||
      merged.mimeType !== this.metadata.mimeType ||
      merged.fileSize !== this.metadata.fileSize ||
      merged.expectedPackets !== this.metadata.expectedPackets ||
      merged.totalPackets !== this.metadata.totalPackets ||
      merged.totalPacketsExact !== this.metadata.totalPacketsExact ||
      merged.totalChunks !== this.metadata.totalChunks ||
      merged.packetSize !== this.metadata.packetSize;

    this.metadata = merged;
    if (changed) {
      this.metaDirty = true;
    }
  }

  private ensureConnected(): void {
    if (this.browserOffline) {
      return;
    }

    if (
      this.state === 'connecting' ||
      this.state === 'awaiting-producer' ||
      this.state === 'awaiting-resume' ||
      this.state === 'ready'
    ) {
      return;
    }

    if (
      this.fatalReconnectPending &&
      this.reconnectAttempts >= MAX_FATAL_RECONNECT_ATTEMPTS
    ) {
      this.scheduleFatalReconnectCooldown();
      return;
    }

    const baseUrl = resolveServerBaseUrl(this.config.url);
    if (!baseUrl) {
      logger.error('Failed to resolve scan WebSocket base URL', {
        sessionId: this.sessionId,
        url: this.config.url,
      });
      return;
    }

    const wsUrl = buildServerWebSocketUrl(
      baseUrl,
      `/api/v1/ws/scan/${encodeURIComponent(this.sessionId)}`
    );
    if (!wsUrl) {
      logger.error('Failed to build scan WebSocket URL', {
        sessionId: this.sessionId,
        baseUrl,
      });
      return;
    }

    this.connectionSequence += 1;
    this.currentConnectionId = buildConnectionId(
      this.deviceInfo.deviceId,
      this.sessionId,
      this.connectionSequence
    );
    const annotatedWsUrl = annotateScanWebSocketUrl(
      wsUrl,
      this.deviceInfo.deviceId,
      this.currentConnectionId
    );
    this.state = 'connecting';
    this.manualClose = false;
    this.debugSnapshot.currentConnectionId = this.currentConnectionId;
    this.debugSnapshot.lastConnectUrl = annotatedWsUrl;
    this.recordDebugEvent('connect-start', {
      connectionId: this.currentConnectionId,
      url: annotatedWsUrl,
    });
    this.ws = new WebSocket(annotatedWsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.debugSnapshot.socketOpens += 1;
      this.debugSnapshot.lastOpenAt = new Date().toISOString();
      logger.info('Scan WebSocket open', {
        connectionId: this.currentConnectionId,
        queuedPackets: this.sendQueue.length,
        sessionId: this.sessionId,
        url: annotatedWsUrl,
      });
      this.recordDebugEvent('socket-open', {
        connectionId: this.currentConnectionId,
      });
      this.sendJson(buildHelloMessage(this.config, this.deviceInfo));
    };

    this.ws.onmessage = (event) => {
      this.debugSnapshot.lastMessageAt = new Date().toISOString();
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error) => {
      const errorMessage = extractErrorMessage(error);
      this.debugSnapshot.socketErrors += 1;
      this.debugSnapshot.lastErrorMessage = errorMessage;
      logger.warn('Scan WebSocket error', {
        connectionId: this.currentConnectionId,
        error: errorMessage,
        queuedPackets: this.sendQueue.length,
        sessionId: this.sessionId,
      });
      this.recordDebugEvent('socket-error', {
        connectionId: this.currentConnectionId,
        error: errorMessage,
      });
    };

    this.ws.onclose = (event) => {
      const closeMeta = extractCloseMetadata(event);
      this.ws = null;
      this.resetBufferedAmountBackpressure();
      this.clearResumeResponseTimeout();
      this.requeueInFlightPackets();
      const shouldReconnect =
        !this.manualClose &&
        !this.browserOffline &&
        (this.packetStore.size > 0 || this.pendingComplete !== null) &&
        (!this.fatalReconnectPending ||
          this.reconnectAttempts < MAX_FATAL_RECONNECT_ATTEMPTS);
      this.state = 'disconnected';
      this.debugSnapshot.state = this.state;
      this.debugSnapshot.socketCloses += 1;
      this.debugSnapshot.lastCloseAt = new Date().toISOString();
      this.debugSnapshot.lastCloseCode = closeMeta.code;
      this.debugSnapshot.lastCloseReason = closeMeta.reason;
      this.debugSnapshot.lastCloseWasClean = closeMeta.wasClean;
      logger.warn('Scan WebSocket closed', {
        bufferedPackets: this.packetStore.size,
        code: closeMeta.code,
        connectionId: this.currentConnectionId,
        queuedPackets: this.sendQueue.length,
        reason: closeMeta.reason,
        reconnect: shouldReconnect,
        reconnectAttempt: this.reconnectAttempts,
        serverReceivedCount: this.serverReceivedCount,
        sessionId: this.sessionId,
        wasClean: closeMeta.wasClean,
      });
      if (!shouldReconnect) {
        this.recordDebugEvent('socket-close', {
          code: closeMeta.code,
          connectionId: this.currentConnectionId,
          reconnect: false,
          fatalReconnectPending: this.fatalReconnectPending,
          queuedPackets: this.sendQueue.length,
          reconnectAttempt: this.reconnectAttempts,
          reason: closeMeta.reason,
          wasClean: closeMeta.wasClean,
        });
        if (
          this.fatalReconnectPending &&
          this.reconnectAttempts >= MAX_FATAL_RECONNECT_ATTEMPTS
        ) {
          this.scheduleFatalReconnectCooldown();
        }
        return;
      }
      this.reconnectAttempts += 1;
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
        RECONNECT_MAX_DELAY_MS
      );
      this.debugSnapshot.reconnectAttempts = this.reconnectAttempts;
      this.debugSnapshot.reconnectsScheduled += 1;
      this.recordDebugEvent('socket-close', {
        code: closeMeta.code,
        connectionId: this.currentConnectionId,
        reconnect: true,
        delayMs: delay,
        reconnectAttempt: this.reconnectAttempts,
        fatalReconnectPending: this.fatalReconnectPending,
        queuedPackets: this.sendQueue.length,
        reason: closeMeta.reason,
        wasClean: closeMeta.wasClean,
      });
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        this.ensureConnected();
      }, delay);
    };
  }

  private handleMessage(rawData: WireValue): void {
    if (!isWireString(rawData)) {
      return;
    }

    try {
      const message = asWireObject(parseJsonText(rawData));
      this.debugSnapshot.lastMessageType = asWireString(message.type) ?? null;
      switch (message.type) {
        case 'welcome':
          this.state = 'awaiting-producer';
          this.reconnectAttempts = 0;
          this.fatalReconnectPending = false;
          this.windowSize = normalizeWindowSize(message.windowSize);
          this.packetAckSupported = message.packetAck === true;
          this.debugSnapshot.reconnectAttempts = 0;
          this.debugSnapshot.windowSize = this.windowSize;
          this.recordDebugEvent('welcome', {
            windowSize: this.windowSize,
            packetAck: this.packetAckSupported,
          });
          this.sendJson({ type: 'claimProducer' });
          break;
        case 'producerClaimed':
          this.state = 'awaiting-resume';
          this.recordDebugEvent('producer-claimed');
          this.beginResumeHandshake();
          break;
        case 'metaAck':
        case 'metaUpdateAck':
          this.recordDebugEvent(String(message.type));
          if (this.resumePending) {
            this.requestResumeState();
          } else {
            this.flush();
          }
          break;
        case 'resumeState':
          this.clearResumeResponseTimeout();
          this.state = 'ready';
          this.resumePending = false;
          this.packetsSinceResume = 0;
          this.serverReceivedCount = Math.max(
            this.serverReceivedCount,
            parseInteger(message.receivedCount, 0),
            parseInteger(message.lastContiguous, -1) + 1
          );
          this.debugSnapshot.resumeAcks += 1;
          this.debugSnapshot.serverReceivedCount = this.serverReceivedCount;
          this.debugSnapshot.sentSinceResume = 0;
          this.recordDebugEvent('resume-state', {
            receivedCount: parseInteger(message.receivedCount, 0),
            lastContiguous: parseInteger(message.lastContiguous, -1),
            chunkCount: Array.isArray(message.chunkStates) ? message.chunkStates.length : 0,
          });
          this.rebuildSendQueueFromResume(message);
          this.flush();
          break;
        case 'packetAck':
          this.handlePacketAck(message);
          break;
        case 'completed':
          this.recordDebugEvent('completed', {
            success: Boolean(message.success),
          });
          this.handleCompleted(message);
          break;
        case 'error':
          this.recordDebugEvent('error', {
            fatal: Boolean(message.fatal),
            message: asWireString(message.message),
          });
          if (message.fatal) {
            this.failPendingComplete(
              asWireString(message.message) ?? 'Scan WebSocket error'
            );
            this.pendingComplete = null;
            this.handleFatalSocketError();
          }
          break;
        default:
          break;
      }
    } catch (error) {
      logger.error('Failed to parse scan WebSocket message', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      });
    }
  }

  private handleCompleted(message: WireObject): void {
    const pendingComplete = this.pendingComplete;
    this.pendingComplete = null;
    const success = Boolean(message.success);
    if (success) {
      void clearPendingScanPacketOutboxSession(this.sessionId).catch((error) => {
        logger.warn('Failed to clear scan packet outbox after completion', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: this.sessionId,
        });
      });
      if (pendingComplete?.onSuccess) {
        void pendingComplete.onSuccess();
      }
      this.disconnect();
      return;
    }

    const error =
      asWireString(message.message) ??
      asWireString(message.error) ??
      'Scan completion failed';
    if (pendingComplete?.onFailure) {
      void pendingComplete.onFailure(error);
    }
    this.disconnect();
  }

  private failPendingComplete(error: string): void {
    if (this.pendingComplete?.onFailure) {
      void this.pendingComplete.onFailure(error);
    }
  }

  private handleFatalSocketError(): void {
    this.clearResumeResponseTimeout();
    if (!this.ws) {
      this.state = 'disconnected';
      this.fatalReconnectPending = true;
      this.recordDebugEvent('fatal-socket-error');
      return;
    }

    try {
      this.fatalReconnectPending = true;
      this.recordDebugEvent('fatal-socket-error');
      this.ws.close();
    } catch (error) {
      logger.warn('Failed to close scan WebSocket after fatal error', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      });
      this.state = 'disconnected';
      this.recordDebugEvent('fatal-socket-close-failed');
    }
  }

  private hasPendingWork(): boolean {
    return this.packetStore.size > 0 || this.pendingComplete !== null;
  }

  private handlePacketAck(message: WireObject): void {
    const acked = message.acked;
    if (!isWireObject(acked)) {
      return;
    }
    const ackRecord = acked;
    const chunkId = parseInteger(ackRecord.chunkId, -1);
    const packetIndex = parseInteger(ackRecord.packetIndex, -1);
    if (chunkId < 0 || packetIndex < 0) {
      return;
    }

    const packetKey = buildPacketKey(chunkId, packetIndex);
    this.inFlightPacketKeys.delete(packetKey);
    this.queuedPacketKeys.delete(packetKey);
    this.sendQueue = this.sendQueue.filter((queuedKey) => queuedKey !== packetKey);
    this.packetStore.delete(packetKey);
    this.serverReceivedCount = Math.max(
      this.serverReceivedCount,
      parseInteger(message.receivedCount, this.serverReceivedCount)
    );
    this.windowSize = normalizeWindowSize(message.windowSize ?? this.windowSize);
    this.debugSnapshot.serverReceivedCount = this.serverReceivedCount;
    this.debugSnapshot.windowSize = this.windowSize;
    this.recordDebugEvent('packet-ack', {
      packetIndex,
      chunkId,
      receivedCount: this.serverReceivedCount,
      windowSize: this.windowSize,
      inFlightPackets: this.inFlightPacketKeys.size,
    });
    void deletePendingScanPacketOutboxRecord(this.sessionId, chunkId, packetIndex).catch(
      (error) => {
        logger.warn('Failed to delete ACKed scan packet outbox record', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: this.sessionId,
          packetIndex,
          chunkId,
        });
      }
    );
    this.flush();
  }

  private beginResumeHandshake(): void {
    this.resumePending = true;
    this.resumeRequestReason = 'handshake';
    this.recordDebugEvent('resume-handshake-start');
    const sentMetadata = this.sendMetadataIfNeeded();
    if (!sentMetadata) {
      this.requestResumeState();
    }
  }

  private requestResumeState(): void {
    this.debugSnapshot.resumeRequests += 1;
    this.armResumeResponseTimeout();
    this.recordDebugEvent('resume-requested');
    this.sendJson({
      type: 'resume',
      fromPacketIndex: 0,
    });
  }

  private requestResumeCheckpoint(): void {
    this.clearIdleResumeCheckpoint();
    this.resumePending = true;
    this.resumeRequestReason = 'checkpoint';
    this.debugSnapshot.checkpointRequests += 1;
    this.recordDebugEvent('resume-checkpoint-requested', {
      sentSinceResume: this.packetsSinceResume,
      queuedPackets: this.sendQueue.length,
    });
    this.requestResumeState();
  }

  private rebuildSendQueueFromResume(message: WireObject): void {
    this.inFlightPacketKeys.clear();
    this.queuedPacketKeys.clear();
    this.sendQueue = [];

    const chunkStates = normalizeChunkStates(message.chunkStates);
    if (chunkStates.size > 0) {
      const replayPackets: PendingPacket[] = [];
      let prunedAckedPackets = 0;
      let missingReplayPackets = 0;
      let unsentTailPackets = 0;

      for (const [packetKey, packet] of Array.from(this.packetStore.entries())) {
        const chunkState = chunkStates.get(packet.chunkId);
        if (!chunkState) {
          replayPackets.push(packet);
          unsentTailPackets += 1;
          continue;
        }

        if (chunkState.targetFrameCount === 0) {
          this.forgetAcknowledgedPacket(packetKey, packet);
          prunedAckedPackets += 1;
          continue;
        }

        const maxKnownPacketIndex = getResumeChunkMaxKnownPacketIndex(chunkState);
        if (packet.packetIndex <= chunkState.lastContiguous) {
          this.forgetAcknowledgedPacket(packetKey, packet);
          prunedAckedPackets += 1;
          continue;
        }

        if (packet.packetIndex <= maxKnownPacketIndex) {
          if (isPacketIndexInResumeRanges(packet.packetIndex, chunkState.missing)) {
            replayPackets.push(packet);
            missingReplayPackets += 1;
            continue;
          }

          this.forgetAcknowledgedPacket(packetKey, packet);
          prunedAckedPackets += 1;
          continue;
        }

        replayPackets.push(packet);
        unsentTailPackets += 1;
      }

      replayPackets
        .sort((left, right) => {
          if (left.chunkId !== right.chunkId) {
            return left.chunkId - right.chunkId;
          }
          return left.packetIndex - right.packetIndex;
        })
        .forEach((packet) => {
          this.enqueuePacketKey(packet.packetKey);
        });
      this.recordDebugEvent('resume-queue-rebuilt', {
        replayPackets: replayPackets.length,
        chunkStates: chunkStates.size,
        prunedAckedPackets,
        missingReplayPackets,
        unsentTailPackets,
      });
      return;
    }

    const lastContiguous = parseInteger(message.lastContiguous, -1);
    const missingRanges = normalizeMissingRanges(message.missing);
    const replayPacketKeys = new Set<string>();

    for (const [packetKey, packet] of Array.from(this.packetStore.entries())) {
      if (packet.packetIndex <= lastContiguous) {
        this.forgetAcknowledgedPacket(packetKey, packet);
      }
    }

    for (const [packetKey, packet] of this.packetStore.entries()) {
      if (packet.packetIndex > lastContiguous) {
        replayPacketKeys.add(packetKey);
      }
    }

    for (const [start, end] of missingRanges) {
      for (let packetIndex = start; packetIndex <= end; packetIndex += 1) {
        const packetKey = buildPacketKey(0, packetIndex);
        if (this.packetStore.has(packetKey)) {
          replayPacketKeys.add(packetKey);
        }
      }
    }

    Array.from(replayPacketKeys)
      .map((packetKey) => this.packetStore.get(packetKey))
      .filter((packet): packet is PendingPacket => Boolean(packet))
      .sort((left, right) => left.packetIndex - right.packetIndex)
      .forEach((packet) => {
        this.enqueuePacketKey(packet.packetKey);
      });
    this.recordDebugEvent('resume-queue-rebuilt', {
      replayPackets: replayPacketKeys.size,
      chunkStates: 0,
    });
  }

  private enqueuePacketKey(packetKey: string): void {
    if (this.outboxWritePendingPacketKeys.has(packetKey)) {
      return;
    }
    if (this.queuedPacketKeys.has(packetKey)) {
      return;
    }
    this.queuedPacketKeys.add(packetKey);
    this.sendQueue.push(packetKey);
  }

  private forgetAcknowledgedPacket(packetKey: string, packet?: PendingPacket): void {
    const resolvedPacket = packet ?? this.packetStore.get(packetKey);
    this.packetStore.delete(packetKey);
    this.queuedPacketKeys.delete(packetKey);
    this.inFlightPacketKeys.delete(packetKey);
    this.sendQueue = this.sendQueue.filter((queuedKey) => queuedKey !== packetKey);
    const parsed = resolvedPacket ?? parsePacketKey(packetKey);
    if (!parsed) {
      return;
    }
    void deletePendingScanPacketOutboxRecord(
      this.sessionId,
      parsed.chunkId,
      parsed.packetIndex
    ).catch((error) => {
      logger.warn('Failed to delete acknowledged scan packet outbox record', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
        packetKey,
      });
    });
  }

  private requeueInFlightPackets(): void {
    if (this.inFlightPacketKeys.size === 0) {
      return;
    }
    const inFlightPackets = Array.from(this.inFlightPacketKeys)
      .map((packetKey) => this.packetStore.get(packetKey))
      .filter((packet): packet is PendingPacket => Boolean(packet))
      .sort((left, right) => {
        if (left.chunkId !== right.chunkId) {
          return left.chunkId - right.chunkId;
        }
        return left.packetIndex - right.packetIndex;
      });
    this.inFlightPacketKeys.clear();
    inFlightPackets.forEach((packet) => {
      this.enqueuePacketKey(packet.packetKey);
    });
    this.recordDebugEvent('inflight-requeued', {
      packets: inFlightPackets.length,
    });
  }

  private shiftNextPacket(): PendingPacket | null {
    while (this.sendQueue.length > 0) {
      const packetKey = this.sendQueue.shift();
      if (packetKey === undefined) {
        break;
      }
      this.queuedPacketKeys.delete(packetKey);
      const packet = this.packetStore.get(packetKey);
      if (packet) {
        return packet;
      }
    }
    return null;
  }

  private handleBufferedAmountBackpressure(bufferedAmount: number): boolean {
    const now = Date.now();
    if (this.bufferedAmountHighSince === null) {
      this.bufferedAmountHighSince = now;
    }
    const stalledForMs = now - this.bufferedAmountHighSince;
    if (stalledForMs >= SOCKET_BUFFER_STALL_RECONNECT_MS) {
      this.recordDebugEvent('flush-backpressure-stalled', {
        bufferedAmount,
        queuedPackets: this.sendQueue.length,
        stalledForMs,
      });
      logger.warn('Scan WebSocket bufferedAmount stalled; forcing reconnect', {
        bufferedAmount,
        queuedPackets: this.sendQueue.length,
        sessionId: this.sessionId,
        stalledForMs,
      });
      this.resetBufferedAmountBackpressure();
      if (this.ws) {
        try {
          this.ws.close();
          return true;
        } catch (error) {
          logger.warn('Failed to close scan WebSocket after bufferedAmount stall', {
            error: error instanceof Error ? error.message : String(error),
            sessionId: this.sessionId,
          });
        }
      }
      this.state = 'disconnected';
      this.ensureConnected();
      return true;
    }

    this.recordDebugEvent('flush-backpressured', {
      bufferedAmount,
      queuedPackets: this.sendQueue.length,
      stalledForMs,
    });
    this.scheduleFlush(FLUSH_RETRY_DELAY_MS);
    return false;
  }

  private sendMetadataIfNeeded(): boolean {
    if (!this.metaDirty) {
      return false;
    }
    const type = this.metaSent ? 'metaUpdate' : 'meta';
    this.recordDebugEvent('meta-sent', {
      type,
      expectedPackets: this.metadata.expectedPackets,
      totalPackets: this.metadata.totalPackets,
      totalChunks: this.metadata.totalChunks,
    });
    this.sendJson({
      type,
      ...Object.fromEntries(
        Object.entries({
          filename: this.metadata.filename,
          mimeType: this.metadata.mimeType,
          fileSize: this.metadata.fileSize,
          expectedPackets: this.metadata.expectedPackets,
          totalPackets: this.metadata.totalPackets,
          totalPacketsExact: this.metadata.totalPacketsExact,
          totalChunks: this.metadata.totalChunks,
          packetSize: this.metadata.packetSize,
        }).filter(([, value]) => value !== undefined)
      ),
    });
    this.metaDirty = false;
    this.metaSent = true;
    return true;
  }

  private flush(): void {
    this.clearScheduledFlush();
    if (this.sendQueue.length > 0 || this.pendingComplete !== null) {
      this.clearIdleResumeCheckpoint();
    }
    if (this.state !== 'ready' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const activeSocket = this.ws;
    if (this.resumePending) {
      return;
    }

    if (this.sendMetadataIfNeeded()) {
      return;
    }

    if (this.pendingComplete && this.sendQueue.length === 0 && this.packetStore.size > 0) {
      if (this.inFlightPacketKeys.size > 0) {
        return;
      }
      this.requestResumeCheckpoint();
      return;
    }

    if (
      this.packetAckSupported &&
      this.sendQueue.length > 0 &&
      this.inFlightPacketKeys.size >= this.windowSize
    ) {
      this.recordDebugEvent('flush-window-backpressured', {
        inFlightPackets: this.inFlightPacketKeys.size,
        windowSize: this.windowSize,
        queuedPackets: this.sendQueue.length,
      });
      return;
    }

    const bufferedAmount = activeSocket.bufferedAmount;
    if (bufferedAmount >= SOCKET_BUFFER_HIGH_WATER_MARK_BYTES) {
      this.handleBufferedAmountBackpressure(bufferedAmount);
      return;
    }
    this.resetBufferedAmountBackpressure();

    let sentPackets = 0;
    const maxPacketsThisFlush = this.packetAckSupported
      ? Math.max(0, this.windowSize - this.inFlightPacketKeys.size)
      : Math.max(1, this.windowSize);
    while (
      this.sendQueue.length > 0 &&
      this.ws === activeSocket &&
      activeSocket.readyState === WebSocket.OPEN &&
      sentPackets < maxPacketsThisFlush &&
      (!this.packetAckSupported || this.inFlightPacketKeys.size < this.windowSize)
    ) {
      const currentBufferedAmount = activeSocket.bufferedAmount;
      if (currentBufferedAmount >= SOCKET_BUFFER_HIGH_WATER_MARK_BYTES) {
        this.handleBufferedAmountBackpressure(currentBufferedAmount);
        break;
      }
      const nextPacket = this.shiftNextPacket();
      if (!nextPacket) {
        break;
      }
      try {
        activeSocket.send(
          buildBinaryFrame(
            nextPacket.packet,
            nextPacket.packetIndex,
            nextPacket.chunkId,
            nextPacket.flags
          )
        );
        if (this.packetAckSupported) {
          this.inFlightPacketKeys.add(nextPacket.packetKey);
        }
        sentPackets += 1;
        this.debugSnapshot.sentPackets += 1;
      } catch (error) {
        logger.error('Failed to send scan packet over WebSocket', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: this.sessionId,
          packetIndex: nextPacket.packetIndex,
          chunkId: nextPacket.chunkId,
        });
        this.enqueuePacketKey(nextPacket.packetKey);
        this.ws.close();
        return;
      }
    }

    if (sentPackets > 0) {
      this.packetsSinceResume += sentPackets;
      this.debugSnapshot.sentSinceResume = this.packetsSinceResume;
      this.recordDebugEvent('packets-sent', {
        count: sentPackets,
        queuedPackets: this.sendQueue.length,
      });
    }

    if (
      !this.packetAckSupported &&
      this.sendQueue.length > 0 &&
      this.packetsSinceResume >= RESUME_CHECKPOINT_PACKET_INTERVAL
    ) {
      this.requestResumeCheckpoint();
      return;
    }

    if (this.sendQueue.length > 0) {
      this.scheduleFlush();
      return;
    }

    if (
      !this.pendingComplete &&
      this.sendQueue.length === 0 &&
      this.inFlightPacketKeys.size === 0 &&
      this.packetsSinceResume >= RESUME_CHECKPOINT_PACKET_INTERVAL
    ) {
      this.scheduleIdleResumeCheckpoint();
      return;
    }

    if (
      this.pendingComplete &&
      this.sendQueue.length === 0 &&
      this.inFlightPacketKeys.size === 0 &&
      this.packetsSinceResume > 0
    ) {
      this.requestResumeCheckpoint();
      return;
    }

    if (
      !this.pendingComplete ||
      this.sendQueue.length > 0 ||
      this.inFlightPacketKeys.size > 0 ||
      this.packetStore.size > 0
    ) {
      return;
    }

    this.recordDebugEvent('complete-sent', {
      filename: this.pendingComplete.meta.filename,
    });
    this.sendJson({
      type: 'complete',
      filename: this.pendingComplete.meta.filename,
      completedAt: this.pendingComplete.meta.completedAt,
      duration: this.pendingComplete.meta.duration,
    });
  }

  private sendJson(message: ScanHelloMessage | WireObject): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send scan WS message', {
        error: error instanceof Error ? error : String(error),
        sessionId: this.sessionId,
        messageType: asWireString(message.type) ?? 'unknown',
      });
    }
  }
}

function parseInteger(value: WireValue | undefined, fallback: number): number {
  const parsed = asWireFiniteNumber(value);
  return parsed !== undefined ? parsed : fallback;
}

function normalizeMissingRanges(value: WireValue | undefined): ResumeRange[] {
  if (!isWireArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!isWireArray(entry) || entry.length < 2) {
        return null;
      }
      const start = parseInteger(entry[0], -1);
      const end = parseInteger(entry[1], -1);
      if (start < 0 || end < start) {
        return null;
      }
      const range: ResumeRange = [start, end];
      return range;
    })
    .filter((entry): entry is ResumeRange => entry !== null);
}

function normalizeChunkStates(value: WireValue | undefined): Map<number, ResumeChunkState> {
  const normalized = new Map<number, ResumeChunkState>();
  if (!isWireArray(value)) {
    return normalized;
  }

  value.forEach((entry) => {
    if (!isWireObject(entry)) {
      return;
    }

    const chunkId = parseInteger(entry.chunkId, -1);
    if (chunkId < 0) {
      return;
    }
    const targetFrameCount = parseInteger(entry.targetFrameCount, -1);
    const chunkState: ResumeChunkState = {
      chunkId,
      lastContiguous: parseInteger(entry.lastContiguous, -1),
      missing: normalizeMissingRanges(entry.missing),
      receivedCount: parseInteger(entry.receivedCount, 0),
    };
    if (targetFrameCount >= 0) {
      chunkState.targetFrameCount = targetFrameCount;
    }

    normalized.set(chunkId, chunkState);
  });

  return normalized;
}

function isPacketIndexInResumeRanges(packetIndex: number, ranges: ResumeRange[]): boolean {
  return ranges.some(([start, end]) => packetIndex >= start && packetIndex <= end);
}

function getResumeChunkMaxKnownPacketIndex(chunkState: ResumeChunkState): number {
  const missingPacketCount = chunkState.missing.reduce(
    (count, [start, end]) => count + Math.max(0, end - start + 1),
    0
  );
  const inferredMaxKnownPacketIndex = chunkState.receivedCount + missingPacketCount - 1;
  return Math.max(chunkState.lastContiguous, inferredMaxKnownPacketIndex);
}

function normalizeWindowSize(value: WireValue | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WINDOW_SIZE;
  }
  return Math.max(1, Math.floor(parsed));
}

export class ScanWebSocketSyncService {
  private readonly deviceInfo = getDeviceInfo();
  private readonly sessions = new Map<string, ScanSessionTransport>();
  private browserOffline =
    globalHas('navigator') && isWireBoolean(navigator.onLine)
      ? navigator.onLine === false
      : false;
  private readonly handleOnline = () => {
    this.browserOffline = false;
    Array.from(this.sessions.values()).forEach((session) => {
      session.setOffline(false);
    });
    this.nudgePendingSessions();
  };
  private readonly handleOffline = () => {
    this.browserOffline = true;
    Array.from(this.sessions.values()).forEach((session) => {
      session.setOffline(true);
    });
  };
  private readonly handlePageShow = () => {
    this.nudgePendingSessions();
  };
  private readonly handleVisibilityChange = () => {
    if (globalHas('document') && document.visibilityState !== 'visible') {
      return;
    }
    this.nudgePendingSessions();
  };

  constructor() {
    this.registerBrowserLifecycleListeners();
  }

  queuePacket(packet: Uint8Array, meta: ScanUploadPacketMeta, config: ScanUploadConfig): boolean {
    if (!config.enabled || !config.url || !meta.sessionId || !globalHas('WebSocket')) {
      return false;
    }
    const transport = this.getOrCreateSession(meta.sessionId, config);
    transport.updateConfig(config);
    transport.enqueuePacket(packet, meta);
    return true;
  }

  queueComplete(
    meta: ScanUploadCompleteMeta,
    config: ScanUploadConfig,
    onSuccess?: () => void | Promise<void>,
    onFailure?: (error: string) => void | Promise<void>
  ): boolean {
    if (!config.enabled || !config.url || !meta.sessionId || !globalHas('WebSocket')) {
      return false;
    }
    const transport = this.sessions.get(meta.sessionId);
    if (!transport || !transport.hasSessionData()) {
      return false;
    }
    return transport.enqueueComplete(meta, config, onSuccess, onFailure);
  }

  discardSession(sessionId: string): void {
    const transport = this.sessions.get(sessionId);
    if (!transport) {
      return;
    }
    transport.disconnect();
    this.sessions.delete(sessionId);
  }

  disconnectAll(): void {
    Array.from(this.sessions.values()).forEach((session) => session.disconnect());
    this.sessions.clear();
  }

  dispose(): void {
    this.unregisterBrowserLifecycleListeners();
    this.disconnectAll();
  }

  getDebugSnapshot(
    sessionId?: string
  ): ScanSessionTransportDebugSnapshot | Record<string, ScanSessionTransportDebugSnapshot> | undefined {
    if (sessionId) {
      return this.sessions.get(sessionId)?.getDebugSnapshot();
    }
    return Object.fromEntries(
      Array.from(this.sessions.entries()).map(([id, transport]) => [id, transport.getDebugSnapshot()])
    );
  }

  private getOrCreateSession(sessionId: string, config: ScanUploadConfig): ScanSessionTransport {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const transport = new ScanSessionTransport(
      sessionId,
      config,
      this.deviceInfo,
      (idleSessionId) => {
        this.sessions.delete(idleSessionId);
      }
    );
    transport.setOffline(this.browserOffline);
    this.sessions.set(sessionId, transport);
    return transport;
  }

  private registerBrowserLifecycleListeners(): void {
    if (globalHas('window')) {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      window.addEventListener('pageshow', this.handlePageShow);
    }
    if (globalHas('document')) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private unregisterBrowserLifecycleListeners(): void {
    if (globalHas('window')) {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      window.removeEventListener('pageshow', this.handlePageShow);
    }
    if (globalHas('document')) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private nudgePendingSessions(): void {
    Array.from(this.sessions.values()).forEach((session) => {
      session.nudgeReconnect();
    });
  }
}

let instance: ScanWebSocketSyncService | null = null;

export function getScanWebSocketSyncService(): ScanWebSocketSyncService {
  if (!instance) {
    instance = new ScanWebSocketSyncService();
  }
  return instance;
}

export function resetScanWebSocketSyncService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
  // SAFETY: this module owns the debug bag attached to globalThis.
  const publishedSessions =
    (globalThis as ScanSyncDebugGlobal).__airqrScanSyncDebug?.sessions ?? {};
  Object.keys(publishedSessions).forEach((sessionId) => {
    clearPublishedDebugSnapshot(sessionId);
  });
}

export function getScanWebSocketSyncDebugSnapshot(
  sessionId?: string
): ScanSessionTransportDebugSnapshot | Record<string, ScanSessionTransportDebugSnapshot> | undefined {
  const liveSnapshot = getScanWebSocketSyncService().getDebugSnapshot(sessionId);
  // SAFETY: this module owns the debug bag attached to globalThis.
  const publishedSessions =
    (globalThis as ScanSyncDebugGlobal).__airqrScanSyncDebug?.sessions ?? {};
  if (sessionId) {
    return (
      liveSnapshot ??
      publishedSessions[sessionId]
    );
  }
  const merged = {
    ...publishedSessions,
  };
  if (liveSnapshot && !Array.isArray(liveSnapshot)) {
    Object.assign(merged, liveSnapshot);
  }
  return merged;
}

// SAFETY: this module owns the debug bag attached to globalThis.
const scanSyncDebugGlobal = globalThis as ScanSyncDebugGlobal;

scanSyncDebugGlobal.__airqrScanSyncDebug = {
  sessions: scanSyncDebugGlobal.__airqrScanSyncDebug?.sessions ?? {},
  getSnapshot: getScanWebSocketSyncDebugSnapshot,
};
