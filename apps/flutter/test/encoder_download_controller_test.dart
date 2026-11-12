import 'dart:typed_data';

import 'package:airqr_mobile/encoder_download_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('EncoderDownloadController', () {
    test('download saves file and records generated download', () async {
      final calls = <String>[];
      final controller = EncoderDownloadController(
        saveBinaryFile: ({required data, required fileName}) async {
          calls.add('save:$fileName:${data.length}');
          return '/tmp/$fileName';
        },
        recordGeneratedDownload:
            ({
              required path,
              required mimeType,
              required totalFrames,
              required minFrames,
              chunkMinFrames,
              required timestamp,
            }) async {
              calls.add(
                'history:$path:$mimeType:$totalFrames:$minFrames:$timestamp',
              );
            },
      );

      final result = await controller.download(
        data: Uint8List.fromList(const <int>[1, 2, 3]),
        fileName: 'demo.gif',
        mimeType: 'image/gif',
        totalFrames: 42,
        minFrames: 30,
        timestamp: 123456,
      );

      expect(result!.savedPath, '/tmp/demo.gif');
      expect(result.historyRecorded, isTrue);
      expect(
        calls,
        orderedEquals(<String>[
          'save:demo.gif:3',
          'history:/tmp/demo.gif:image/gif:42:30:123456',
        ]),
      );
    });

    test('download keeps saved file when history recording fails', () async {
      final controller = EncoderDownloadController(
        saveBinaryFile: ({required data, required fileName}) async =>
            '/tmp/$fileName',
        recordGeneratedDownload:
            ({
              required path,
              required mimeType,
              required totalFrames,
              required minFrames,
              chunkMinFrames,
              required timestamp,
            }) async {
              throw Exception('history failed');
            },
      );

      final result = await controller.download(
        data: Uint8List.fromList(const <int>[1]),
        fileName: 'demo.zip',
        mimeType: 'application/zip',
        totalFrames: 12,
        minFrames: 8,
        timestamp: 999,
      );

      expect(result!.savedPath, '/tmp/demo.zip');
      expect(result.historyRecorded, isFalse);
    });

    test('download rethrows file save failures and skips history', () async {
      var historyCalled = false;
      final controller = EncoderDownloadController(
        saveBinaryFile: ({required data, required fileName}) async {
          throw Exception('save failed');
        },
        recordGeneratedDownload:
            ({
              required path,
              required mimeType,
              required totalFrames,
              required minFrames,
              chunkMinFrames,
              required timestamp,
            }) async {
              historyCalled = true;
            },
      );

      await expectLater(
        controller.download(
          data: Uint8List.fromList(const <int>[1]),
          fileName: 'demo.gif',
          mimeType: 'image/gif',
          totalFrames: 1,
          minFrames: 1,
          timestamp: 1,
        ),
        throwsException,
      );
      expect(historyCalled, isFalse);
    });

    test('download can skip history recording when requested', () async {
      var historyCalled = false;
      final controller = EncoderDownloadController(
        saveBinaryFile: ({required data, required fileName}) async =>
            '/tmp/$fileName',
        recordGeneratedDownload:
            ({
              required path,
              required mimeType,
              required totalFrames,
              required minFrames,
              chunkMinFrames,
              required timestamp,
            }) async {
              historyCalled = true;
            },
      );

      final result = await controller.download(
        data: Uint8List.fromList(const <int>[1, 2]),
        fileName: 'note.gif',
        mimeType: 'image/gif',
        totalFrames: 5,
        minFrames: 4,
        timestamp: 77,
        recordHistory: false,
      );

      expect(result!.savedPath, '/tmp/note.gif');
      expect(result.historyRecorded, isFalse);
      expect(historyCalled, isFalse);
    });
  });
}
