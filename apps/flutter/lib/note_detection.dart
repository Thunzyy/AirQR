import 'dart:convert';

const String noteFilenamePrefix = '__airqr_note__';
const String _defaultNoteExtension = 'txt';
const String _displayNoteBasename = 'note';

enum NoteFormat {
  plain,
  markdown,
  javascript,
  python,
  typescript,
  json,
  html,
  css,
  rust,
  sql,
  yaml,
  shell,
}

class NoteFormatOption {
  final NoteFormat value;
  final String extension;

  const NoteFormatOption({
    required this.value,
    required this.extension,
  });
}

const List<NoteFormatOption> noteFormatOptions = <NoteFormatOption>[
  NoteFormatOption(value: NoteFormat.plain, extension: 'txt'),
  NoteFormatOption(value: NoteFormat.markdown, extension: 'md'),
  NoteFormatOption(value: NoteFormat.javascript, extension: 'js'),
  NoteFormatOption(value: NoteFormat.python, extension: 'py'),
  NoteFormatOption(value: NoteFormat.typescript, extension: 'ts'),
  NoteFormatOption(value: NoteFormat.json, extension: 'json'),
  NoteFormatOption(value: NoteFormat.html, extension: 'html'),
  NoteFormatOption(value: NoteFormat.css, extension: 'css'),
  NoteFormatOption(value: NoteFormat.rust, extension: 'rs'),
  NoteFormatOption(value: NoteFormat.sql, extension: 'sql'),
  NoteFormatOption(value: NoteFormat.yaml, extension: 'yml'),
  NoteFormatOption(value: NoteFormat.shell, extension: 'sh'),
];

String _extensionForFormat(NoteFormat format) {
  for (final option in noteFormatOptions) {
    if (option.value == format) {
      return option.extension;
    }
  }
  return _defaultNoteExtension;
}

NoteFormat _formatForExtension(String extension) {
  for (final option in noteFormatOptions) {
    if (option.extension == extension) {
      return option.value;
    }
  }
  return NoteFormat.plain;
}

bool isNoteFilename(String? filename) {
  if (filename == null) return false;
  final normalized = filename.trim().toLowerCase();
  return normalized.startsWith('$noteFilenamePrefix.');
}

bool isNoteMimeType(String? mimeType) => mimeType == 'text/plain';

String getNoteExtension(String filename) {
  if (!isNoteFilename(filename)) {
    return _defaultNoteExtension;
  }
  final lastDot = filename.trim().lastIndexOf('.');
  if (lastDot < 0) {
    return _defaultNoteExtension;
  }
  return filename.trim().substring(lastDot + 1).toLowerCase();
}

NoteFormat getNoteFormatFromFilename(String filename) {
  return _formatForExtension(getNoteExtension(filename));
}

String buildNoteFilename(NoteFormat format) {
  return '$noteFilenamePrefix.${_extensionForFormat(format)}';
}

String getDisplayNoteFilename(String filename) {
  if (!isNoteFilename(filename)) {
    return filename;
  }
  return '$_displayNoteBasename.${getNoteExtension(filename)}';
}

String decodeNoteContent(List<int> data) {
  return const Utf8Decoder(allowMalformed: true).convert(data);
}
