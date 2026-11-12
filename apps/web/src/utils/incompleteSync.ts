import type {
  IncompleteScanItem,
  PersistedIncompleteScanItem,
} from "../types";

type IncompleteScanIdentity =
  | Pick<IncompleteScanItem, "sessionId" | "remoteSessionId">
  | Pick<PersistedIncompleteScanItem, "sessionId" | "remoteSessionId">;

export function getIncompleteScanCanonicalSessionId(
  item?: IncompleteScanIdentity | null
): string | undefined {
  const remoteSessionId =
    item?.remoteSessionId && item.remoteSessionId.length > 0
      ? item.remoteSessionId
      : undefined;
  const sessionId =
    item?.sessionId && item.sessionId.length > 0 ? item.sessionId : undefined;
  return remoteSessionId || sessionId;
}

export function getIncompleteScanSessionKeys(
  item?: IncompleteScanIdentity | null
): string[] {
  const sessionId =
    item?.sessionId && item.sessionId.length > 0 ? item.sessionId : undefined;
  const canonicalSessionId = getIncompleteScanCanonicalSessionId(item);
  if (!sessionId && !canonicalSessionId) {
    return [];
  }
  if (!sessionId || sessionId === canonicalSessionId) {
    return canonicalSessionId ? [canonicalSessionId] : [];
  }
  return canonicalSessionId ? [sessionId, canonicalSessionId] : [sessionId];
}

function mergeDuplicateIncompleteScanItems(
  existing: IncompleteScanItem,
  incoming: IncompleteScanItem
): IncompleteScanItem {
  const canonicalSessionId =
    getIncompleteScanCanonicalSessionId(existing) ||
    getIncompleteScanCanonicalSessionId(incoming);
  const preferredSessionId =
    existing.sessionId !== canonicalSessionId
      ? existing.sessionId
      : incoming.sessionId !== canonicalSessionId
        ? incoming.sessionId
        : existing.sessionId || incoming.sessionId;

  const mergedTotalChunks = Math.max(
    Number(existing.totalChunks ?? 0),
    Number(incoming.totalChunks ?? 0)
  );
  const mergedChunksCompleted = Math.max(
    Number(existing.chunksCompleted ?? 0),
    Number(incoming.chunksCompleted ?? 0)
  );
  const mergedChunksSaved = Math.max(
    Number(existing.chunksSaved ?? 0),
    Number(incoming.chunksSaved ?? 0)
  );
  const mergedProgressPercent = Math.max(
    Number(existing.progressPercent ?? 0),
    Number(incoming.progressPercent ?? 0)
  );

  return {
    ...incoming,
    ...existing,
    sessionId: preferredSessionId,
    remoteSessionId:
      canonicalSessionId && canonicalSessionId !== preferredSessionId
        ? canonicalSessionId
        : existing.remoteSessionId || incoming.remoteSessionId,
    filename: existing.filename || incoming.filename,
    received: Math.max(existing.received, incoming.received),
    total: Math.max(existing.total, incoming.total),
    totalIsEstimate:
      existing.totalIsEstimate ?? incoming.totalIsEstimate ?? true,
    progressPercent:
      mergedProgressPercent > 0 ? mergedProgressPercent : undefined,
    date: existing.date || incoming.date,
    chunksCompleted:
      mergedChunksCompleted > 0 ? mergedChunksCompleted : undefined,
    totalChunks: mergedTotalChunks > 0 ? mergedTotalChunks : undefined,
    chunksSaved: mergedChunksSaved > 0 ? mergedChunksSaved : undefined,
    source:
      existing.source === "server" || incoming.source === "server"
        ? "server"
        : existing.source || incoming.source,
    deviceId: existing.deviceId || incoming.deviceId,
    deviceName: existing.deviceName || incoming.deviceName,
  };
}

export function coalesceIncompleteScanItems(
  items: IncompleteScanItem[]
): IncompleteScanItem[] {
  if (items.length <= 1) {
    return items;
  }

  const coalesced: IncompleteScanItem[] = [];
  const indexByCanonicalId = new Map<string, number>();

  for (const item of items) {
    const canonicalSessionId = getIncompleteScanCanonicalSessionId(item);
    if (!canonicalSessionId) {
      coalesced.push(item);
      continue;
    }

    const existingIndex = indexByCanonicalId.get(canonicalSessionId);
    if (existingIndex === undefined) {
      indexByCanonicalId.set(canonicalSessionId, coalesced.length);
      coalesced.push(item);
      continue;
    }

    coalesced[existingIndex] = mergeDuplicateIncompleteScanItems(
      coalesced[existingIndex],
      item
    );
  }

  return coalesced;
}

