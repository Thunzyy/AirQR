import type { WireValue } from "../parse/wire";

export interface NormalizedIncompleteProgress {
  received: number;
  total: number;
  totalIsEstimate: boolean;
  progressPercent: number;
  totalLabel: string;
}

export interface ScanPacketTransportIdentity {
  isStreaming: boolean;
  sessionId?: string;
  packetIndex?: number;
  chunkId?: number;
}

export interface ResolvedScanProgressTotals {
  uiTotal: number;
  totalIsEstimate: boolean;
  exactTransmittedTotal?: number;
  hasDecodeThreshold: boolean;
}

export interface ResolvedExactChunkTotals {
  chunkTotal?: number;
  globalTotal?: number;
}

function toSafeInt(value: WireValue | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
}

export function normalizeIncompleteProgress(
  receivedRaw: WireValue | undefined,
  totalRaw: WireValue | undefined,
  options: {
    totalIsEstimate?: boolean;
    progressPercent?: WireValue;
  } = {}
): NormalizedIncompleteProgress {
  const received = toSafeInt(receivedRaw);
  const rawTotal = toSafeInt(totalRaw);
  const totalIsEstimate =
    Boolean(options.totalIsEstimate) || (rawTotal > 0 && received > rawTotal);
  const total =
    rawTotal > 0
      ? Math.max(rawTotal, totalIsEstimate ? received : rawTotal)
      : 0;
  const denominator = total > 0 ? total : 0;
  const boundedForPercent =
    denominator > 0 ? Math.min(received, denominator) : 0;
  const progressFromOption = Number(options.progressPercent);
  const computedProgress =
    denominator > 0
      ? (boundedForPercent / denominator) * 100
      : 0;
  const progressSource = Number.isFinite(progressFromOption)
    ? progressFromOption
    : computedProgress;
  const progressPercent = Math.min(
    totalIsEstimate ? 99 : 100,
    Math.max(0, progressSource)
  );

  return {
    received,
    total,
    totalIsEstimate,
    progressPercent,
    totalLabel:
      denominator > 0
        ? totalIsEstimate
          ? `${denominator}`
          : `${denominator}`
        : "?",
  };
}

export function normalizeScanProgress(
  receivedRaw: WireValue | undefined,
  totalRaw: WireValue | undefined,
  options: {
    totalIsEstimate?: boolean;
    progressPercent?: WireValue;
  } = {}
): NormalizedIncompleteProgress {
  return normalizeIncompleteProgress(receivedRaw, totalRaw, options);
}

export function resolveScanProgressTotals(
  expectedRaw: WireValue | undefined,
  totalRaw: WireValue | undefined
): ResolvedScanProgressTotals {
  const expected = toSafeInt(expectedRaw);
  const exactTransmittedTotal = toSafeInt(totalRaw);
  const hasDecodeThreshold = expected > 0;

  if (hasDecodeThreshold) {
    return {
      uiTotal: expected,
      totalIsEstimate: false,
      exactTransmittedTotal:
        exactTransmittedTotal > 0 ? exactTransmittedTotal : undefined,
      hasDecodeThreshold: true,
    };
  }

  return {
    uiTotal: exactTransmittedTotal,
    totalIsEstimate: exactTransmittedTotal > 0,
    exactTransmittedTotal:
      exactTransmittedTotal > 0 ? exactTransmittedTotal : undefined,
    hasDecodeThreshold: false,
  };
}

export function resolveKnownGlobalExactChunkTotals(
  chunkExactTotals: Map<number, number>,
  options: {
    chunkId?: WireValue;
    totalChunks?: WireValue;
    chunkTotal?: WireValue;
  }
): ResolvedExactChunkTotals {
  const chunkIdRaw = Number(options.chunkId);
  const totalChunks = toSafeInt(options.totalChunks);
  const chunkTotal = toSafeInt(options.chunkTotal);
  const hasChunkId = Number.isFinite(chunkIdRaw) && chunkIdRaw >= 0;

  if (hasChunkId && chunkTotal > 0) {
    const chunkId = Math.trunc(chunkIdRaw);
    const previousTotal = chunkExactTotals.get(chunkId) ?? 0;
    chunkExactTotals.set(chunkId, Math.max(previousTotal, chunkTotal));
  }

  const resolvedChunkTotal = chunkTotal > 0 ? chunkTotal : undefined;
  if (totalChunks <= 1) {
    return {
      chunkTotal: resolvedChunkTotal,
      globalTotal: resolvedChunkTotal,
    };
  }

  if (totalChunks <= 0 || chunkExactTotals.size < totalChunks) {
    return {
      chunkTotal: resolvedChunkTotal,
    };
  }

  const globalTotal = Array.from(chunkExactTotals.values()).reduce(
    (sum, value) => sum + Math.max(0, Math.trunc(value)),
    0
  );

  return {
    chunkTotal: resolvedChunkTotal,
    globalTotal: globalTotal > 0 ? globalTotal : undefined,
  };
}

export function extractScanPacketTransportIdentity(
  packet: Uint8Array
): ScanPacketTransportIdentity {
  if (!(packet instanceof Uint8Array) || packet.length < 1) {
    return { isStreaming: false };
  }

  const isStreaming = packet[0] === 1 || packet[0] === 2;
  try {
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

    if (isStreaming) {
      const hasExactChunkTotal = packet[0] === 2;
      const minHeaderSize = hasExactChunkTotal ? 35 : 31;
      if (packet.length < minHeaderSize) {
        return { isStreaming: true };
      }
      const sessionId = view.getUint32(1, false);
      const symbolOffset = hasExactChunkTotal ? 31 : 27;
      return {
        isStreaming: true,
        sessionId:
          Number.isFinite(sessionId) && sessionId > 0
            ? String(sessionId)
            : undefined,
        chunkId: view.getUint32(5, false),
        packetIndex: view.getUint32(symbolOffset, false),
      };
    }

    if (packet.length < 10) {
      return { isStreaming: false };
    }

    return {
      isStreaming: false,
      chunkId: 0,
      packetIndex: view.getUint32(6, false),
    };
  } catch {
    return { isStreaming };
  }
}
