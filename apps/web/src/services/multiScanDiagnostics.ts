import {
  asWireFiniteNumber,
  asWireString,
  globalHas,
  isWireBoolean,
  type WireValue,
} from '../parse/wire';
import { useHistoryStore } from '../store/historyStore';
import { useSettingsStore } from '../store/settingsStore';
import type { IncompleteScanItem, ScanStats, ScanUploadConfig } from '../types';
import type { ScanChunkState, DecodeState } from '../types/scanSessionState';
import { getIncompleteScanSessionKeys } from '../utils/incompleteSync';
import {
  fetchServerSession,
  type ServerSessionResponse,
} from './scanSyncService';
import {
  getCachedServerAuthStatus,
  isServerSyncAuthorizedSnapshot,
} from './serverAuth';
import {
  getScanWebSocketSyncDebugSnapshot,
  type ScanSessionTransportDebugSnapshot,
} from './scanWebSocketSyncService';

export interface ScannerLiveDiagnosticsSnapshot {
  activeChunk: { current: number; total: number } | null;
  localDeviceName: string;
  progress: number;
  scanStats: ScanStats;
  sessionId: string | null;
  sessionProgress: {
    received: number;
    total: number;
    totalLabel: string;
    totalIsEstimate?: boolean;
    min: number;
    minLabel: string;
    max: number | null;
    maxLabel: string;
    percent: number;
    decodeState?: DecodeState | string;
    fileAvailable?: boolean;
    chunksTotal?: number | null;
    chunksComplete?: number;
    chunksMissing?: number | null;
    chunks?: ScanChunkState[];
  } | null;
  status: string;
  syncSourceName: string | null;
}

export type ProgressDiagnosticSource =
  | 'scanner-session'
  | 'scanner-local'
  | 'history'
  | 'server-canonical'
  | 'server-legacy';

export type ProgressDiagnosticField =
  | 'activeChunk'
  | 'chunksComplete'
  | 'chunksMissing'
  | 'chunksTotal'
  | 'decodeState'
  | 'max'
  | 'min'
  | 'missingToThreshold'
  | 'received'
  | 'stateVersion';

export interface ProgressDiagnosticCounter {
  source: ProgressDiagnosticSource;
  sessionId: string | null;
  received: number | null;
  min: number | null;
  max: number | null;
  missingToThreshold: number | null;
  activeChunk?: { current: number; total: number } | null;
  chunksTotal?: number | null;
  chunksComplete?: number | null;
  chunksMissing?: number | null;
  decodeState?: DecodeState | string | null;
  stateVersion?: number | null;
}

export interface ProgressDiagnosticTransition {
  at: string;
  source: ProgressDiagnosticSource;
  sessionId: string | null;
  changed: ProgressDiagnosticField[];
  previous: ProgressDiagnosticCounter;
  current: ProgressDiagnosticCounter;
  note: string;
}

export interface ProgressDiagnosticsSnapshot {
  current: ProgressDiagnosticCounter[];
  transitions: ProgressDiagnosticTransition[];
}

export interface MultiScanDiagnosticsSnapshot {
  at: string;
  sessionId: string | null;
  online: boolean;
  visibilityState: string | null;
  authSnapshot: {
    enabled: boolean;
    authorizedSnapshot: boolean;
    cachedAuthorized: boolean | null;
  };
  scanner: ScannerLiveDiagnosticsSnapshot | null;
  history: IncompleteScanItem | null;
  progressDiagnostics: ProgressDiagnosticsSnapshot;
  transport: ScanSessionTransportDebugSnapshot | null;
  server: ServerSessionResponse | null;
}

interface MultiScanDiagnosticsCaptureArgs {
  config?: ScanUploadConfig | null;
  sessionId?: string | null;
}

interface MultiScanDiagnosticsGlobal {
  capture: (
    args?: MultiScanDiagnosticsCaptureArgs
  ) => Promise<MultiScanDiagnosticsSnapshot>;
  getScannerSnapshot: () => ScannerLiveDiagnosticsSnapshot | null;
}

let scannerSnapshot: ScannerLiveDiagnosticsSnapshot | null = null;
const PROGRESS_TRANSITION_LIMIT = 48;
const previousProgressCounters = new Map<string, ProgressDiagnosticCounter>();
const progressTransitions: ProgressDiagnosticTransition[] = [];

function getDiagnosticsGlobal(): {
  __airqrMultiScanDiagnostics?: MultiScanDiagnosticsGlobal;
} {
  // SAFETY: this module owns the diagnostics bag attached to globalThis.
  return globalThis as {
    __airqrMultiScanDiagnostics?: MultiScanDiagnosticsGlobal;
  };
}

