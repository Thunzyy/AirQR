import {
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  isWireArray,
  isWireObject,
  type WireObject,
  type WireValue,
} from "../parse/wire";
import type {
  ChunkState,
  DecodeState,
  ScanAssemblyState,
  ScanChunkState,
  ScanSessionState,
} from "../types/scanSessionState";

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

const CHUNK_STATE_RANK = {
  missing: 0,
  scanning: 1,
  threshold_reached: 2,
  complete: 3,
  failed: 4,
} as const;

const DECODE_STATE_RANK = {
  scanning: 0,
  threshold_reached: 1,
  decode_pending: 2,
  assembling: 3,
  complete: 4,
  failed: 5,
} as const;

function toSafeInt(value: WireValue | undefined, fallback = 0): number {
  const parsed = asWireFiniteNumber(value);
  if (parsed === undefined) {
    return Math.max(0, Math.trunc(fallback));
  }
  return Math.max(0, Math.trunc(parsed));
}

function toOptionalInt(value: WireValue | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = asWireFiniteNumber(value);
  return parsed !== undefined ? Math.max(0, Math.trunc(parsed)) : null;
}

function toOptionalNumber(value: WireValue | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = asWireFiniteNumber(value);
  return parsed !== undefined ? Math.max(0, parsed) : null;
}

function normalizeIncompleteCompletionPercent(value: number): number {
  const bounded = Math.min(99.9, Math.max(0, value));
  return Number((Math.floor(bounded * 10) / 10).toFixed(1));
}

function toBool(value: WireValue | undefined): boolean {
  return value === true || value === 1 || value === "true";
}

function maxOptionalInt(...values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

function minOptionalInt(...values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.min(...present) : null;
}

function normalizeRanges(value: WireValue | undefined): Array<[number, number]> {
  if (!isWireArray(value)) {
    return [];
  }

  return value.flatMap((entry): Array<[number, number]> => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return [];
    }
    const start = toOptionalInt(entry[0]);
    const end = toOptionalInt(entry[1]);
    if (start === null || end === null || end < start) {
      return [];
    }
    return [[start, end]];
  });
}

function isDecodeState(value: WireValue | undefined): value is DecodeState {
  return (
    value === "scanning" ||
    value === "threshold_reached" ||
    value === "assembling" ||
    value === "decode_pending" ||
    value === "complete" ||
    value === "failed"
  );
}

function isChunkState(value: WireValue | undefined): value is ChunkState {
  return (
    value === "missing" ||
    value === "scanning" ||
    value === "threshold_reached" ||
    value === "complete" ||
    value === "failed"
  );
}

function chooseChunkState(left: ChunkState, right: ChunkState): ChunkState {
  return CHUNK_STATE_RANK[right] > CHUNK_STATE_RANK[left] ? right : left;
}

function chooseDecodeState(left: DecodeState, right: DecodeState): DecodeState {
  return DECODE_STATE_RANK[right] > DECODE_STATE_RANK[left] ? right : left;
}

function isCompleteFile(raw: WireObject): boolean {
  const completed = toBool(raw.completed) || toBool(raw.isComplete) || raw.status === "complete";
  return (
    completed &&
    (toBool(raw.fileAvailable) ||
      asWireString(raw.filePath) !== undefined ||
      asWireString(raw.fileUrl) !== undefined ||
      asWireString(raw.downloadUrl) !== undefined)
  );
}

function normalizeAssembly(raw: WireValue | undefined): ScanAssemblyState {
  const source = asWireObject(raw);
  return {
    inProgress: toBool(source.inProgress ?? source.in_progress),
    attempts: toSafeInt(source.attempts),
    lastAttemptAt: asWireString(source.lastAttemptAt ?? source.last_attempt_at) ?? null,
    lastError: asWireString(source.lastError ?? source.last_error) ?? null,
  };
}

function missingCountFromRanges(ranges: Array<[number, number]>): number | null {
  if (ranges.length === 0) {
    return null;
  }
  return ranges.reduce((sum, [start, end]) => sum + end - start + 1, 0);
}

