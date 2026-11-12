import 'dart:typed_data';

import 'package:airqr_mobile/scanner_replay_transition_controller.dart';
import 'package:airqr_mobile/scanner_resume_controller.dart';
import 'package:airqr_mobile/scanner_resume_flow_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerResumeFlowController', () {
    test('beginResume freezes capture and clears live processing state', () {
      final controller = ScannerResumeFlowController();

      final transition = controller.beginResume();

      expect(transition.completionHandled, isFalse);
      expect(transition.shouldClearLastProcessedBytes, isTrue);
      expect(transition.completedDuringResume, isFalse);
      expect(transition.isCaptureActive, isFalse);
      expect(transition.isProcessing, isFalse);
    });

    test('applyLoadedResume maps resume metadata back into scanner page state', () {
      final controller = ScannerResumeFlowController();

      final transition = controller.applyLoadedResume(
        resumeState: const ScannerResumeLoadResult(
          currentScanId: 'scan-1',
          receivedPackets: 40,
          expectedPackets: 100,
          currentFilename: 'resume.bin',
          progress: 0.4,
          packets: [],
          isExplicitResume: true,
          lockSessionIdToCurrent: true,
          remoteReceivedPackets: 12,
          remoteExpectedPackets: 30,
          status: 'Resuming scan... (2 packets)',
        ),
        localSyncSourceName: 'This Device',
      );

      expect(transition.currentScanId, 'scan-1');
      expect(transition.receivedPackets, 40);
      expect(transition.expectedPackets, 100);
      expect(transition.currentFilename, 'resume.bin');
      expect(transition.remoteReceivedPackets, 12);
      expect(transition.remoteExpectedPackets, 30);
      expect(transition.isExplicitResume, isTrue);
      expect(transition.lockSessionIdToCurrent, isTrue);
      expect(transition.scanStartedAtMs, isNull);
      expect(transition.status, 'Resuming scan... (2 packets)');
      expect(transition.progress, 0.4);
      expect(transition.isScanning, isTrue);
      expect(transition.syncSourceName, 'This Device');
    });

    test('applyReplayProgress maps replay progress into simple scanner state updates', () {
      final controller = ScannerResumeFlowController();

      final transition = controller.applyReplayProgress(
        const ScannerReplayProgressTransition(
          receivedPackets: 17,
          expectedPackets: 40,
          progress: 0.425,
          status: 'Resuming: 42.5% (17/40)',
        ),
      );

      expect(transition.receivedPackets, 17);
      expect(transition.expectedPackets, 40);
      expect(transition.progress, 0.425);
      expect(transition.status, 'Resuming: 42.5% (17/40)');
    });

    test('applyReplayCompletion resets active scan state and exposes result metadata', () {
      final controller = ScannerResumeFlowController();

      final transition = controller.applyReplayCompletion(
        ScannerReplayCompletedTransition(
          completedSessionId: 'scan-2',
          fileData: Uint8List.fromList(const <int>[1, 2, 3]),
          resultIsNote: false,
          resultNoteContent: null,
          resultFilename: 'done.zip',
          resultFileSizeBytes: 2048,
          resultDurationSeconds: 8.4,
          progress: 1.0,
          status: 'Completed! done.zip',
          totalPackets: 100,
        ),
      );

      expect(transition.completionHandled, isTrue);
      expect(transition.completedDuringResume, isTrue);
      expect(transition.currentScanId, isNull);
      expect(transition.receivedPackets, 0);
      expect(transition.expectedPackets, 0);
      expect(transition.currentFilename, isNull);
      expect(transition.remoteReceivedPackets, 0);
      expect(transition.remoteExpectedPackets, 0);
      expect(transition.progress, 1.0);
      expect(transition.status, 'Completed! done.zip');
      expect(transition.resultIsNote, isFalse);
      expect(transition.resultNoteContent, isNull);
      expect(transition.resultFilename, 'done.zip');
      expect(transition.resultSessionId, 'scan-2');
      expect(transition.resultFileSizeBytes, 2048);
      expect(transition.resultDurationSeconds, 8.4);
      expect(transition.resultSavedPath, isNull);
      expect(transition.resultSubtitle, isNull);
      expect(transition.isScanning, isFalse);
      expect(transition.shouldClearCorners, isTrue);
      expect(transition.fileData, isNotEmpty);
    });

    test('finishResume reenables capture and restores scanning status', () {
      final controller = ScannerResumeFlowController();

      final transition = controller.finishResume(
        localSyncSourceName: 'This Device',
      );

      expect(transition.status, 'Scanning...');
      expect(transition.isCaptureActive, isTrue);
      expect(transition.syncSourceName, 'This Device');
    });

    test('applyResumeError exposes the final error status', () {
      final controller = ScannerResumeFlowController();

      final transition = controller.applyResumeError('boom');

      expect(transition.status, 'Resume error: boom');
    });
  });
}
