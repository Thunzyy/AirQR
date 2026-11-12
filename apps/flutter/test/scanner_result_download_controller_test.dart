import 'dart:typed_data';

import 'package:airqr_mobile/scanner_result_download_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerResultDownloadController', () {
    test(
      'save reuses an existing cached file without downloading again',
      () async {
        var downloadCalled = false;
        var persistedCalled = false;
        final controller = ScannerResultDownloadController(
          fileExists: (path) async => true,
          downloadScannedFile: (sessionId) async {
            downloadCalled = true;
            return Uint8List(0);
          },
          persistTempFile: ({required data, required fileName}) async {
            persistedCalled = true;
            return '/docs/$fileName';
          },
          saveFile: ({required sourcePath, required fileName}) async {
            expect(sourcePath, '/docs/archive.zip');
            expect(fileName, 'archive.zip');
            return '/exports/archive.zip';
          },
        );

        final result = await controller.save(
          cachedPath: '/docs/archive.zip',
          sessionId: 'session-1',
          fileName: 'ignored.zip',
        );

        expect(result.sourcePath, '/docs/archive.zip');
        expect(result.savedPath, '/exports/archive.zip');
        expect(result.downloadedFromServer, isFalse);
        expect(downloadCalled, isFalse);
        expect(persistedCalled, isFalse);
      },
    );

    test(
      'save downloads and persists a temp file when cache is missing',
      () async {
        final writes = <String>[];
        final controller = ScannerResultDownloadController(
          fileExists: (path) async => false,
          downloadScannedFile: (sessionId) async {
            expect(sessionId, 'session-2');
            return Uint8List.fromList(const <int>[1, 2, 3]);
          },
          persistTempFile: ({required data, required fileName}) async {
            expect(data, orderedEquals(const <int>[1, 2, 3]));
            expect(fileName, 'received.zip');
            writes.add(fileName);
            return '/docs/$fileName';
          },
          saveFile: ({required sourcePath, required fileName}) async {
            expect(sourcePath, '/docs/received.zip');
            expect(fileName, 'received.zip');
            return '/exports/received.zip';
          },
        );

        final result = await controller.save(
          cachedPath: null,
          sessionId: 'session-2',
          fileName: 'received.zip',
        );

        expect(result.sourcePath, '/docs/received.zip');
        expect(result.savedPath, '/exports/received.zip');
        expect(result.downloadedFromServer, isTrue);
        expect(writes, orderedEquals(const <String>['received.zip']));
      },
    );

    test(
      'save strips traversal from an untrusted downloaded filename',
      () async {
        final controller = ScannerResultDownloadController(
          fileExists: (path) async => false,
          downloadScannedFile: (sessionId) async =>
              Uint8List.fromList(const <int>[1]),
          persistTempFile: ({required data, required fileName}) async {
            expect(fileName, 'payload.zip');
            return '/docs/$fileName';
          },
          saveFile: ({required sourcePath, required fileName}) async =>
              sourcePath,
        );

        await controller.save(
          cachedPath: null,
          sessionId: 'session-unsafe',
          fileName: '../payload.zip',
        );
      },
    );

    test(
      'save throws when no cached file and no resumable session exist',
      () async {
        final controller = ScannerResultDownloadController(
          fileExists: (path) async => false,
        );

        await expectLater(
          controller.save(
            cachedPath: null,
            sessionId: null,
            fileName: 'missing.bin',
          ),
          throwsA(isA<StateError>()),
        );
      },
    );

    for (final invalidId in const <String>[
      '../x',
      'a/b',
      'a?b',
      'a#b',
      ' x ',
    ]) {
      test(
        'save rejects invalid server id $invalidId before download',
        () async {
          var downloadCalled = false;
          final controller = ScannerResultDownloadController(
            fileExists: (path) async => false,
            downloadScannedFile: (sessionId) async {
              downloadCalled = true;
              return Uint8List.fromList(const <int>[1]);
            },
          );

          await expectLater(
            controller.save(
              cachedPath: null,
              sessionId: invalidId,
              fileName: 'payload.bin',
            ),
            throwsA(isA<FormatException>()),
          );
          expect(downloadCalled, isFalse);
        },
      );
    }
  });
}
