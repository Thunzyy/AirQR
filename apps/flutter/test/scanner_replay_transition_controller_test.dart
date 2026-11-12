import 'dart:typed_data';

import 'package:airqr_mobile/scanner_replay_transition_controller.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerReplayTransitionController', () {
    test('applyResult returns a progress transition for replayed packets', () async {
      final controller = ScannerReplayTransitionController();

      final transition = await controller.applyResult(
        result: DecodeStatus(
          status: 'Progress',
          percent: 42.5,
          receivedPackets: 17,
          expectedPackets: 40,
          durationMs: BigInt.zero,
          totalPackets: 40,
        ),
        currentScanId: 'scan-1',
        completionHandled: false,
        scanDurationSeconds: 0,
      );

      expect(transition, isA<ScannerReplayProgressTransition>());
      final progress = transition as ScannerReplayProgressTransition;
      expect(progress.receivedPackets, 17);
      expect(progress.expectedPackets, 40);
      expect(progress.progress, 0.425);
      expect(progress.status, 'Resuming: 42.5% (17/40)');
    });

    test('applyResult returns a completion transition and completes the scan once', () async {
      var completed = false;
      final controller = ScannerReplayTransitionController(
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
        currentScanId: 'scan-2',
        completionHandled: false,
        scanDurationSeconds: 8.4,
      );

      expect(transition, isA<ScannerReplayCompletedTransition>());
      final completion = transition as ScannerReplayCompletedTransition;
      expect(completed, isTrue);
      expect(completion.completedSessionId, 'scan-2');
      expect(completion.resultFilename, 'done.zip');
      expect(completion.resultIsNote, isFalse);
      expect(completion.resultNoteContent, isNull);
      expect(completion.resultFileSizeBytes, 2048);
      expect(completion.resultDurationSeconds, 8.4);
      expect(completion.progress, 1.0);
      expect(completion.status, contains('Completed! done.zip'));
      expect(completion.status, contains('Time: 8.4s'));
      expect(completion.status, contains('Frames: 100'));
    });

    test('applyResult maps note replay completions to note metadata', () async {
      final controller = ScannerReplayTransitionController(
        completeCurrentScan: () async {},
      );

      final transition = await controller.applyResult(
        result: DecodeStatus(
          status: 'Completed',
          percent: 100,
          receivedPackets: 2,
          expectedPackets: 2,
          durationMs: BigInt.zero,
          totalPackets: 2,
          filename: '__airqr_note__.md',
          fileData: Uint8List.fromList('hello'.codeUnits),
        ),
        currentScanId: 'scan-note',
        completionHandled: false,
        scanDurationSeconds: 1.2,
      );

      expect(transition, isA<ScannerReplayCompletedTransition>());
      final completion = transition as ScannerReplayCompletedTransition;
      expect(completion.resultFilename, 'note.md');
      expect(completion.resultIsNote, isTrue);
      expect(completion.resultNoteContent, 'hello');
      expect(completion.status, contains('Completed! note.md'));
    });

    test('applyResult ignores duplicate completion replays', () async {
      var completed = false;
      final controller = ScannerReplayTransitionController(
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
        currentScanId: 'scan-3',
        completionHandled: true,
        scanDurationSeconds: 1.2,
      );

      expect(transition, isA<ScannerReplayIgnoredTransition>());
      expect(completed, isFalse);
    });
  });
}
