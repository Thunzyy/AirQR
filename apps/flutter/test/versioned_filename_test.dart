import 'dart:io';

import 'package:airqr_mobile/versioned_filename.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolveUniqueFilenameInDirectory', () {
    test('returns original name when it is available', () async {
      final directory = await Directory.systemTemp.createTemp('airqr-note-');
      addTearDown(() => directory.delete(recursive: true));

      final resolved = await resolveUniqueFilenameInDirectory(
        directory: directory,
        filename: 'note.md',
      );

      expect(resolved, 'note.md');
    });

    test('adds numeric suffix when file already exists', () async {
      final directory = await Directory.systemTemp.createTemp('airqr-note-');
      addTearDown(() => directory.delete(recursive: true));
      await File('${directory.path}${Platform.pathSeparator}note.md')
          .writeAsString('hello');
      await File('${directory.path}${Platform.pathSeparator}note (2).md')
          .writeAsString('hello');

      final resolved = await resolveUniqueFilenameInDirectory(
        directory: directory,
        filename: 'note.md',
      );

      expect(resolved, 'note (3).md');
    });
  });
}
