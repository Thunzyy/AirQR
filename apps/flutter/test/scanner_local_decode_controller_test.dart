import 'dart:typed_data';

import 'package:airqr_mobile/scanner_local_decode_controller.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerLocalDecodeController', () {
    test('applyResult persists progress and returns display state', () async {
      var savedPacketIndex = -1;
      Uint8List? savedPacketBytes;
      var uploadedSessionId = '';
      var uploadedFilename = '';
      var realtimeSessionId = '';
      var updatedProgress = 0.0;
      var updatedReceived = 0;
      var updatedExpected = 0;

      final controller = ScannerLocalDecodeController(
        savePacket: (packetIndex, packetData) async {
          savedPacketIndex = packetIndex;
          savedPacketBytes = packetData;
        },
        uploadPacketToServer:
            ({
              required sessionId,
              required packetData,
              filename,
              resultType,
              receivedPackets,
              expectedPackets,
            }) async {
              uploadedSessionId = sessionId;
              uploadedFilename = filename ?? '';
              return true;
            },
        notifyRealtimePacket:
            ({
              required sessionId,
              required packetBytes,
              filename,
              required receivedPackets,
              required expectedPackets,
            }) {
              realtimeSessionId = sessionId;
            },
        updateIncompleteProgress:
            ({
              required progress,
              required receivedPackets,
              required expectedPackets,
              filename,
            }) async {
              updatedProgress = progress;
              updatedReceived = receivedPackets;
              updatedExpected = expectedPackets;
            },
      );

      final packetBytes = Uint8List.fromList(const <int>[1, 2, 3, 4]);
      final transition = await controller.applyResult(
        result: DecodeStatus(
          status: 'Progress',
          percent: 42.5,
          receivedPackets: 17,
          expectedPackets: 40,
          durationMs: BigInt.zero,
          totalPackets: 40,
          filename: 'capture.bin',
        ),
        rawBytes: packetBytes,
        state: const ScannerLocalDecodeState(
          currentScanId: 'scan-1',
          completionHandled: false,
          displayReceivedPackets: 12,
          displayExpectedPackets: 35,
          progress: 0.2,
          scanDurationSeconds: 1.0,
          syncSourceName: 'Old Device',
        ),
        localSyncSourceName: 'This Device',
      );

      expect(transition, isA<ScannerLocalProgressTransition>());
      final progress = transition as ScannerLocalProgressTransition;
      expect(progress.receivedPackets, 17);
      expect(progress.expectedPackets, 40);
      expect(progress.progress, 17 / 40);
      expect(progress.currentFilename, 'capture.bin');
      expect(progress.syncSourceName, 'This Device');
      expect(progress.status, 'Progress: 42.5% (17/40)');
      expect(progress.shouldRefreshGlobalCounters, isTrue);

      expect(savedPacketIndex, 17);
      expect(savedPacketBytes, same(packetBytes));
      expect(uploadedSessionId, 'scan-1');
      expect(uploadedFilename, 'capture.bin');
      expect(realtimeSessionId, 'scan-1');
      expect(updatedProgress, 0.425);
      expect(updatedReceived, 17);
      expect(updatedExpected, 40);
    });

    test(
      'server-authoritative decode errors still upload valid streaming packets',
      () async {
        var uploadedSessionId = '';
        String? uploadedResultType;
        Uint8List? uploadedPacket;

        final controller = ScannerLocalDecodeController(
          uploadPacketToServer:
              ({
                required sessionId,
                required packetData,
                filename,
                resultType,
                receivedPackets,
                expectedPackets,
              }) async {
                uploadedSessionId = sessionId;
                uploadedResultType = resultType;
                uploadedPacket = packetData;
                return true;
              },
        );

        final packetBytes = Uint8List(31);
        final view = ByteData.sublistView(packetBytes);
        view.setUint8(0, 1);
        view.setUint32(1, 4242);
        view.setUint32(5, 12);
        view.setUint32(9, 13);
        view.setUint32(27, 99);

        final transition = await controller.applyResult(
          result: DecodeStatus(
            status: 'Error',
            percent: 0,
            receivedPackets: 0,
            expectedPackets: 0,
            durationMs: BigInt.zero,
            totalPackets: 0,
            errorMsg: 'duplicate packet',
          ),
          rawBytes: packetBytes,
          state: const ScannerLocalDecodeState(
            currentScanId: '4242',
            completionHandled: false,
            displayReceivedPackets: 1200,
            displayExpectedPackets: 1416,
            progress: 0.84,
            scanDurationSeconds: 0,
            syncSourceName: 'iPhone',
            serverAuthoritative: true,
          ),
          localSyncSourceName: 'iPhone',
        );

        await Future<void>.delayed(Duration.zero);

        expect(transition, isA<ScannerLocalErrorTransition>());
        expect(uploadedSessionId, '4242');
        expect(uploadedResultType, 'server_authoritative_decode_error');
        expect(uploadedPacket, same(packetBytes));
      },
    );

    test(
      'progress transitions cap incomplete threshold at 99.9 percent',
      () async {
        final controller = ScannerLocalDecodeController(
          savePacket: (_, _) async {},
          uploadPacketToServer:
              ({
                required sessionId,
                required packetData,
                filename,
                resultType,
                receivedPackets,
                expectedPackets,
              }) async => true,
          notifyRealtimePacket:
              ({
                required sessionId,
                required packetBytes,
                filename,
                required receivedPackets,
                required expectedPackets,
              }) {},
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                filename,
              }) async {},
        );

        final transition = await controller.applyResult(
          result: DecodeStatus(
            status: 'Progress',
            percent: 100,
            receivedPackets: 200,
            expectedPackets: 200,
            durationMs: BigInt.zero,
            totalPackets: 300,
          ),
          rawBytes: Uint8List.fromList(const <int>[1, 2, 3]),
          state: const ScannerLocalDecodeState(
            currentScanId: 'scan-99',
            completionHandled: false,
            displayReceivedPackets: 200,
            displayExpectedPackets: 200,
            progress: 0.99,
            scanDurationSeconds: 3,
            syncSourceName: 'iPhone',
          ),
          localSyncSourceName: 'iPhone',
        );

        expect(transition, isA<ScannerLocalProgressTransition>());
        final progress = transition as ScannerLocalProgressTransition;
        expect(progress.progress, 0.999);
        expect(progress.status, 'Progress: 99.9% (200/200)');
      },
    );

    test(
      'applyResult returns completion transition and completes current scan',
      () async {
        var completed = false;
        final controller = ScannerLocalDecodeController(
          completeCurrentScan: () async {
            completed = true;
          },
          nowMillis: () => 1234567890,
        );

        final transition = await controller.applyResult(
          result: DecodeStatus(
            status: 'Completed',
            percent: 100,
            receivedPackets: 100,
            expectedPackets: 100,
            durationMs: BigInt.zero,
            totalPackets: 100,
            filename: 'done.zip',
            fileData: Uint8List.fromList(List<int>.filled(2048, 1)),
          ),
          rawBytes: Uint8List(0),
          state: const ScannerLocalDecodeState(
            currentScanId: 'scan-2',
            completionHandled: false,
            displayReceivedPackets: 100,
            displayExpectedPackets: 100,
            progress: 1.0,
            scanDurationSeconds: 8.4,
            syncSourceName: 'This Device',
          ),
          localSyncSourceName: 'This Device',
        );

        expect(transition, isA<ScannerLocalCompletedTransition>());
        final completion = transition as ScannerLocalCompletedTransition;
        expect(completed, isTrue);
        expect(completion.completionHandled, isTrue);
        expect(completion.resultSessionId, 'scan-2');
        expect(completion.resultFilename, 'done.zip');
        expect(completion.resultIsNote, isFalse);
        expect(completion.resultNoteContent, isNull);
        expect(completion.resultFileSizeBytes, 2048);
        expect(completion.resultDurationSeconds, 8.4);
        expect(completion.progress, 1.0);
        expect(completion.status, contains('Completed! done.zip'));
        expect(completion.status, contains('Time: 8.4 | Size: 2.0 KB'));
        expect(completion.status, contains('Frames: 100'));
      },
    );

    test(
      'applyResult maps note completions to a friendly filename and note text',
      () async {
        final controller = ScannerLocalDecodeController(
          completeCurrentScan: () async {},
        );

        final transition = await controller.applyResult(
          result: DecodeStatus(
            status: 'Completed',
            percent: 100,
            receivedPackets: 10,
            expectedPackets: 10,
            durationMs: BigInt.zero,
            totalPackets: 10,
            filename: '__airqr_note__.md',
            fileData: Uint8List.fromList('hello from note'.codeUnits),
          ),
          rawBytes: Uint8List(0),
          state: const ScannerLocalDecodeState(
            currentScanId: 'scan-note',
            completionHandled: false,
            displayReceivedPackets: 10,
            displayExpectedPackets: 10,
            progress: 1.0,
            scanDurationSeconds: 2.0,
            syncSourceName: 'This Device',
          ),
          localSyncSourceName: 'This Device',
        );

        expect(transition, isA<ScannerLocalCompletedTransition>());
        final completion = transition as ScannerLocalCompletedTransition;
        expect(completion.resultFilename, 'note.md');
        expect(completion.resultIsNote, isTrue);
        expect(completion.resultNoteContent, 'hello from note');
        expect(completion.status, contains('Completed! note.md'));
      },
    );

    test('applyResult returns error transition for decode errors', () async {
      final controller = ScannerLocalDecodeController();

      final transition = await controller.applyResult(
        result: DecodeStatus(
          status: 'Error',
          percent: 0,
          receivedPackets: 0,
          expectedPackets: 0,
          durationMs: BigInt.zero,
          totalPackets: 0,
          errorMsg: 'bad packet',
        ),
        rawBytes: Uint8List(0),
        state: const ScannerLocalDecodeState(
          currentScanId: 'scan-3',
          completionHandled: false,
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          progress: 0,
          scanDurationSeconds: 0,
          syncSourceName: 'This Device',
        ),
        localSyncSourceName: 'This Device',
      );

      expect(transition, isA<ScannerLocalErrorTransition>());
      expect(
        (transition as ScannerLocalErrorTransition).status,
        'Error: bad packet',
      );
    });

    test('applyResult ignores duplicate completion results', () async {
      var completed = false;
      final controller = ScannerLocalDecodeController(
        completeCurrentScan: () async {
          completed = true;
        },
      );

      final transition = await controller.applyResult(
        result: DecodeStatus(
          status: 'Completed',
          percent: 100,
          receivedPackets: 10,
          expectedPackets: 10,
          durationMs: BigInt.zero,
          totalPackets: 10,
          fileData: Uint8List.fromList(const <int>[1]),
        ),
        rawBytes: Uint8List(0),
        state: const ScannerLocalDecodeState(
          currentScanId: 'scan-4',
          completionHandled: true,
          displayReceivedPackets: 10,
          displayExpectedPackets: 10,
          progress: 1,
          scanDurationSeconds: 1,
          syncSourceName: 'This Device',
        ),
        localSyncSourceName: 'This Device',
      );

      expect(transition, isA<ScannerLocalIgnoredTransition>());
      expect(completed, isFalse);
    });
  });
}
