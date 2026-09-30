/**
 * History normalization helpers
 */

import {
  asFiniteNumberList,
  asUint8Array,
  asWireFiniteNumber,
  asWireString,
  isWireNumber,
  type WireValue,
} from '../parse/wire';
import { formatDateCategory, formatSize } from './format';
import type { HistoryItem } from '../types';
import { getBinaryDataSize, type BinaryData } from './binaryData';
import {
  getDisplayNoteFilename,
  isNoteFilename,
} from './noteDetection';

const ZIP_SUFFIX = '.zip';
export type HistoryPreviewKind =
  | 'qr-gif'
  | 'zip'
  | 'image'
  | 'video'
  | 'pdf'
  | 'text'
  | 'unsupported';

const MIME_BY_EXTENSION = new Map<string, string>([
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['csv', 'text/csv'],
  ['css', 'text/css'],
  ['gif', 'image/gif'],
  ['htm', 'text/html'],
  ['html', 'text/html'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['js', 'application/javascript'],
  ['json', 'application/json'],
  ['m4v', 'video/mp4'],
  ['md', 'text/markdown'],
  ['mkv', 'video/x-matroska'],
  ['mov', 'video/quicktime'],
  ['mp4', 'video/mp4'],
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['svg', 'image/svg+xml'],
  ['ts', 'text/typescript'],
  ['txt', 'text/plain'],
  ['webm', 'video/webm'],
  ['webp', 'image/webp'],
  ['xml', 'application/xml'],
  ['yaml', 'application/yaml'],
  ['yml', 'application/yaml'],
  ['zip', 'application/zip'],
]);

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'css',
  'csv',
  'html',
  'htm',
  'js',
  'json',
  'log',
  'md',
  'py',
  'rs',
  'sh',
  'sql',
  'ts',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

const TEXT_PREVIEW_MIME_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'text/markdown',
  'text/typescript',
]);

const ZIP_STRIPPABLE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'svg',
  'heic',
  'heif',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'm4v',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'pdf',
  'txt',
  'md',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'bin',
]);

const HISTORY_SUBTITLE_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}) - (\d{2}:\d{2})(?::(\d{2}))?/;
const HISTORY_ID_TIMESTAMP_PATTERN = /^(?:scan_)?(\d{13,})$/;

type HistoryItemRecord = {
  id?: WireValue;
  origin?: WireValue;
  type?: WireValue;
  title?: WireValue;
  subtitle?: WireValue;
  date?: WireValue;
  sortTimestamp?: WireValue;
  updatedAt?: WireValue;
  createdAt?: WireValue;
  timestamp?: WireValue;
  category?: WireValue;
  size?: WireValue;
  fileData?: WireValue;
  data?: WireValue;
  mimeType?: WireValue;
  totalFrames?: WireValue;
  minFrames?: WireValue;
  chunkMinFrames?: WireValue;
  source?: WireValue;
  remoteSessionId?: WireValue;
  remoteHistoryId?: WireValue;
  isSynced?: WireValue;
  serverId?: WireValue;
  isLocalOnly?: WireValue;
  filename?: WireValue;
};

const toBinaryData = (value: WireValue | undefined): BinaryData | undefined => {
  if (value instanceof Blob) {
    return value;
  }
  return asUint8Array(value);
};

const isHistoryOrigin = (value: WireValue | undefined): value is HistoryItem['origin'] =>
  value === 'scanned' || value === 'generated';

const isHistoryType = (value: WireValue | undefined): value is HistoryItem['type'] =>
  value === 'file' ||
  value === 'text' ||
  value === 'wifi' ||
  value === 'contact' ||
  value === 'payment';

const isHistoryCategory = (
  value: WireValue | undefined
): value is NonNullable<HistoryItem['category']> =>
  value === 'today' || value === 'yesterday' || value === 'older';