function missingScore(chunkState: ScanChunkState): number {
  return (
    chunkState.missingCount ??
    missingCountFromRanges(chunkState.missingRanges) ??
    Number.POSITIVE_INFINITY
  );
}

function targetFrameScore(chunkState: ScanChunkState): number {
  return (
    chunkState.targetFrameCount ??
    missingCountFromRanges(chunkState.targetFrameRanges) ??
    Number.POSITIVE_INFINITY
  );
}

function unseenFrameScore(chunkState: ScanChunkState): number {
  return (
    chunkState.unseenFrameCount ??
    missingCountFromRanges(chunkState.unseenFrameRanges) ??
    Number.POSITIVE_INFINITY
  );
}

function deriveChunkState(options: {
  rawState: WireValue | undefined;
  receivedUnique: number;
  decodeThreshold: number | null;
  totalPackets: number | null;
  totalPacketsExact: boolean;
}): ChunkState {
  const rawState = isChunkState(options.rawState) ? options.rawState : null;
  let derived: ChunkState = "missing";

  if (
    options.totalPacketsExact &&
    options.totalPackets !== null &&
    options.receivedUnique >= options.totalPackets
  ) {
    derived = "complete";
  } else if (
    options.decodeThreshold !== null &&
    options.receivedUnique >= options.decodeThreshold
  ) {
    derived = "threshold_reached";
  } else if (options.receivedUnique > 0) {
    derived = "scanning";
  }

  if (!rawState) {
    return derived;
  }
  return chooseChunkState(derived, rawState);
}

function normalizeChunk(
  raw: WireObject,
  fallbackId: number,
  fallback: {
    decodeThreshold?: number | null;
    totalPackets?: number | null;
    totalPacketsExact?: boolean;
  } = {}
): ScanChunkState {
  const receivedUnique = Math.max(
    toSafeInt(raw.receivedUnique),
    toSafeInt(raw.receivedCount),
    toSafeInt(raw.receivedPackets),
    toSafeInt(raw.packetCount)
  );
  const decodeThreshold =
    toOptionalInt(raw.decodeThreshold) ??
    toOptionalInt(raw.expectedPackets) ??
    toOptionalInt(raw.totalExpected) ??
    fallback.decodeThreshold ??
    null;
  const totalPackets =
    toOptionalInt(raw.totalPackets) ?? fallback.totalPackets ?? null;
  const totalPacketsExact =
    "totalPacketsExact" in raw
      ? toBool(raw.totalPacketsExact)
      : Boolean(fallback.totalPacketsExact);
  let missingRanges = normalizeRanges(raw.missingRanges ?? raw.missing);
  let targetFrameRanges = normalizeRanges(raw.targetFrameRanges);
  let unseenFrameRanges = normalizeRanges(raw.unseenFrameRanges);
  const state = deriveChunkState({
    rawState: raw.state,
    receivedUnique,
    decodeThreshold,
    totalPackets,
    totalPacketsExact,
  });
  const computedMissingCount =
    missingCountFromRanges(missingRanges) ??
    (decodeThreshold !== null
      ? Math.max(decodeThreshold - receivedUnique, 0)
      : totalPackets !== null
        ? Math.max(totalPackets - receivedUnique, 0)
        : null);
  let missingCount = toOptionalInt(raw.missingCount) ?? computedMissingCount;
  let targetFrameCount =
    toOptionalInt(raw.targetFrameCount) ??
    missingCountFromRanges(targetFrameRanges);
  let unseenFrameCount = toOptionalInt(raw.unseenFrameCount);
  if (unseenFrameCount === null) {
    unseenFrameCount = missingCountFromRanges(unseenFrameRanges);
  }

  if (state === "complete") {
    missingCount = 0;
    missingRanges = [];
    targetFrameCount = 0;
    targetFrameRanges = [];
    unseenFrameCount = 0;
    unseenFrameRanges = [];
  }

  return {
    chunkId: toSafeInt(raw.chunkId, fallbackId),
    receivedUnique,
    decodeThreshold,
    totalPackets,
    totalPacketsExact,
    state,
    missingCount,
    missingRanges,
    targetFrameCount,
    targetFrameRanges,
    unseenFrameCount,
    unseenFrameRanges,
  };
}

