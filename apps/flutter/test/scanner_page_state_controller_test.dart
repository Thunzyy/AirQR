import 'package:airqr_mobile/scanner_page_state_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerPageStateController', () {
    test('applyReset restores scanner page defaults', () {
      final controller = ScannerPageStateController();

      final update = controller.applyReset(
        localSyncSourceName: 'This Device',
      );

      expect(update.currentScanId, isNull);
      expect(update.receivedPackets, 0);
      expect(update.expectedPackets, 0);
      expect(update.currentFilename, isNull);
      expect(update.remoteReceivedPackets, 0);
      expect(update.remoteExpectedPackets, 0);
      expect(update.lockSessionIdToCurrent, isFalse);
      expect(update.scanStartedAtMs, isNull);
      expect(update.resultFilename, isNull);
      expect(update.resultSessionId, isNull);
      expect(update.resultSavedPath, isNull);
      expect(update.resultSubtitle, isNull);
      expect(update.resultFileSizeBytes, isNull);
      expect(update.resultDurationSeconds, 0.0);
      expect(update.isSavingResultToDevice, isFalse);
      expect(update.lastRemoteProgressFetch, isNull);
      expect(update.completionHandled, isFalse);
      expect(update.status, 'Scanning...');
      expect(update.progress, 0.0);
      expect(update.isScanning, isTrue);
      expect(update.isCaptureActive, isTrue);
      expect(update.isProcessing, isFalse);
      expect(update.overlayColor, Colors.transparent);
      expect(update.corners, isEmpty);
      expect(update.fps, 0);
      expect(update.framesInCurrentSecond, 0);
      expect(update.lastFpsUpdate, 0);
      expect(update.syncSourceName, 'This Device');
    });

    test('beginSavingResult skips when already saving or disposed', () {
      final controller = ScannerPageStateController();

      expect(
        controller.beginSavingResult(
          isSavingResultToDevice: true,
          isDisposed: false,
        ),
        isA<ScannerSaveResultSkippedTransition>(),
      );
      expect(
        controller.beginSavingResult(
          isSavingResultToDevice: false,
          isDisposed: true,
        ),
        isA<ScannerSaveResultSkippedTransition>(),
      );
    });

    test('beginSavingResult starts and finish helpers clear saving state', () {
      final controller = ScannerPageStateController();

      final started = controller.beginSavingResult(
        isSavingResultToDevice: false,
        isDisposed: false,
      );
      expect(started, isA<ScannerSaveResultStartedTransition>());
      expect(
        (started as ScannerSaveResultStartedTransition).isSavingResultToDevice,
        isTrue,
      );

      final success = controller.applySaveResultSuccess(
        sourcePath: '/docs/result.zip',
      );
      expect(success.isSavingResultToDevice, isFalse);
      expect(success.resultSavedPath, '/docs/result.zip');

      final finished = controller.finishSavingResult(
        currentSavedPath: '/docs/result.zip',
      );
      expect(finished.isSavingResultToDevice, isFalse);
      expect(finished.resultSavedPath, '/docs/result.zip');
    });
  });
}