const isTextMimeType = (value: WireValue | undefined): value is string => {
  const mimeType = asWireString(value);
  return mimeType !== undefined && mimeType.toLowerCase().startsWith('text/');
};

const getFilenameExtension = (filename: WireValue | undefined): string => {
  const text = asWireString(filename);
  if (text === undefined) {
    return '';
  }
  const cleanFilename = text.split(/[?#]/, 1)[0]?.trim() ?? '';
  const lastSlash = Math.max(cleanFilename.lastIndexOf('/'), cleanFilename.lastIndexOf('\\'));
  const basename = cleanFilename.slice(lastSlash + 1);
  const lastDot = basename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return '';
  }
  return basename.slice(lastDot + 1).toLowerCase();
};

export const inferMimeTypeFromFilename = (
  filename: WireValue | undefined
): string | undefined => {
  const extension = getFilenameExtension(filename);
  return extension ? MIME_BY_EXTENSION.get(extension) : undefined;
};

const isTextPreviewMimeType = (mimeType: WireValue | undefined): boolean => {
  if (isTextMimeType(mimeType)) {
    return true;
  }
  const text = asWireString(mimeType);
  return text !== undefined && TEXT_PREVIEW_MIME_TYPES.has(text.toLowerCase());
};

export const resolveHistoryPreviewKind = (
  item: Pick<HistoryItem, 'type' | 'title' | 'mimeType'>
): HistoryPreviewKind => {
  const mimeType = (item.mimeType || inferMimeTypeFromFilename(item.title) || '').toLowerCase();
  const extension = getFilenameExtension(item.title);

  if (item.type === 'text' || isTextPreviewMimeType(mimeType) || TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return 'text';
  }
  if (mimeType === 'application/zip' || extension === 'zip') {
    return 'zip';
  }
  if (mimeType === 'image/gif' || extension === 'gif') {
    return 'qr-gif';
  }
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return 'pdf';
  }
  return 'unsupported';
};

export const isHistoryItemPreviewable = (
  item: Pick<HistoryItem, 'type' | 'title' | 'mimeType'>
): boolean => resolveHistoryPreviewKind(item) !== 'unsupported';

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripTrailingExtension = (value: string): string => {
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0) {
    return value;
  }
  const ext = value.slice(lastDot + 1).toLowerCase();
  if (!ZIP_STRIPPABLE_EXTS.has(ext)) {
    return value;
  }
  return value.slice(0, lastDot);
};

export const toZipFilename = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) {
    return `archive${ZIP_SUFFIX}`;
  }

  let base = trimmed;
  if (base.toLowerCase().endsWith(ZIP_SUFFIX)) {
    base = base.slice(0, -ZIP_SUFFIX.length);
    base = stripTrailingExtension(base);
    return `${base}${ZIP_SUFFIX}`;
  }

  base = stripTrailingExtension(base);
  return `${base}${ZIP_SUFFIX}`;
};

export function getVersionedHistoryTitle(
  items: Array<Pick<HistoryItem, 'title'>>,
  desiredTitle: string
): string {
  const normalizedTitle = desiredTitle.trim();
  if (!normalizedTitle) {
    return desiredTitle;
  }

  const existingTitles = items
    .map((item) => item.title.trim())
    .filter(Boolean);
  const hasExactMatch = existingTitles.some(
    (title) => title.toLowerCase() === normalizedTitle.toLowerCase()
  );

  if (!hasExactMatch) {
    return normalizedTitle;
  }

  const lastDot = normalizedTitle.lastIndexOf('.');
  const hasExtension = lastDot > 0;
  const baseName = hasExtension ? normalizedTitle.slice(0, lastDot) : normalizedTitle;
  const extension = hasExtension ? normalizedTitle.slice(lastDot) : '';
  const versionPattern = new RegExp(
    `^${escapeRegExp(baseName)}(?: \\((\\d+)\\))?${escapeRegExp(extension)}$`,
    'i'
  );

  let maxVersion = 1;
  for (const title of existingTitles) {
    const match = title.match(versionPattern);
    if (!match) {
      continue;
    }

    const version = match[1] ? Number(match[1]) : 1;
    if (Number.isFinite(version)) {
      maxVersion = Math.max(maxVersion, version);
    }
  }

  return `${baseName} (${maxVersion + 1})${extension}`;
}

