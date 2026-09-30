import { NOTE_FORMAT_OPTIONS } from '../constants';
import type { NoteFormat } from '../types';

export const NOTE_FILENAME_PREFIX = '__airqr_note__';
const DEFAULT_NOTE_EXTENSION = 'txt';
const DISPLAY_NOTE_BASENAME = 'note';

const NOTE_EXTENSION_BY_FORMAT = new Map<NoteFormat, string>(
  NOTE_FORMAT_OPTIONS.map((option) => [option.value, option.extension])
);

const NOTE_FORMAT_BY_EXTENSION = new Map<string, NoteFormat>(
  NOTE_FORMAT_OPTIONS.map((option) => [option.extension, option.value])
);

export function isNoteFilename(filename: string | null | undefined): boolean {
  if (filename === undefined || filename === null) {
    return false;
  }

  return filename.trim().toLowerCase().startsWith(`${NOTE_FILENAME_PREFIX}.`);
}

export function getNoteExtension(filename: string): string {
  if (!isNoteFilename(filename)) {
    return DEFAULT_NOTE_EXTENSION;
  }

  const normalized = filename.trim();
  const lastDot = normalized.lastIndexOf('.');
  return lastDot >= 0 ? normalized.slice(lastDot + 1).toLowerCase() : DEFAULT_NOTE_EXTENSION;
}

export function getNoteFormatFromFilename(filename: string): NoteFormat {
  return NOTE_FORMAT_BY_EXTENSION.get(getNoteExtension(filename)) ?? 'plain';
}

export function buildNoteFilename(format: NoteFormat): string {
  const extension = NOTE_EXTENSION_BY_FORMAT.get(format) ?? DEFAULT_NOTE_EXTENSION;
  return `${NOTE_FILENAME_PREFIX}.${extension}`;
}

export function getDisplayNoteFilename(filename: string): string {
  if (!isNoteFilename(filename)) {
    return filename;
  }

  return `${DISPLAY_NOTE_BASENAME}.${getNoteExtension(filename)}`;
}

export function decodeNoteContent(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data);
}