export function getLegacyIncompleteScanPackets(
  item?: IncompleteScanItem | PersistedIncompleteScanItem | null
): Uint8Array[] {
  const packets = item && "packets" in item ? item.packets ?? [] : [];
  return packets
    .map((packet) =>
      packet instanceof Uint8Array ? packet : new Uint8Array(packet)
    )
    .filter((packet) => packet.length > 0);
}

export function getLegacyIncompleteScanChunks(
  item?: IncompleteScanItem | PersistedIncompleteScanItem | null
): Array<{ id: number; data: Uint8Array }> {
  const chunks = item && "chunks" in item ? item.chunks ?? [] : [];
  return chunks
    .filter(
      (chunk) =>
        Number.isFinite(chunk?.id) &&
        chunk.id >= 0 &&
        chunk.data != null
    )
    .map((chunk) => ({
      id: chunk.id,
      data:
        chunk.data instanceof Uint8Array
          ? chunk.data
          : new Uint8Array(chunk.data),
    }))
    .filter((chunk) => chunk.data.length > 0);
}

export function stripIncompleteScanBuffers(
  item: IncompleteScanItem | PersistedIncompleteScanItem
): IncompleteScanItem {
  const { packets: _packets, chunks: _chunks, ...rest } = {
    packets: undefined,
    chunks: undefined,
    ...item,
  };
  return rest;
}

export function mergeIncompleteScanItems(
  localItems: IncompleteScanItem[],
  remoteItems: IncompleteScanItem[]
): IncompleteScanItem[] {
  const coalescedLocalItems = coalesceIncompleteScanItems(localItems);
  const coalescedRemoteItems = coalesceIncompleteScanItems(remoteItems);

  if (remoteItems.length === 0) {
    return coalescedLocalItems;
  }

  const localBySession = new Map(
    coalescedLocalItems
      .map((item) => {
        const canonicalSessionId = getIncompleteScanCanonicalSessionId(item);
        return canonicalSessionId
          ? ([canonicalSessionId, item] as const)
          : null;
      })
      .filter((entry): entry is readonly [string, IncompleteScanItem] => entry != null)
  );
  const merged: IncompleteScanItem[] = [];

  for (const remoteItem of coalescedRemoteItems) {
    const canonicalSessionId =
      getIncompleteScanCanonicalSessionId(remoteItem) || remoteItem.sessionId;
    const localItem = localBySession.get(canonicalSessionId);
    if (!localItem) {
      merged.push(remoteItem);
      continue;
    }

    // Server is the source of truth for shared counters.
    // Keep local-only metadata that helps resume and UI continuity.
    merged.push({
      ...localItem,
      ...remoteItem,
      sessionId: localItem.sessionId,
      source: "server",
      remoteSessionId:
        canonicalSessionId !== localItem.sessionId
          ? canonicalSessionId
          : remoteItem.remoteSessionId || localItem.remoteSessionId,
      // Do not regress the visible scan packet count while the local browser is
      // uploading an already-captured incomplete scan to the shared server. The
      // server count can legitimately start at 0 and climb, but that is sync
      // progress, not scan progress. Keep it separately for the UI.
      received: Math.max(localItem.received, remoteItem.received),
      total: Math.max(localItem.total, remoteItem.total),
      serverReceived: remoteItem.received,
      serverTotal: remoteItem.total,
      totalIsEstimate:
        remoteItem.totalIsEstimate ?? localItem.totalIsEstimate ?? true,
      chunksSaved: localItem.chunksSaved ?? remoteItem.chunksSaved,
      chunksCompleted: localItem.chunksCompleted ?? remoteItem.chunksCompleted,
      totalChunks: localItem.totalChunks ?? remoteItem.totalChunks,
    });

    localBySession.delete(canonicalSessionId);
  }

  for (const localItem of localBySession.values()) {
    merged.push(localItem);
  }

  return coalesceIncompleteScanItems(merged);
}

export function shouldBackfillIncompleteSession(
  localReceived: number,
  remoteReceived?: number
): boolean {
  const safeLocal = Number.isFinite(localReceived) ? Math.max(0, localReceived) : 0;
  const safeRemote =
    remoteReceived !== undefined && Number.isFinite(remoteReceived)
      ? Math.max(0, remoteReceived)
      : 0;

  if (safeLocal <= 0) return false;
  if (remoteReceived === undefined) return true;
  return safeLocal > safeRemote + 1;
}
