import 'package:airqr_mobile/scanner_sync_controller.dart';
import 'package:airqr_mobile/scanner_session_progress.dart';
import 'package:airqr_mobile/websocket_sync.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerSyncController', () {
    test('remote handlers reject non-string and unsafe session IDs', () async {
      var adopted = false;
      final controller = ScannerSyncController(
        adoptRemoteSession: (sessionId) async {
          adopted = true;
          return sessionId;
        },
      );
      const progressState = ScannerRemoteProgressState(
        canScanLocally: false,
        currentScanId: null,
        displayReceivedPackets: 0,
        displayExpectedPackets: 0,
        remoteReceivedPackets: 0,
        remoteExpectedPackets: 0,
        progress: 0,
        currentFilename: null,
        syncSourceName: null,
      );

      for (final invalid in <Object>[
        true,
        <String, bool>{'nested': true},
        '../outside',
        ' scan-1 ',
      ]) {
        final result = await controller.handleRemoteProgress(
          state: progressState,
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': invalid,
              'receivedPackets': 1,
              'expectedPackets': 2,
            },
          ),
        );
        expect(result, isNull);
      }
      expect(adopted, isFalse);
    });

    test(
      'handleRemoteProgress adopts the first remote session on desktop and updates progress',
      () async {
        var adoptedSessionId = '';
        double? persistedProgress;
        int? persistedReceived;
        int? persistedExpected;
        String? persistedFilename;

        final controller = ScannerSyncController(
          adoptRemoteSession: (sessionId) async {
            adoptedSessionId = sessionId;
            return sessionId;
          },
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {
                persistedProgress = progress;
                persistedReceived = receivedPackets;
                persistedExpected = expectedPackets;
                persistedFilename = filename;
              },
        );

        final result = await controller.handleRemoteProgress(
          state: const ScannerRemoteProgressState(
            canScanLocally: false,
            currentScanId: null,
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0,
            currentFilename: null,
            syncSourceName: null,
          ),
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': 'scan-1',
              'receivedPackets': 30,
              'expectedPackets': 40,
              'filename': 'remote.bin',
              'deviceName': 'iPhone',
            },
          ),
        );

        expect(result, isNotNull);
        expect(adoptedSessionId, 'scan-1');
        expect(result!.currentScanId, 'scan-1');
        expect(result.remoteReceivedPackets, 30);
        expect(result.remoteExpectedPackets, 40);
        expect(result.progress, 0.75);
        expect(result.currentFilename, 'remote.bin');
        expect(result.syncSourceName, 'iPhone');
        expect(result.status, 'Session progress: 75% (30/40)');
        expect(persistedProgress, 0.75);
        expect(persistedReceived, 30);
        expect(persistedExpected, 40);
        expect(persistedFilename, 'remote.bin');
      },
    );

    test(
      'handleRemoteProgress ignores remote-only adoption when local scanner exists',
      () async {
        var adopted = false;
        final controller = ScannerSyncController(
          adoptRemoteSession: (sessionId) async {
            adopted = true;
            return sessionId;
          },
        );

        final result = await controller.handleRemoteProgress(
          state: const ScannerRemoteProgressState(
            canScanLocally: true,
            currentScanId: null,
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0,
            currentFilename: null,
            syncSourceName: null,
          ),
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': 'scan-1',
              'receivedPackets': 5,
              'expectedPackets': 10,
            },
          ),
        );

        expect(result, isNull);
        expect(adopted, isFalse);
      },
    );

    test(
      'handleRemoteProgress uses decodeThreshold and does not regress local display counters',
      () async {
        int? persistedReceived;
        int? persistedExpected;

        final controller = ScannerSyncController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {
                persistedReceived = receivedPackets;
                persistedExpected = expectedPackets;
              },
        );

        final result = await controller.handleRemoteProgress(
          state: const ScannerRemoteProgressState(
            canScanLocally: true,
            currentScanId: 'scan-1',
            displayReceivedPackets: 1200,
            displayExpectedPackets: 1416,
            remoteReceivedPackets: 680,
            remoteExpectedPackets: 1416,
            progress: 1200 / 1416,
            currentFilename: 'local.bin',
            syncSourceName: 'iPhone',
          ),
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': 'scan-1',
              'receivedPackets': 700,
              'totalPackets': 720,
              'scanState': <String, dynamic>{'decodeThreshold': 1416},
            },
          ),
        );

        expect(result, isNotNull);
        expect(result!.remoteReceivedPackets, 700);
        expect(result.remoteExpectedPackets, 1416);
        expect(result.progress, closeTo(1200 / 1416, 0.0001));
        expect(result.status, 'Session progress: 84.7% (1200/1416)');
        expect(persistedReceived, 1200);
        expect(persistedExpected, 1416);
      },
    );

    test(
      'handleRemoteProgress exposes canonical session status and chunk missing count',
      () async {
        final controller = ScannerSyncController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {},
        );

        final result = await controller.handleRemoteProgress(
          state: const ScannerRemoteProgressState(
            canScanLocally: true,
            currentScanId: 'scan-1',
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0,
            currentFilename: null,
            syncSourceName: null,
          ),
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': 'scan-1',
              'receivedPackets': 6088,
              'deviceName': 'Windows Browser',
              'scanState': <String, dynamic>{
                'decodeThreshold': 20696,
                'chunks': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'chunkId': 0,
                    'receivedUnique': 100,
                    'decodeThreshold': 120,
                    'missingCount': 20,
                  },
                  <String, dynamic>{
                    'chunkId': 1,
                    'receivedUnique': 2000,
                    'decodeThreshold': 5344,
                    'missingCount': 3344,
                  },
                ],
              },
            },
          ),
        );

        expect(result, isNotNull);
        expect(result!.remoteReceivedPackets, 6088);
        expect(result.remoteExpectedPackets, 20696);
        expect(result.remoteMissingPackets, 3364);
        expect(result.remoteChunks, hasLength(2));
        expect(result.remoteChunks.first.receivedUnique, 100);
        expect(result.remoteChunks.last.missingCount, 3344);
        expect(result.status, 'Session progress: 29.4% (6088/20696)');
        expect(result.syncSourceName, 'Windows Browser');
      },
    );

    test(
      'handleRemoteProgress accepts zero missing when server chunks are complete',
      () async {
        final controller = ScannerSyncController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {},
        );

        final result = await controller.handleRemoteProgress(
          state: const ScannerRemoteProgressState(
            canScanLocally: true,
            currentScanId: 'scan-1',
            displayReceivedPackets: 90,
            displayExpectedPackets: 100,
            remoteReceivedPackets: 90,
            remoteExpectedPackets: 100,
            remoteMissingPackets: 10,
            remoteChunks: <ScannerChunkProgressInfo>[
              ScannerChunkProgressInfo(
                chunkId: 0,
                state: ScannerChunkProgressState.scanning,
                receivedUnique: 90,
                decodeThreshold: 100,
                missingCount: 10,
              ),
            ],
            progress: 0.9,
            currentFilename: null,
            syncSourceName: null,
          ),
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': 'scan-1',
              'receivedPackets': 100,
              'deviceName': 'Windows Browser',
              'scanState': <String, dynamic>{
                'decodeThreshold': 100,
                'chunks': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'chunkId': 0,
                    'state': 'complete',
                    'receivedUnique': 100,
                    'decodeThreshold': 100,
                    'missingCount': 0,
                  },
                ],
              },
            },
          ),
        );

        expect(result, isNotNull);
        expect(result!.remoteMissingPackets, 0);
        expect(
          result.remoteChunks.single.state,
          ScannerChunkProgressState.complete,
        );
      },
    );

    test(
      'handleRemoteProgress preserves detailed chunk resume hints',
      () async {
        final controller = ScannerSyncController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {},
        );

        final result = await controller.handleRemoteProgress(
          state: const ScannerRemoteProgressState(
            canScanLocally: true,
            currentScanId: 'scan-1',
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0,
            currentFilename: null,
            syncSourceName: null,
          ),
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': 'scan-1',
              'receivedPackets': 6088,
              'scanState': <String, dynamic>{
                'decodeThreshold': 20696,
                'chunksTotal': 5,
                'chunks': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'chunkId': 0,
                    'state': 'scanning',
                    'receivedUnique': 1180,
                    'decodeThreshold': 1465,
                    'missingCount': 285,
                    'targetFrameCount': 285,
                    'unseenFrameCount': 871,
                  },
                ],
              },
            },
          ),
        );

        expect(result, isNotNull);
        expect(result!.remoteChunks, hasLength(5));
        expect(
          result.remoteChunks.first.state,
          ScannerChunkProgressState.scanning,
        );
        expect(result.remoteChunks.first.targetFrameCount, 285);
        expect(result.remoteChunks.first.unseenFrameCount, 871);
        expect(
          result.remoteChunks.last.state,
          ScannerChunkProgressState.missing,
        );
      },
    );

    test(
      'handleRemoteProgress caps incomplete threshold progress at 99.9 percent',
      () async {
        final controller = ScannerSyncController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {},
        );

        final result = await controller.handleRemoteProgress(
          state: const ScannerRemoteProgressState(
            canScanLocally: true,
            currentScanId: 'scan-1',
            displayReceivedPackets: 200,
            displayExpectedPackets: 200,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0,
            currentFilename: null,
            syncSourceName: null,
          ),
          event: SyncEvent(
            type: 'scan-progress',
            payload: <String, dynamic>{
              'sessionId': 'scan-1',
              'receivedPackets': 200,
              'expectedPackets': 200,
            },
          ),
        );

        expect(result, isNotNull);
        expect(result!.progress, 0.999);
        expect(result.status, 'Session progress: 99.9% (200/200)');
      },
    );

    test(
      'handleRemoteCompletion marks the scan complete and requests sync',
      () async {
        var completed = false;
        var syncAllCalled = false;

        final controller = ScannerSyncController(
          completeCurrentScan: () async {
            completed = true;
          },
          syncAll: () async {
            syncAllCalled = true;
          },
        );

        final result = await controller.handleRemoteCompletion(
          state: const ScannerRemoteCompletionState(
            canScanLocally: false,
            currentScanId: 'scan-2',
            completionHandled: false,
            scanDurationSeconds: 8.4,
          ),
          event: SyncEvent(
            type: 'scan-complete',
            payload: <String, dynamic>{
              'sessionId': 'scan-2',
              'filename': 'done.zip',
              'deviceName': 'iPhone',
              'size': 2048,
              'duration': 0,
              'mimeType': 'application/zip',
            },
          ),
        );

        expect(result, isNotNull);
        expect(completed, isTrue);
        expect(syncAllCalled, isTrue);
        expect(result!.currentScanId, isNull);
        expect(result.completionHandled, isTrue);
        expect(result.isScanning, isFalse);
        expect(result.progress, 1.0);
        expect(result.resultFilename, 'done.zip');
        expect(result.resultSessionId, 'scan-2');
        expect(result.resultFileSizeBytes, 2048);
        expect(result.resultDurationSeconds, 8.4);
        expect(result.resultSubtitle, 'Completed on iPhone');
        expect(result.status, contains('Completed on iPhone'));
        expect(result.status, contains('done.zip'));
        expect(result.status, contains('application/zip'));
        expect(result.snackBarMessage, contains('Scan synced: done.zip'));
      },
    );
  });
}