function resolveUploadConfig(
  explicitConfig?: ScanUploadConfig | null
): ScanUploadConfig | null {
  if (explicitConfig) {
    return explicitConfig;
  }
  try {
    return useSettingsStore.getState().uploadConfig;
  } catch {
    return null;
  }
}

function resolveHistoryItem(sessionId: string | null): IncompleteScanItem | null {
  if (!sessionId) {
    return null;
  }

  try {
    const items = useHistoryStore.getState().incompleteItems;
    return (
      items.find((item) =>
        getIncompleteScanSessionKeys(item).includes(sessionId)
      ) ?? null
    );
  } catch {
    return null;
  }
}

function resolveSessionId(
  explicitSessionId?: string | null
): string | null {
  if (explicitSessionId) {
    return explicitSessionId;
  }
  if (scannerSnapshot?.sessionId) {
    return scannerSnapshot.sessionId;
  }
  return null;
}

function isLiveTransportSnapshot(
  value:
    | ScanSessionTransportDebugSnapshot
    | { [sessionId: string]: ScanSessionTransportDebugSnapshot }
    | undefined
    | null
): value is ScanSessionTransportDebugSnapshot {
  return Boolean(
    value &&
      !Array.isArray(value) &&
      'queuedPackets' in value &&
      'reconnectAttempts' in value &&
      'recentEvents' in value
  );
}

function toFiniteInt(value: WireValue | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = asWireFiniteNumber(value);
  if (parsed === undefined) {
    return null;
  }
  return Math.max(0, Math.trunc(parsed));
}

function countRanges(ranges: Array<[number, number]> | null | undefined): number {
  if (!ranges) {
    return 0;
  }
  return ranges.reduce(
    (sum, [start, end]) => sum + Math.max(0, end - start + 1),
    0
  );
}

function chunkMissingToThreshold(chunk: ScanChunkState): number {
  if (chunk.state === 'complete') {
    return 0;
  }
  if (
    chunk.decodeThreshold !== null &&
    Number.isFinite(chunk.decodeThreshold) &&
    chunk.decodeThreshold > 0
  ) {
    return Math.max(0, chunk.decodeThreshold - Math.max(0, chunk.receivedUnique));
  }
  if (chunk.missingCount !== null && Number.isFinite(chunk.missingCount)) {
    return Math.max(0, Math.trunc(chunk.missingCount));
  }
  return countRanges(chunk.missingRanges);
}

function chunksMissingToThreshold(
  chunks: ScanChunkState[] | null | undefined
): number | null {
  if (!chunks || chunks.length === 0) {
    return null;
  }
  return chunks.reduce((sum, chunk) => sum + chunkMissingToThreshold(chunk), 0);
}

function fallbackMissingToThreshold(
  received: number | null,
  min: number | null
): number | null {
  if (received === null || min === null) {
    return null;
  }
  return Math.max(0, min - received);
}

function maybeCounter(
  counter: ProgressDiagnosticCounter
): ProgressDiagnosticCounter | null {
  if (
    counter.received === null &&
    counter.min === null &&
    counter.max === null &&
    counter.missingToThreshold === null
  ) {
    return null;
  }
  return counter;
}

function buildScannerSessionCounter(
  scanner: ScannerLiveDiagnosticsSnapshot | null
): ProgressDiagnosticCounter | null {
  const progress = scanner?.sessionProgress;
  if (!scanner || !progress) {
    return null;
  }
  const chunks = 'chunks' in progress ? progress.chunks : undefined;
  const missingFromChunks = chunksMissingToThreshold(
    Array.isArray(chunks) ? chunks : null
  );
  const received = toFiniteInt(progress.received);
  const min = toFiniteInt(progress.min);

  return maybeCounter({
    source: 'scanner-session',
    sessionId: scanner.sessionId,
    received,
    min,
    max: toFiniteInt(progress.max),
    missingToThreshold:
      missingFromChunks ?? fallbackMissingToThreshold(received, min),
    activeChunk: scanner.activeChunk,
    chunksTotal: 'chunksTotal' in progress ? toFiniteInt(progress.chunksTotal) : null,
    chunksComplete:
      'chunksComplete' in progress ? toFiniteInt(progress.chunksComplete) : null,
    chunksMissing:
      'chunksMissing' in progress ? toFiniteInt(progress.chunksMissing) : null,
    decodeState: asWireString(progress.decodeState) ?? null,
  });
}

function buildScannerLocalCounter(
  scanner: ScannerLiveDiagnosticsSnapshot | null
): ProgressDiagnosticCounter | null {
  if (!scanner) {
    return null;
  }
  const received = toFiniteInt(scanner.scanStats.received);
  const min = toFiniteInt(scanner.scanStats.min);

  return maybeCounter({
    source: 'scanner-local',
    sessionId: scanner.sessionId,
    received,
    min,
    max: toFiniteInt(scanner.scanStats.total),
    missingToThreshold: fallbackMissingToThreshold(received, min),
    activeChunk: scanner.activeChunk,
  });
}

