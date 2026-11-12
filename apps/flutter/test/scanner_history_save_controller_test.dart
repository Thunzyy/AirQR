import 'package:airqr_mobile/scanner_history_save_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerHistorySaveController', () {
    test('save persists the scanned file and records it in history', () async {
      final calls = <String>[];
      final controller = ScannerHistorySaveController(
        writeScannedFile: ({required data, required fileName}) async {
          calls.add('write:$fileName:${data.length}');
          return '/docs/$fileName';
        },
        recordScannedHistory: ({
          required path,
          required timestamp,
          required serverSessionId,
          required mimeType,
        }) async {
          calls.add('history:$path:$timestamp:$serverSessionId:$mimeType');
        },
      );

      final result = await controller.save(
        data: const <int>[1, 2, 3, 4],
        filename: 'capture.bin',
        sessionId: 'scan-1',
      );

      expect(result.fileName, 'capture.bin');
      expect(result.filePath, '/docs/capture.bin');
      expect(result.timestamp, greaterThan(0));
      expect(calls.first, 'write:capture.bin:4');
      expect(
        calls.last,
        'history:/docs/capture.bin:${result.timestamp}:scan-1:null',
      );
    });

    test('save generates a fallback filename when the decoder does not provide one', () async {
      final controller = ScannerHistorySaveController(
        writeScannedFile: ({required data, required fileName}) async =>
            '/docs/$fileName',
        recordScannedHistory: ({
          required path,
          required timestamp,
          required serverSessionId,
          required mimeType,
        }) async {},
      );

      final result = await controller.save(
        data: const <int>[9],
        filename: null,
        sessionId: null,
      );

      expect(result.fileName, startsWith('received_'));
      expect(result.fileName, endsWith('.bin'));
      expect(result.filePath, '/docs/${result.fileName}');
    });

    test('save persists note files with friendly metadata', () async {
      final calls = <String>[];
      final controller = ScannerHistorySaveController(
        writeScannedFile: ({required data, required fileName}) async {
          calls.add('write:$fileName:${data.length}');
          return '/docs/note.md';
        },
        recordScannedHistory: ({
          required path,
          required timestamp,
          required serverSessionId,
          required mimeType,
        }) async {
          calls.add('history:$path:$timestamp:$serverSessionId:$mimeType');
        },
      );

      final result = await controller.save(
        data: const <int>[65, 66, 67],
        filename: '__airqr_note__.md',
        sessionId: 'scan-note',
      );

      expect(result.fileName, 'note.md');
      expect(result.filePath, '/docs/note.md');
      expect(calls.first, 'write:__airqr_note__.md:3');
      expect(
        calls.last,
        'history:/docs/note.md:${result.timestamp}:scan-note:text/plain',
      );
    });

    test('save rethrows file persistence failures and skips history', () async {
      var historyCalled = false;
      final controller = ScannerHistorySaveController(
        writeScannedFile: ({required data, required fileName}) async {
          throw Exception('disk full');
        },
        recordScannedHistory: ({
          required path,
          required timestamp,
          required serverSessionId,
          required mimeType,
        }) async {
          historyCalled = true;
        },
      );

      await expectLater(
        controller.save(
          data: const <int>[1],
          filename: 'capture.bin',
          sessionId: 'scan-2',
        ),
        throwsException,
      );
      expect(historyCalled, isFalse);
    });
  });
}