function unwrapPayload(raw: WireObject): WireObject {
  if (isWireObject(raw.payload) && raw.type === "scan-session-state") {
    return raw.payload;
  }
  if (isWireObject(raw.scanState)) {
    return raw.scanState;
  }
  if (isWireObject(raw.state)) {
    return raw.state;
  }
  return raw;
}

function effectiveChunksTotal(
  chunksTotal: number | null,
  chunks: ScanChunkState[]
): number | null {
  if (chunksTotal === null && chunks.length === 0) {
    return null;
  }
  const highestObserved = chunks.reduce(
    (maxChunkId, chunkState) => Math.max(maxChunkId, chunkState.chunkId + 1),
    0
  );
  return Math.max(chunksTotal ?? 0, chunks.length, highestObserved);
}

function fillMissingChunks(
  chunks: ScanChunkState[],
  chunksTotal: number | null,
  fallback: {
    decodeThreshold?: number | null;
    totalPackets?: number | null;
    totalPacketsExact?: boolean;
  }
): ScanChunkState[] {
  const byId = new Map<number, ScanChunkState>();
  for (const chunkState of chunks) {
    byId.set(chunkState.chunkId, chunkState);
  }

  if (chunksTotal !== null) {
    for (let chunkId = 0; chunkId < chunksTotal; chunkId += 1) {
      if (!byId.has(chunkId)) {
        byId.set(chunkId, normalizeChunk({ chunkId }, chunkId, fallback));
      }
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.chunkId - right.chunkId);
}

function resolveDecodeState(options: {
  raw: WireValue | undefined;
  receivedUnique: number;
  decodeThreshold: number | null;
  isComplete: boolean;
  fileAvailable: boolean;
  assemblyInProgress: boolean;
}): DecodeState {
  if (options.isComplete && options.fileAvailable) {
    return "complete";
  }
  if (options.assemblyInProgress) {
    return "assembling";
  }
  if (isDecodeState(options.raw) && options.raw !== "complete" && options.raw !== "scanning") {
    return options.raw;
  }
  if (options.decodeThreshold !== null && options.receivedUnique >= options.decodeThreshold) {
    return "threshold_reached";
  }
  return "scanning";
}

function resolveCompletionPercent(options: {
  raw: WireValue | undefined;
  receivedUnique: number;
  decodeThreshold: number | null;
  totalPackets: number | null;
  isComplete: boolean;
  fileAvailable: boolean;
}): number {
  if (options.isComplete && options.fileAvailable) {
    return 100;
  }

  const raw = toOptionalNumber(options.raw);
  if (raw !== null) {
    return normalizeIncompleteCompletionPercent(raw);
  }

  const denominator = options.decodeThreshold ?? options.totalPackets;
  if (denominator === null || denominator <= 0) {
    return 0;
  }
  return normalizeIncompleteCompletionPercent(
    (options.receivedUnique / denominator) * 100
  );
}

function validUpdatedAt(value: WireValue | undefined): string {
  const text = asWireString(value);
  return text !== undefined && Number.isFinite(Date.parse(text))
    ? text
    : EPOCH_ISO;
}

export function normalizeScanSessionState(raw: WireValue): ScanSessionState | null {
  if (!isWireObject(raw)) {
    return null;
  }

  const source = unwrapPayload(raw);
  const sessionId = asWireString(source.sessionId) ?? asWireString(source.id) ?? null;
  if (!sessionId) {
    return null;
  }

  const receivedUnique = Math.max(
    toSafeInt(source.receivedUnique),
    toSafeInt(source.receivedCount),
    toSafeInt(source.receivedPackets),
    toSafeInt(source.packetCount),
    toSafeInt(source.packetsReceived)
  );
  const decodeThreshold =
    toOptionalInt(source.decodeThreshold) ??
    toOptionalInt(source.expectedPackets) ??
    toOptionalInt(source.totalExpected) ??
    toOptionalInt(source.packetsExpected);
  const totalPackets = toOptionalInt(source.totalPackets);
  const totalPacketsExact = toBool(source.totalPacketsExact);
  const chunksTotalRaw =
    toOptionalInt(source.chunksTotal) ?? toOptionalInt(source.totalChunks);
  const rawChunks = isWireArray(source.chunks)
    ? source.chunks
    : isWireArray(source.chunkStates)
      ? source.chunkStates
      : [];
  const singleChunkFallback = chunksTotalRaw === 1;
  const chunks = rawChunks.map((rawChunk, index) =>
    normalizeChunk(
      asWireObject(rawChunk),
      index,
      {
        decodeThreshold: singleChunkFallback ? decodeThreshold : null,
        totalPackets: singleChunkFallback ? totalPackets : null,
        totalPacketsExact: singleChunkFallback ? totalPacketsExact : false,
      }
    )
  );
  const chunksTotal = effectiveChunksTotal(chunksTotalRaw, chunks);
  let filledChunks = fillMissingChunks(chunks, chunksTotal, {
    decodeThreshold: singleChunkFallback ? decodeThreshold : null,
    totalPackets: singleChunkFallback ? totalPackets : null,
    totalPacketsExact: singleChunkFallback ? totalPacketsExact : false,
  });

  const assembly = normalizeAssembly(source.assembly);
  const fileAvailable = isCompleteFile(source);
  const isComplete = fileAvailable;

  if (isComplete) {
    filledChunks = filledChunks.map((chunkState) => ({
      ...chunkState,
      state: "complete",
      missingCount: 0,
      missingRanges: [],
      targetFrameCount: 0,
      targetFrameRanges: [],
      unseenFrameCount: 0,
      unseenFrameRanges: [],
    }));
  }

  const computedChunksComplete = filledChunks.filter(
    (chunkState) => chunkState.state === "complete"
  ).length;
  const chunksComplete = isComplete
    ? chunksTotal ?? computedChunksComplete
    : Math.max(
        toSafeInt(source.chunksComplete),
        toSafeInt(source.chunksCompleted),
        computedChunksComplete
      );
  const computedChunksMissing =
    chunksTotal !== null
      ? Math.max(
          chunksTotal - chunksComplete,
          filledChunks.filter((chunkState) => chunkState.state !== "complete").length
        )
      : null;
  const chunksMissing = isComplete
    ? 0
    : toOptionalInt(source.chunksMissing) ?? computedChunksMissing;
  const decodeState = resolveDecodeState({
    raw: source.decodeState,
    receivedUnique,
    decodeThreshold,
    isComplete,
    fileAvailable,
    assemblyInProgress: assembly.inProgress,
  });
  const status =
    isComplete && fileAvailable
      ? "complete"
      : source.status === "failed" || decodeState === "failed"
        ? "failed"
        : "active";

  return {
    type: "scan-session-state",
    stateVersion: toSafeInt(source.stateVersion),
    sessionId,
    status,
    updatedAt: validUpdatedAt(source.updatedAt),
    filename: asWireString(source.filename) ?? null,
    receivedUnique,
    decodeThreshold,
    totalPackets,
    totalPacketsExact,
    completionPercent: resolveCompletionPercent({
      raw: source.completionPercent ?? source.percent ?? source.progressPercent,
      receivedUnique,
      decodeThreshold,
      totalPackets,
      isComplete,
      fileAvailable,
    }),
    decodeState,
    isComplete,
    fileAvailable,
    chunksTotal,
    chunksComplete,
    chunksMissing,
    chunks: filledChunks,
    assembly,
  };
}

function latestTimestamp(left: string, right: string): string {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) {
    return right;
  }
  if (!Number.isFinite(rightTime)) {
    return left;
  }
  return rightTime >= leftTime ? right : left;
}

