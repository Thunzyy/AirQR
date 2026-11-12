import 'dart:io';

import 'package:airqr_mobile/file_export.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('airqr-file-export-');
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  test('desktop save copies the source file to the picked path', () async {
    final source = File(p.join(tempDir.path, 'generated.gif'));
    await source.writeAsBytes(const <int>[71, 73, 70, 57]);
    final destPath = p.join(tempDir.path, 'export', 'saved.gif');

    final saved = await saveExistingFileToDevice(
      sourcePath: source.path,
      fileName: 'generated.gif',
      useDesktopPicker: true,
      pickSavePath: ({required fileName, dialogTitle}) async {
        expect(fileName, 'generated.gif');
        return destPath;
      },
    );

    expect(saved, destPath);
    expect(await File(destPath).readAsBytes(), <int>[71, 73, 70, 57]);
  });

  test('desktop save cancel returns null without copying', () async {
    final source = File(p.join(tempDir.path, 'generated.gif'));
    await source.writeAsBytes(const <int>[1, 2, 3]);

    final saved = await saveExistingFileToDevice(
      sourcePath: source.path,
      fileName: 'generated.gif',
      useDesktopPicker: true,
      pickSavePath: ({required fileName, dialogTitle}) async => null,
    );

    expect(saved, isNull);
  });

  test(
    'mobile MissingPluginException falls back to the desktop picker',
    () async {
      final source = File(p.join(tempDir.path, 'generated.gif'));
      await source.writeAsBytes(const <int>[9, 8, 7]);
      final destPath = p.join(tempDir.path, 'fallback.gif');

      final saved = await saveExistingFileToDevice(
        sourcePath: source.path,
        fileName: 'generated.gif',
        useDesktopPicker: false,
        saveOnMobile: ({required sourcePath, required fileName}) {
          throw MissingPluginException(
            'No implementation found for method saveFile',
          );
        },
        pickSavePath: ({required fileName, dialogTitle}) async => destPath,
      );

      expect(saved, destPath);
      expect(await File(destPath).readAsBytes(), <int>[9, 8, 7]);
    },
  );

  test('saveBytesToDevice writes the payload on desktop', () async {
    final destPath = p.join(tempDir.path, 'note.txt');

    final saved = await saveBytesToDevice(
      data: const <int>[72, 105],
      fileName: 'note.txt',
      useDesktopPicker: true,
      pickSavePath: ({required fileName, dialogTitle}) async => destPath,
    );

    expect(saved, destPath);
    expect(await File(destPath).readAsBytes(), <int>[72, 105]);
  });
  test('mobile byte export delegates to the native save dialog', () async {
    final filename =
        'mobile-export-${DateTime.now().microsecondsSinceEpoch}.gif';
    final bytes = <int>[71, 73, 70, 56, 57, 97];
    try {
      final saved = await saveBytesToDevice(
        data: bytes,
        fileName: filename,
        useDesktopPicker: false,
        saveOnMobile: ({required sourcePath, required fileName}) async {
          expect(fileName, filename);
          expect(await File(sourcePath).readAsBytes(), bytes);
          return 'content://downloads/export.gif';
        },
      );
      expect(saved, 'content://downloads/export.gif');
      final canceled = await saveBytesToDevice(
        data: bytes,
        fileName: filename,
        useDesktopPicker: false,
        saveOnMobile: ({required sourcePath, required fileName}) async => null,
      );
      expect(canceled, isNull);
    } finally {
      await File(p.join(Directory.systemTemp.path, filename)).delete();
    }
  });
}
