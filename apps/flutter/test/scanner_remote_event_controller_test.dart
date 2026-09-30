import 'package:airqr_mobile/scanner_remote_event_controller.dart';
import 'package:airqr_mobile/scanner_sync_controller.dart';
import 'package:airqr_mobile/websocket_sync.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerRemoteEventController', () {
    test('handleProgress rejects non-string remote session IDs before adoption', () async {
      var adopted = false;
      final controller = ScannerRemoteEventController(
        adoptRemoteSession: (sessionId) async {
          adopted = true;
          return sessionId;
        },
      );

      final transition = await controller.handleProgress(
        state: const ScannerRemoteEventState(
          canScanLocally: false,
          currentScanId: null,
          completionHandled: false,
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          progress: 0,
          currentFilename: null,
          syncSourceName: null,
          scanDurationSeconds: 0,
        ),
        event: SyncEvent(
          type: 'scan-progress',
          payload: <String, dynamic>{
            'sessionId': <String, bool>{'nested': true},
          },
        ),
      );

      expect(transition, isA<ScannerRemoteProgressIgnoredTransition>());
      expect(adopted, isFalse);
    });

    test('handleProgress requests a snapshot when remote counts are absent after adopting desktop session', () async {
      var adoptedSessionId = '';
      final controller = ScannerRemoteEventController(
        adoptRemoteSession: (sessionId) async {
          adoptedSessionId = sessionId;
          return sessionId;
        },
      );

      final transition = await controller.handleProgress(
        state: const ScannerRemoteEventState(
          canScanLocally: false,
          currentScanId: null,
          completionHandled: true,
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          progress: 0.0,
          currentFilename: null,
          syncSourceName: null,
          scanDurationSeconds: 0.0,
        ),
        event: SyncEvent(
          type: 'scan-progress',
          payload: <String, dynamic>{
            'sessionId': 'scan-1',
            'receivedPackets': 0,
            'expectedPackets': 0,
          },
        ),
      );

      expect(adoptedSessionId, 'scan-1');
      expect(transition, isA<ScannerRemoteProgressSnapshotTransition>());
      final snapshot = transition as ScannerRemoteProgressSnapshotTransition;
      expect(snapshot.currentScanId, 'scan-1');
      expect(snapshot.completionHandled, isFalse);
      expect(snapshot.snapshotSessionId, 'scan-1');
    });

    test('handleProgress returns a progress update from the sync controller when payload counts exist', () async {
      final controller = ScannerRemoteEventController(
        handleRemoteProgress: ({required state, required event}) async =>
            const ScannerRemoteProgressResult(
              currentScanId: 'scan-2',
              remoteReceivedPackets: 40,
              remoteExpectedPackets: 70,
              progress: 40 / 70,
              status: 'Progress: 57.1% (40/70)',
              currentFilename: 'remote.bin',
              syncSourceName: 'iPhone',
            ),
      );

      final transition = await controller.handleProgress(
        state: const ScannerRemoteEventState(
          canScanLocally: true,
          currentScanId: 'scan-2',
          completionHandled: false,
          displayReceivedPackets: 35,
          displayExpectedPackets: 60,
          remoteReceivedPackets: 30,
          remoteExpectedPackets: 50,
          progress: 0.5,
          currentFilename: 'old.bin',
          syncSourceName: 'This Device',
          scanDurationSeconds: 0.0,
        ),
        event: SyncEvent(
          type: 'scan-progress',
          payload: <String, dynamic>{
            'sessionId': 'scan-2',
            'receivedPackets': 40,
            'expectedPackets': 70,
            'filename': 'remote.bin',
          },
        ),
      );

      expect(transition, isA<ScannerRemoteProgressUpdateTransition>());
      final update = transition as ScannerRemoteProgressUpdateTransition;
      expect(update.currentScanId, 'scan-2');
      expect(update.remoteReceivedPackets, 40);
      expect(update.remoteExpectedPackets, 70);
      expect(update.progress, 40 / 70);
      expect(update.status, 'Progress: 57.1% (40/70)');
      expect(update.currentFilename, 'remote.bin');
      expect(update.syncSourceName, 'iPhone');
    });

    test('handleCompletion maps sync result into page state reset', () async {
      final controller = ScannerRemoteEventController(
        handleRemoteCompletion: ({required state, required event}) async =>
            const ScannerRemoteCompletionResult(
              currentScanId: null,
              completionHandled: true,
              isCaptureActive: false,
              isProcessing: false,
              isScanning: false,
              progress: 1.0,
              resultIsNote: false,
              resultNoteContent: null,
              resultFilename: 'done.zip',
              resultSessionId: 'scan-3',
              resultFileSizeBytes: 2048,
              resultDurationSeconds: 8.4,
              resultSubtitle: 'Completed on iPhone',
              status: 'Completed on iPhone\ndone.zip',
              snackBarMessage: 'Scan synced: done.zip',
            ),
      );

      final result = await controller.handleCompletion(
        state: const ScannerRemoteEventState(
          canScanLocally: false,
          currentScanId: 'scan-3',
          completionHandled: false,
          displayReceivedPackets: 40,
          displayExpectedPackets: 70,
          remoteReceivedPackets: 40,
          remoteExpectedPackets: 70,
          progress: 0.57,
          currentFilename: 'remote.bin',
          syncSourceName: 'iPhone',
          scanDurationSeconds: 8.4,
        ),
        event: SyncEvent(
          type: 'scan-complete',
          payload: <String, dynamic>{'sessionId': 'scan-3'},
        ),
      );

      expect(result, isNotNull);
      expect(result!.completionHandled, isTrue);
      expect(result.currentScanId, isNull);
      expect(result.isExplicitResume, isFalse);
      expect(result.receivedPackets, 0);
      expect(result.expectedPackets, 0);
      expect(result.currentFilename, isNull);
      expect(result.remoteReceivedPackets, 0);
      expect(result.remoteExpectedPackets, 0);
      expect(result.lastRemoteProgressFetch, isNull);
      expect(result.progress, 1.0);
      expect(result.isScanning, isFalse);
      expect(result.resultFilename, 'done.zip');
      expect(result.resultIsNote, isFalse);
      expect(result.resultNoteContent, isNull);
      expect(result.resultSessionId, 'scan-3');
      expect(result.resultFileSizeBytes, 2048);
      expect(result.resultDurationSeconds, 8.4);
      expect(result.resultSubtitle, 'Completed on iPhone');
      expect(result.status, 'Completed on iPhone\ndone.zip');
      expect(result.shouldClearCorners, isTrue);
      expect(result.snackBarMessage, 'Scan synced: done.zip');
    });

    test('handleCompletion preserves remote note metadata', () async {
      final controller = ScannerRemoteEventController(
        handleRemoteCompletion: ({required state, required event}) async =>
            const ScannerRemoteCompletionResult(
              currentScanId: null,
              completionHandled: true,
              isCaptureActive: false,
              isProcessing: false,
              isScanning: false,
              progress: 1.0,
              resultIsNote: true,
              resultNoteContent: 'hello',
              resultFilename: 'note.md',
              resultSessionId: 'scan-note',
              resultFileSizeBytes: 5,
              resultDurationSeconds: 1.5,
              resultSubtitle: 'Completed on Desktop',
              status: 'Completed on Desktop\nnote.md',
              snackBarMessage: 'Scan synced: note.md',
            ),
      );

      final result = await controller.handleCompletion(
        state: const ScannerRemoteEventState(
          canScanLocally: false,
          currentScanId: 'scan-note',
          completionHandled: false,
          displayReceivedPackets: 2,
          displayExpectedPackets: 2,
          remoteReceivedPackets: 2,
          remoteExpectedPackets: 2,
          progress: 1.0,
          currentFilename: 'note.md',
          syncSourceName: 'Desktop',
          scanDurationSeconds: 1.5,
        ),
        event: SyncEvent(
          type: 'scan-complete',
          payload: <String, dynamic>{'sessionId': 'scan-note'},
        ),
      );

      expect(result, isNotNull);
      expect(result!.resultIsNote, isTrue);
      expect(result.resultNoteContent, 'hello');
      expect(result.resultFilename, 'note.md');
      expect(result.snackBarMessage, 'Scan synced: note.md');
    });
  });
}