function mergeAssembly(
  current: ScanAssemblyState,
  incoming: ScanAssemblyState,
  options: { preferIncoming: boolean; forceComplete: boolean }
): ScanAssemblyState {
  if (options.forceComplete) {
    return {
      inProgress: false,
      attempts: Math.max(current.attempts, incoming.attempts),
      lastAttemptAt:
        current.lastAttemptAt && incoming.lastAttemptAt
          ? latestTimestamp(current.lastAttemptAt, incoming.lastAttemptAt)
          : incoming.lastAttemptAt ?? current.lastAttemptAt,
      lastError: null,
    };
  }

  return {
    inProgress: options.preferIncoming
      ? incoming.inProgress
      : current.inProgress || incoming.inProgress,
    attempts: Math.max(current.attempts, incoming.attempts),
    lastAttemptAt:
      current.lastAttemptAt && incoming.lastAttemptAt
        ? latestTimestamp(current.lastAttemptAt, incoming.lastAttemptAt)
        : incoming.lastAttemptAt ?? current.lastAttemptAt,
    lastError: options.preferIncoming
      ? incoming.lastError
      : incoming.lastError ?? current.lastError,
  };
}

function mergeChunkState(
  current: ScanChunkState,
  incoming: ScanChunkState
): ScanChunkState {
  const receivedUnique = Math.max(current.receivedUnique, incoming.receivedUnique);
  const state = chooseChunkState(current.state, incoming.state);
  const missingCount =
    state === "complete"
      ? 0
      : minOptionalInt(current.missingCount, incoming.missingCount);
  const missingRanges =
    current.receivedUnique > incoming.receivedUnique
      ? current.missingRanges
      : incoming.receivedUnique > current.receivedUnique
        ? incoming.missingRanges
        : missingScore(current) <= missingScore(incoming)
          ? current.missingRanges
          : incoming.missingRanges;
  const targetFrameCount =
    state === "complete"
      ? 0
      : minOptionalInt(current.targetFrameCount, incoming.targetFrameCount);
  const targetFrameRanges =
    state === "complete"
      ? []
      : incoming.targetFrameRanges.length === 0
        ? current.targetFrameRanges
        : current.targetFrameRanges.length === 0
          ? incoming.targetFrameRanges
          : targetFrameScore(current) <= targetFrameScore(incoming)
            ? current.targetFrameRanges
            : incoming.targetFrameRanges;
  const unseenFrameCount =
    state === "complete"
      ? 0
      : minOptionalInt(current.unseenFrameCount, incoming.unseenFrameCount);
  const unseenFrameRanges =
    state === "complete"
      ? []
      : incoming.unseenFrameRanges.length === 0
        ? current.unseenFrameRanges
        : current.unseenFrameRanges.length === 0
          ? incoming.unseenFrameRanges
          : unseenFrameScore(current) <= unseenFrameScore(incoming)
            ? current.unseenFrameRanges
            : incoming.unseenFrameRanges;

  return {
    ...incoming,
    receivedUnique,
    decodeThreshold: maxOptionalInt(
      current.decodeThreshold,
      incoming.decodeThreshold
    ),
    totalPackets: maxOptionalInt(current.totalPackets, incoming.totalPackets),
    totalPacketsExact: current.totalPacketsExact || incoming.totalPacketsExact,
    state,
    missingCount,
    missingRanges: state === "complete" ? [] : missingRanges,
    targetFrameCount,
    targetFrameRanges,
    unseenFrameCount,
    unseenFrameRanges,
  };
}

