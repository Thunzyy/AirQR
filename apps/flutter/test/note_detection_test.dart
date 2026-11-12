import 'package:airqr_mobile/note_detection.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('note_detection', () {
    test('builds and recognizes note transport filenames', () {
      final filename = buildNoteFilename(NoteFormat.markdown);

      expect(filename, '__airqr_note__.md');
      expect(isNoteFilename(filename), isTrue);
      expect(getNoteExtension(filename), 'md');
      expect(getNoteFormatFromFilename(filename), NoteFormat.markdown);
      expect(getDisplayNoteFilename(filename), 'note.md');
    });

    test('falls back safely for non note filenames', () {
      expect(isNoteFilename('archive.zip'), isFalse);
      expect(getNoteExtension('archive.zip'), 'txt');
      expect(getDisplayNoteFilename('archive.zip'), 'archive.zip');
    });

    test('decodes UTF-8 note bytes with malformed support', () {
      expect(decodeNoteContent(const <int>[104, 101, 108, 108, 111]), 'hello');
    });
  });
}
