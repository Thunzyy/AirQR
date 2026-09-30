import 'dart:typed_data';

import 'package:airqr_mobile/scanner_local_decode_controller.dart';
import 'package:airqr_mobile/scanner_local_result_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerLocalResultController', () {
    test('applyProgress updates counters and decides when a widget rebuild is needed', () {
      final controller = ScannerLocalResultController();

      final update = controller.applyProgress(
        transition: const ScannerLocalProgressTransition(
          receivedPackets: 17,
          expectedPackets: 40,
          progress: 17 / 40,
          status: 'Progress: 42.5% (17/40)',
          currentFilename: 'capture.bin',
          syncSourceName: 'This Device',
          shouldRefreshGlobalCounters: true,
        ),
        state: const ScannerLocalResultState(
          completionHandled: false,
          currentScanId: 'scan-1',
          currentFilename: null,
          remoteReceivedPackets: 5,
          remoteExpectedPackets: 9,
          lastUpdateTime: 1000,
          framesInCurrentSecond: 2,
        ),
        nowMillis: 1205,
      );

      expect(update.receivedPackets, 17);
      expect(update.expectedPackets, 40);
      expect(update.currentFilename, 'capture.bin');
      expect(update.progress, 17 / 40);
      expect(update.status, 'Progress: 42.5% (17/40)');
      expect(update.syncSourceName, 'This Device');
      expect(update.lastUpdateTime, 1205);
      expect(update.shouldRefreshGlobalCounters, isTrue);
      expect(update.shouldApplyWidgetUpdate, isTrue);
    });

    test('applyProgress avoids rebuild when updates are too frequent', () {
      final controller = ScannerLocalResultController();

      final update = controller.applyProgress(
        transition: const ScannerLocalProgressTransition(
          receivedPackets: 18,
          expectedPackets: 40,
          progress: 0.45,
          status: 'Progress: 45.0% (18/40)',
          currentFilename: null,
          syncSourceName: 'Phone',
          shouldRefreshGlobalCounters: false,
        ),
        state: const ScannerLocalResultState(
          completionHandled: false,
          currentScanId: 'scan-1',
          currentFilename: 'existing.bin',
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          lastUpdateTime: 1000,
          framesInCurrentSecond: 3,
        ),
        nowMillis: 1050,
      );

      expect(update.currentFilename, 'existing.bin');
      expect(update.lastUpdateTime, 1000);
      expect(update.shouldApplyWidgetUpdate, isFalse);
    });

    test('applyCompletion resets active scan state and exposes final result', () {
      final controller = ScannerLocalResultController();

      final update = controller.applyCompletion(
        transition: ScannerLocalCompletedTransition(
          completionHandled: true,
          progress: 1.0,
          status: 'Completed! done.zip',
          resultIsNote: false,
          resultNoteContent: null,
          resultFilename: 'done.zip',
          resultSessionId: 'scan-2',
          resultFileSizeBytes: 2048,
          resultDurationSeconds: 8.4,
          fileData: Uint8List.fromList(const <int>[1, 2, 3]),
        ),
      );

      expect(update.completionHandled, isTrue);
      expect(update.currentScanId, isNull);
      expect(update.receivedPackets, 0);
      expect(update.expectedPackets, 0);
      expect(update.currentFilename, isNull);
      expect(update.remoteReceivedPackets, 0);
      expect(update.remoteExpectedPackets, 0);
      expect(update.progress, 1.0);
      expect(update.status, 'Completed! done.zip');
      expect(update.resultIsNote, isFalse);
      expect(update.resultNoteContent, isNull);
      expect(update.resultFilename, 'done.zip');
      expect(update.resultSessionId, 'scan-2');
      expect(update.resultFileSizeBytes, 2048);
      expect(update.resultDurationSeconds, 8.4);
      expect(update.resultSavedPath, isNull);
      expect(update.resultSubtitle, isNull);
      expect(update.isScanning, isFalse);
      expect(update.shouldClearCorners, isTrue);
      expect(update.fileData, isNotEmpty);
    });

    test('applyError exposes the error status only', () {
      final controller = ScannerLocalResultController();

      final update = controller.applyError(
        const ScannerLocalErrorTransition(status: 'Error: bad packet'),
      );

      expect(update.status, 'Error: bad packet');
    });
  });
}