function mergeChunks(
  current: ScanChunkState[],
  incoming: ScanChunkState[]
): ScanChunkState[] {
  const byId = new Map<number, ScanChunkState>();
  for (const chunkState of current) {
    byId.set(chunkState.chunkId, chunkState);
  }
  for (const chunkState of incoming) {
    const previous = byId.get(chunkState.chunkId);
    byId.set(
      chunkState.chunkId,
      previous ? mergeChunkState(previous, chunkState) : chunkState
    );
  }
  return Array.from(byId.values()).sort((left, right) => left.chunkId - right.chunkId);
}

function normalizeMergedCompletionPercent(state: {
  completionPercent: number;
  isComplete: boolean;
  fileAvailable: boolean;
}): number {
  return state.isComplete && state.fileAvailable
    ? 100
    : normalizeIncompleteCompletionPercent(state.completionPercent);
}

function canMergeLowerVersion(
  current: ScanSessionState,
  incoming: ScanSessionState
): boolean {
  if (incoming.stateVersion !== 0) {
    return false;
  }
  if (incoming.isComplete && incoming.fileAvailable) {
    return true;
  }

  const currentTime = Date.parse(current.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  return (
    incoming.updatedAt !== EPOCH_ISO &&
    Number.isFinite(currentTime) &&
    Number.isFinite(incomingTime) &&
    incomingTime >= currentTime
  );
}

export function mergeScanSessionState(
  current: ScanSessionState | null,
  incoming: ScanSessionState | null
): ScanSessionState | null {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return {
      ...incoming,
      completionPercent: normalizeMergedCompletionPercent(incoming),
    };
  }
  if (incoming.sessionId !== current.sessionId) {
    return current;
  }
  if (
    incoming.stateVersion < current.stateVersion &&
    !canMergeLowerVersion(current, incoming)
  ) {
    return current;
  }

  const incomingHasNewerVersion = incoming.stateVersion > current.stateVersion;
  let chunks = mergeChunks(current.chunks, incoming.chunks);
  const chunksTotal = effectiveChunksTotal(
    maxOptionalInt(current.chunksTotal, incoming.chunksTotal),
    chunks
  );
  const isComplete = current.isComplete || incoming.isComplete;
  const fileAvailable = current.fileAvailable || incoming.fileAvailable;
  if (isComplete && fileAvailable) {
    chunks = chunks.map((chunkState) => ({
      ...chunkState,
      state: "complete",
      missingCount: 0,
      missingRanges: [],
      targetFrameCount: 0,
      targetFrameRanges: [],
      unseenFrameCount: 0,
      unseenFrameRanges: [],
    }));
  }
  const chunksComplete = isComplete
    ? chunksTotal ?? Math.max(current.chunksComplete, incoming.chunksComplete)
    : Math.max(
        current.chunksComplete,
        incoming.chunksComplete,
        chunks.filter((chunkState) => chunkState.state === "complete").length
      );
  const computedChunksMissing =
    chunksTotal !== null
      ? Math.max(
          chunksTotal - chunksComplete,
          chunks.filter((chunkState) => chunkState.state !== "complete").length
        )
      : null;
  const chunksMissing = isComplete
    ? 0
    : minOptionalInt(
        current.chunksMissing,
        incoming.chunksMissing,
        computedChunksMissing
      );
  const decodeState =
    isComplete && fileAvailable
      ? "complete"
      : incomingHasNewerVersion
        ? incoming.decodeState
        : chooseDecodeState(current.decodeState, incoming.decodeState);
  const completionPercent = normalizeMergedCompletionPercent({
    completionPercent: Math.max(
      current.completionPercent,
      incoming.completionPercent
    ),
    isComplete,
    fileAvailable,
  });

  return {
    ...incoming,
    type: "scan-session-state",
    stateVersion: Math.max(current.stateVersion, incoming.stateVersion),
    sessionId: current.sessionId,
    status:
      isComplete && fileAvailable
        ? "complete"
        : current.status === "failed" || incoming.status === "failed"
          ? "failed"
          : "active",
    updatedAt: latestTimestamp(current.updatedAt, incoming.updatedAt),
    filename: incoming.filename ?? current.filename,
    receivedUnique: Math.max(current.receivedUnique, incoming.receivedUnique),
    decodeThreshold: maxOptionalInt(current.decodeThreshold, incoming.decodeThreshold),
    totalPackets: maxOptionalInt(current.totalPackets, incoming.totalPackets),
    totalPacketsExact: current.totalPacketsExact || incoming.totalPacketsExact,
    completionPercent,
    decodeState,
    isComplete,
    fileAvailable,
    chunksTotal,
    chunksComplete,
    chunksMissing,
    chunks,
    assembly: mergeAssembly(current.assembly, incoming.assembly, {
      preferIncoming: incomingHasNewerVersion,
      forceComplete: isComplete && fileAvailable,
    }),
  };
}