function buildHistoryCounter(
  history: IncompleteScanItem | null
): ProgressDiagnosticCounter | null {
  if (!history) {
    return null;
  }
  const received = toFiniteInt(history.received);
  const min = toFiniteInt(history.total);

  return maybeCounter({
    source: 'history',
    sessionId: history.remoteSessionId ?? history.sessionId,
    received,
    min,
    max: history.totalIsEstimate ? null : min,
    missingToThreshold: fallbackMissingToThreshold(received, min),
    chunksTotal: toFiniteInt(history.totalChunks),
    chunksComplete: toFiniteInt(history.chunksCompleted),
  });
}

function buildServerCounter(
  server: ServerSessionResponse | null
): ProgressDiagnosticCounter | null {
  if (!server) {
    return null;
  }

  const hasCanonicalState =
    server.scanState ||
    server.receivedUnique !== undefined ||
    server.decodeThreshold !== undefined ||
    server.chunks !== undefined ||
    server.decodeState !== undefined;
  const scanState = server.scanState;
  const received = toFiniteInt(scanState?.receivedUnique ?? server.receivedUnique);
  const legacyReceived = toFiniteInt(
    server.receivedCount ?? server.receivedPackets ?? server.packetCount
  );
  const min = toFiniteInt(
    scanState?.decodeThreshold ?? server.decodeThreshold ?? server.expectedPackets
  );
  const legacyMin = toFiniteInt(server.expectedPackets ?? server.totalPackets);
  const totalPacketsExact = Boolean(
    scanState?.totalPacketsExact ?? server.totalPacketsExact
  );
  const max = totalPacketsExact
    ? toFiniteInt(scanState?.totalPackets ?? server.totalPackets)
    : null;
  const chunks = scanState?.chunks ?? server.chunks;
  const missingFromChunks = chunksMissingToThreshold(chunks);
  const effectiveReceived = received ?? legacyReceived;
  const effectiveMin = min ?? legacyMin;

  return maybeCounter({
    source: hasCanonicalState ? 'server-canonical' : 'server-legacy',
    sessionId: server.sessionId,
    received: effectiveReceived,
    min: effectiveMin,
    max,
    missingToThreshold:
      missingFromChunks ?? fallbackMissingToThreshold(effectiveReceived, effectiveMin),
    chunksTotal: toFiniteInt(scanState?.chunksTotal ?? server.chunksTotal),
    chunksComplete: toFiniteInt(scanState?.chunksComplete ?? server.chunksComplete),
    chunksMissing: toFiniteInt(scanState?.chunksMissing ?? server.chunksMissing),
    decodeState: scanState?.decodeState ?? server.decodeState ?? null,
    stateVersion: toFiniteInt(scanState?.stateVersion ?? server.stateVersion),
  });
}

function buildProgressCounters(
  snapshot: Pick<MultiScanDiagnosticsSnapshot, 'history' | 'scanner' | 'server'>
): ProgressDiagnosticCounter[] {
  return [
    buildScannerSessionCounter(snapshot.scanner),
    buildScannerLocalCounter(snapshot.scanner),
    buildHistoryCounter(snapshot.history),
    buildServerCounter(snapshot.server),
  ].filter((counter): counter is ProgressDiagnosticCounter => counter !== null);
}

function counterKey(counter: ProgressDiagnosticCounter): string {
  return `${counter.sessionId ?? '-'}:${counter.source}`;
}

function sameCounterValue(
  left: ProgressDiagnosticCounter,
  right: ProgressDiagnosticCounter,
  field: ProgressDiagnosticField
): boolean {
  if (field === 'activeChunk') {
    return (
      (left.activeChunk?.current ?? null) === (right.activeChunk?.current ?? null) &&
      (left.activeChunk?.total ?? null) === (right.activeChunk?.total ?? null)
    );
  }
  return (left[field] ?? null) === (right[field] ?? null);
}

function changedFields(
  previous: ProgressDiagnosticCounter,
  current: ProgressDiagnosticCounter
): ProgressDiagnosticField[] {
  const fields: ProgressDiagnosticField[] = [
    'received',
    'min',
    'max',
    'missingToThreshold',
    'activeChunk',
    'chunksTotal',
    'chunksComplete',
    'chunksMissing',
    'decodeState',
    'stateVersion',
  ];
  return fields.filter((field) => !sameCounterValue(previous, current, field));
}

