import type { HistoryItem, IncompleteScanItem } from '../../types';
import { resolveServerBaseUrl } from '../../services/syncUrl';

export type RemoteHistoryOrigin = HistoryItem['origin'];
export type RemoteHistoryServerScope = string;

type RemoteHistoryTombstone = {
  version: number;
  confirmedAbsent: boolean;
  durablePurgeAcknowledged: boolean;
};

const MAX_TOMBSTONES_PER_SERVER = 1024;
const tombstonesByServer = new Map<
  RemoteHistoryServerScope,
  Map<string, RemoteHistoryTombstone>
>();
const activeStaleSources = new Set<number>();
let nextStaleSourceId = 0;
let tombstoneVersion = 0;

export function getRemoteHistoryServerScope(
  rawUrl: string
): RemoteHistoryServerScope {
  return resolveServerBaseUrl(rawUrl) ?? `invalid:${rawUrl.trim().toLowerCase()}`;
}

function getServerTombstones(
  serverScope: RemoteHistoryServerScope
): Map<string, RemoteHistoryTombstone> {
  let tombstones = tombstonesByServer.get(serverScope);
  if (!tombstones) {
    tombstones = new Map<string, RemoteHistoryTombstone>();
    tombstonesByServer.set(serverScope, tombstones);
  }
  return tombstones;
}

function tombstoneKey(origin: RemoteHistoryOrigin, id: string): string {
  return `${origin}:${id}`;
}

export function recordRemoteHistoryDeletion(
  serverScope: RemoteHistoryServerScope,
  origin: RemoteHistoryOrigin,
  remoteId: string
): number {
  const tombstones = getServerTombstones(serverScope);
  const key = tombstoneKey(origin, remoteId);
  tombstones.delete(key);
  const version = ++tombstoneVersion;
  tombstones.set(key, {
    version,
    confirmedAbsent: false,
    durablePurgeAcknowledged: false,
  });
  return version;
}

export function acknowledgeRemoteHistoryDurablePurge(
  serverScope: RemoteHistoryServerScope,
  origin: RemoteHistoryOrigin,
  remoteId: string,
  expectedVersion: number
): boolean {
  const tombstone = tombstonesByServer
    .get(serverScope)
    ?.get(tombstoneKey(origin, remoteId));
  if (!tombstone || tombstone.version !== expectedVersion) return false;
  tombstone.durablePurgeAcknowledged = true;
  trimServerTombstones(serverScope);
  return true;
}

export function captureRemoteHistoryTombstoneVersion(): number {
  return tombstoneVersion;
}

function trimServerTombstones(serverScope: RemoteHistoryServerScope): void {
  if (activeStaleSources.size > 0) return;
  const tombstones = tombstonesByServer.get(serverScope);
  if (!tombstones || tombstones.size <= MAX_TOMBSTONES_PER_SERVER) return;

  for (const [key, tombstone] of tombstones) {
    if (tombstones.size <= MAX_TOMBSTONES_PER_SERVER) break;
    if (tombstone.confirmedAbsent && tombstone.durablePurgeAcknowledged) {
      tombstones.delete(key);
    }
  }
}

export function beginRemoteHistoryStaleSource(): () => void {
  const sourceId = ++nextStaleSourceId;
  activeStaleSources.add(sourceId);
  return () => {
    if (!activeStaleSources.delete(sourceId)) return;
    for (const serverScope of tombstonesByServer.keys()) {
      trimServerTombstones(serverScope);
    }
  };
}

export function reconcileRemoteHistoryTombstones(
  serverScope: RemoteHistoryServerScope,
  watermark: number,
  historyItems: HistoryItem[],
  incompleteItems: IncompleteScanItem[],
  isComplete: boolean
): void {
  if (!isComplete) return;
  const tombstones = tombstonesByServer.get(serverScope);
  if (!tombstones) return;

  const presentKeys = new Set<string>();
  for (const item of historyItems) {
    for (const id of [
      item.id,
      item.serverId,
      item.remoteHistoryId,
      item.remoteSessionId,
    ]) {
      if (id) presentKeys.add(tombstoneKey(item.origin, id));
    }
  }
  for (const item of incompleteItems) {
    for (const id of [item.sessionId, item.remoteSessionId]) {
      if (id) presentKeys.add(tombstoneKey('scanned', id));
    }
  }

  for (const [key, tombstone] of tombstones) {
    if (tombstone.version <= watermark) {
      tombstone.confirmedAbsent = !presentKeys.has(key);
    }
  }
  trimServerTombstones(serverScope);
}

export function resetRemoteHistoryTombstones(): void {
  tombstonesByServer.clear();
  activeStaleSources.clear();
  tombstoneVersion = 0;
}

export function matchesRemoteHistoryDeletion(
  item: HistoryItem,
  origin: RemoteHistoryOrigin,
  remoteId: string
): boolean {
  if (item.origin !== origin || item.isLocalOnly) return false;

  const isServerBacked =
    item.source === 'server' ||
    item.isSynced === true ||
    Boolean(item.serverId || item.remoteHistoryId || item.remoteSessionId);
  if (!isServerBacked) return false;

  return [item.id, item.serverId, item.remoteHistoryId, item.remoteSessionId].some(
    (id) => id === remoteId
  );
}

export function matchesRemoteIncompleteDeletion(
  item: IncompleteScanItem,
  remoteId: string
): boolean {
  const isServerBacked = item.source === 'server' || Boolean(item.remoteSessionId);
  return (
    isServerBacked &&
    (item.sessionId === remoteId || item.remoteSessionId === remoteId)
  );
}

export function isHistoryItemTombstoned(
  serverScope: RemoteHistoryServerScope | null,
  item: HistoryItem
): boolean {
  if (!serverScope) return false;
  const tombstones = tombstonesByServer.get(serverScope);
  if (!tombstones) return false;
  return [item.id, item.serverId, item.remoteHistoryId, item.remoteSessionId].some(
    (id) =>
      id != null &&
      tombstones.has(tombstoneKey(item.origin, id)) &&
      matchesRemoteHistoryDeletion(item, item.origin, id)
  );
}

export function isIncompleteScanTombstoned(
  serverScope: RemoteHistoryServerScope | null,
  item: IncompleteScanItem
): boolean {
  if (!serverScope) return false;
  const tombstones = tombstonesByServer.get(serverScope);
  if (!tombstones) return false;
  return [item.sessionId, item.remoteSessionId].some(
    (id) =>
      id != null &&
      tombstones.has(tombstoneKey('scanned', id)) &&
      matchesRemoteIncompleteDeletion(item, id)
  );
}

export function withoutTombstonedHistoryItems(
  serverScope: RemoteHistoryServerScope | null,
  items: HistoryItem[]
): HistoryItem[] {
  return items.filter((item) => !isHistoryItemTombstoned(serverScope, item));
}

export function withoutTombstonedIncompleteScans(
  serverScope: RemoteHistoryServerScope | null,
  items: IncompleteScanItem[]
): IncompleteScanItem[] {
  return items.filter(
    (item) => !isIncompleteScanTombstoned(serverScope, item)
  );
}
