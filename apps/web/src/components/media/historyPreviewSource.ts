import type { HistoryItem } from '../../types';
import { resolveHistoryPreviewKind } from '../../utils/history';
import { getBinaryDataSize, toBinaryBlob, toUint8Array } from '../../utils/binaryData';
import { decodeNoteContent } from '../../utils/noteDetection';
import { unzipFilesInWorker } from '../../utils/zipWorker';
import { evictGifSource } from './gifFrameSource';

export type PreparedHistoryPreview = {
  item: HistoryItem;
  kind: ReturnType<typeof resolveHistoryPreviewKind>;
  gifUrl?: string;
  previewUrl?: string;
  noteContent?: string;
  chunks: string[];
  byteLength: number;
};

const dataIds = new WeakMap<object, number>();
let nextDataId = 0;

export function historyPreviewKey(item: HistoryItem): string {
  let dataId: number | undefined;
  if (item.fileData) {
    dataId = dataIds.get(item.fileData);
    if (dataId === undefined) {
      dataId = ++nextDataId;
      dataIds.set(item.fileData, dataId);
    }
  }
  return JSON.stringify([item.id, item.source, item.origin, item.remoteHistoryId,
    item.remoteSessionId, item.serverId, item.sortTimestamp, item.date,
    item.size, item.title, item.mimeType, item.totalFrames, item.minFrames, item.chunkMinFrames, dataId]);
}

export function disposeHistoryPreview(preview: PreparedHistoryPreview): void {
  for (const url of new Set([preview.gifUrl, preview.previewUrl, ...preview.chunks])) {
    if (!url) continue;
    evictGifSource(url);
    URL.revokeObjectURL(url);
  }
}

export async function prepareHistoryPreview(item: HistoryItem): Promise<PreparedHistoryPreview> {
  if (!item.fileData) throw new Error('History data unavailable');
  const kind = resolveHistoryPreviewKind(item);
  const result: PreparedHistoryPreview = {
    item, kind, chunks: [], byteLength: getBinaryDataSize(item.fileData),
  };
  try {
    if (kind === 'text') {
      result.noteContent = decodeNoteContent(await toUint8Array(item.fileData));
    } else if (kind === 'zip') {
      const entries = await unzipFilesInWorker(await toUint8Array(item.fileData), {
        filterExt: '.gif', transfer: false,
      });
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const entry of entries) {
        const blob = new Blob([new Uint8Array(entry.data)], { type: 'image/gif' });
        result.chunks.push(URL.createObjectURL(blob));
        result.byteLength += blob.size;
      }
      result.gifUrl = result.chunks[0];
    } else if (kind === 'qr-gif') {
      result.gifUrl = URL.createObjectURL(toBinaryBlob(item.fileData, 'image/gif'));
    } else if (kind === 'image' || kind === 'video' || kind === 'pdf') {
      result.previewUrl = URL.createObjectURL(toBinaryBlob(item.fileData, item.mimeType || 'application/octet-stream'));
    }
    return result;
  } catch (error) {
    disposeHistoryPreview(result);
    throw error;
  }
}