function buildTransitionNote(
  previous: ProgressDiagnosticCounter,
  current: ProgressDiagnosticCounter,
  changed: ProgressDiagnosticField[]
): string {
  const notes: string[] = [];
  if (
    changed.includes('missingToThreshold') &&
    previous.missingToThreshold !== null &&
    current.missingToThreshold !== null &&
    current.missingToThreshold > previous.missingToThreshold
  ) {
    notes.push('missing increased');
  }
  if (
    changed.includes('min') &&
    previous.min !== null &&
    current.min !== null &&
    current.min > previous.min
  ) {
    notes.push('min increased');
  }
  if (changed.includes('max') && previous.max === null && current.max !== null) {
    notes.push('max became known');
  }
  if (
    current.source === 'scanner-local' &&
    current.activeChunk &&
    current.activeChunk.total > 1 &&
    (changed.includes('min') || changed.includes('max') || changed.includes('activeChunk'))
  ) {
    notes.push('local min/max are active-chunk scoped');
  }
  if (
    current.source === 'server-canonical' &&
    (changed.includes('chunksTotal') || changed.includes('chunksMissing'))
  ) {
    notes.push('canonical chunk map changed');
  }
  return notes.length > 0 ? notes.join('; ') : 'counters changed';
}

function recordProgressDiagnostics(
  at: string,
  counters: ProgressDiagnosticCounter[],
  sessionId: string | null
): ProgressDiagnosticsSnapshot {
  counters.forEach((current) => {
    const key = counterKey(current);
    const previous = previousProgressCounters.get(key);
    if (previous) {
      const changed = changedFields(previous, current);
      const importantChange = changed.some((field) =>
        [
          'activeChunk',
          'chunksComplete',
          'chunksMissing',
          'chunksTotal',
          'decodeState',
          'max',
          'min',
          'missingToThreshold',
          'received',
          'stateVersion',
        ].includes(field)
      );
      if (importantChange) {
        progressTransitions.push({
          at,
          source: current.source,
          sessionId: current.sessionId,
          changed,
          previous,
          current,
          note: buildTransitionNote(previous, current, changed),
        });
        if (progressTransitions.length > PROGRESS_TRANSITION_LIMIT) {
          progressTransitions.splice(
            0,
            progressTransitions.length - PROGRESS_TRANSITION_LIMIT
          );
        }
      }
    }
    previousProgressCounters.set(key, { ...current });
  });

  const visibleTransitions = sessionId
    ? progressTransitions.filter((transition) => transition.sessionId === sessionId)
    : progressTransitions;

  return {
    current: counters.map((counter) => ({ ...counter })),
    transitions: visibleTransitions.map((transition) => ({
      ...transition,
      previous: { ...transition.previous },
      current: { ...transition.current },
      changed: [...transition.changed],
    })),
  };
}

export function publishScannerLiveDiagnostics(
  snapshot: ScannerLiveDiagnosticsSnapshot | null
): void {
  scannerSnapshot = snapshot;
}

export function getScannerLiveDiagnosticsSnapshot(): ScannerLiveDiagnosticsSnapshot | null {
  return scannerSnapshot;
}

export async function captureMultiScanDiagnosticsSnapshot(
  args: MultiScanDiagnosticsCaptureArgs = {}
): Promise<MultiScanDiagnosticsSnapshot> {
  const at = new Date().toISOString();
  const sessionId = resolveSessionId(args.sessionId);
  const config = resolveUploadConfig(args.config);
  const history = resolveHistoryItem(sessionId);
  const rawTransport = sessionId
    ? getScanWebSocketSyncDebugSnapshot(sessionId)
    : null;
  const transport = isLiveTransportSnapshot(rawTransport) ? rawTransport : null;

  let server: ServerSessionResponse | null = null;
  if (config?.enabled && config.url && sessionId) {
    try {
      server = await fetchServerSession(config, sessionId);
    } catch {
      server = null;
    }
  }

  const cachedAuth = config ? getCachedServerAuthStatus(config) : null;
  const authorizedSnapshot = config
    ? isServerSyncAuthorizedSnapshot(config)
    : false;

  const snapshotBase = {
    history,
    scanner: scannerSnapshot,
    server,
  };

  return {
    at,
    sessionId,
    online:
      !globalHas('navigator') || !isWireBoolean(navigator.onLine)
        ? true
        : navigator.onLine,
    visibilityState: globalHas('document') ? document.visibilityState : null,
    authSnapshot: {
      enabled: Boolean(config?.enabled && config?.url),
      authorizedSnapshot,
      cachedAuthorized:
        cachedAuth && cachedAuth.enabled
          ? Boolean(cachedAuth.authorized)
          : null,
    },
    scanner: scannerSnapshot,
    history,
    progressDiagnostics: recordProgressDiagnostics(
      at,
      buildProgressCounters(snapshotBase),
      sessionId
    ),
    transport,
    server,
  };
}

getDiagnosticsGlobal().__airqrMultiScanDiagnostics = {
  capture: captureMultiScanDiagnosticsSnapshot,
  getScannerSnapshot: getScannerLiveDiagnosticsSnapshot,
};