const parseTimestamp = (value: WireValue | undefined): number => {
  if (isWireNumber(value)) {
    return value;
  }
  const text = asWireString(value);
  if (text !== undefined) {
    const numericValue = asWireFiniteNumber(text);
    if (numericValue !== undefined && numericValue > 1_600_000_000_000) {
      return numericValue;
    }
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
};

const parseSubtitleTimestamp = (subtitle: WireValue | undefined): number | null => {
  const text = asWireString(subtitle);
  if (text === undefined) {
    return null;
  }

  const match = text.match(HISTORY_SUBTITLE_TIMESTAMP_PATTERN);
  if (!match) {
    return null;
  }

  const [, datePart, hourMinute, seconds = '00'] = match;
  const parsed = Date.parse(`${datePart}T${hourMinute}:${seconds}`);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseHistoryIdTimestamp = (id: WireValue | undefined): number | null => {
  const text = asWireString(id);
  if (text === undefined) {
    return null;
  }

  const match = text.match(HISTORY_ID_TIMESTAMP_PATTERN);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveHistoryItemSortTimestamp = (raw: {
  sortTimestamp?: WireValue;
  timestamp?: WireValue;
  updatedAt?: WireValue;
  createdAt?: WireValue;
  date?: WireValue;
  subtitle?: WireValue;
  id?: WireValue;
}): string => {
  const dateText = asWireString(raw.date);
  const candidates = [
    raw.sortTimestamp,
    raw.timestamp,
    raw.updatedAt,
    raw.createdAt,
    dateText !== undefined && dateText.includes('T') ? dateText : undefined,
    parseSubtitleTimestamp(raw.subtitle),
    parseHistoryIdTimestamp(raw.id),
    raw.date,
  ];

  for (const candidate of candidates) {
    const timestamp = parseTimestamp(candidate ?? undefined);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  return new Date().toISOString();
};

export const normalizeHistoryItem = (raw: HistoryItemRecord | null | undefined): HistoryItem => {
  const fallbackId = Date.now().toString();
  const sortTimestamp = resolveHistoryItemSortTimestamp(raw ?? {});
  const timestamp = parseTimestamp(sortTimestamp);
  const dateValue = asWireString(raw?.date) ?? asWireFiniteNumber(raw?.date) ?? sortTimestamp;
  const parsed = new Date(dateValue);
  const safeDate = Number.isNaN(parsed.getTime())
    ? new Date(timestamp).toISOString().split('T')[0]
    : parsed.toISOString().split('T')[0];

  const fileData = toBinaryData(raw?.fileData ?? raw?.data);

  const title =
    asWireString(raw?.title) ?? asWireString(raw?.filename) ?? 'Unknown File';
  const noteLikeTitle = isNoteFilename(title);
  const mimeType =
    asWireString(raw?.mimeType) ||
    (noteLikeTitle
      ? 'text/plain'
      : inferMimeTypeFromFilename(title) || 'application/octet-stream');
  const origin: HistoryItem['origin'] =
    isHistoryOrigin(raw?.origin)
      ? raw.origin
      : raw?.type === 'decoded'
    ? 'scanned'
    : 'generated';
  const inferredTextType = noteLikeTitle || isTextMimeType(mimeType);
  const type: HistoryItem['type'] =
    raw?.type === 'wifi' || raw?.type === 'contact' || raw?.type === 'payment'
      ? raw.type
      : inferredTextType
      ? 'text'
      : isHistoryType(raw?.type)
      ? raw.type
      : 'file';
  const size = asWireFiniteNumber(raw?.size) ?? getBinaryDataSize(fileData);
  const subtitle =
    asWireString(raw?.subtitle) ??
    `${new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })} - ${formatSize(size)}`;
  const category: HistoryItem['category'] =
    isHistoryCategory(raw?.category)
      ? raw.category
    : formatDateCategory(safeDate);
  const chunkMinFrames = asFiniteNumberList(raw?.chunkMinFrames);
  const source: HistoryItem['source'] =
    raw?.source === 'server' || raw?.source === 'local' ? raw.source : undefined;
  const remoteSessionId = asWireString(raw?.remoteSessionId);
  const remoteHistoryId = asWireString(raw?.remoteHistoryId);

  // Sync status fields
  const isSynced = raw?.isSynced === true;
  const serverId = asWireString(raw?.serverId);
  const isLocalOnly = raw?.isLocalOnly === true;

  return {
    id: asWireString(raw?.id) ?? fallbackId,
    origin,
    type,
    title: noteLikeTitle ? getDisplayNoteFilename(title) : title,
    subtitle,
    date: safeDate,
    sortTimestamp,
    category,
    fileData,
    mimeType,
    totalFrames: asWireFiniteNumber(raw?.totalFrames),
    minFrames: asWireFiniteNumber(raw?.minFrames),
    chunkMinFrames: chunkMinFrames && chunkMinFrames.length > 0 ? chunkMinFrames : undefined,
    source,
    remoteSessionId,
    remoteHistoryId,
    isSynced,
    serverId,
    isLocalOnly,
  };
};

export const stripHistoryItemData = (item: HistoryItem): HistoryItem => {
  if (!item.fileData) {
    return item;
  }
  const { fileData: _fileData, ...rest } = item;
  return rest;
};

// ========== Factory function for creating history items ==========

export interface CreateHistoryItemParams {
  /** Unique identifier (sessionId for scans, timestamp for generated) */
  id: string;
  /** Origin of the item */
  origin: 'scanned' | 'generated';
  /** Filename or title */
  filename: string;
  /** File data as Uint8Array or Blob */
  fileData: BinaryData;
  /** Optional MIME type (auto-detected if not provided) */
  mimeType?: string;
  /** Optional timestamp (defaults to now) */
  timestamp?: number;
  /** Total frames in the GIF (for generated items) */
  totalFrames?: number;
  /** Minimum frames needed to decode (for generated items) */
  minFrames?: number;
  /** Minimum frames per chunk (for chunked encoding) */
  chunkMinFrames?: number[];
}

/**
 * Creates a standardized HistoryItem with consistent formatting.
 * Use this function everywhere you need to create a new history item.
 */
export function createHistoryItem(params: CreateHistoryItemParams): HistoryItem {
  const {
    id,
    origin,
    filename,
    fileData,
    mimeType: providedMimeType,
    timestamp = Date.now(),
    totalFrames,
    minFrames,
    chunkMinFrames,
  } = params;

  const date = new Date(timestamp);
  const dateLabel = date.toISOString().split('T')[0];
  const sortTimestamp = date.toISOString();
  const timeLabel = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const size = getBinaryDataSize(fileData);
  const noteLikeFilename = isNoteFilename(filename);
  const title = noteLikeFilename ? getDisplayNoteFilename(filename) : filename;

  // Auto-detect MIME type from filename if not provided
  const mimeType =
    providedMimeType ||
    (noteLikeFilename
      ? 'text/plain'
      : inferMimeTypeFromFilename(filename) || 'application/octet-stream');

  return {
    id,
    origin,
    type: noteLikeFilename || isTextMimeType(mimeType) ? 'text' : 'file',
    title,
    subtitle: `${dateLabel} - ${timeLabel} - ${formatSize(size)}`,
    date: dateLabel,
    sortTimestamp,
    size,
    category: 'today',
    fileData,
    mimeType,
    totalFrames,
    minFrames,
    chunkMinFrames,
  };
}
