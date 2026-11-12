import 'package:airqr_mobile/scanner_remote_snapshot_controller.dart';
import 'package:airqr_mobile/scanner_session_progress.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerRemoteSnapshotController', () {
    test(
      'prepareRequest skips when throttled and returns target session when forced',
      () {
        final controller = ScannerRemoteSnapshotController();
        final now = DateTime(2026, 4, 5, 12, 0, 1);

        final throttled = controller.prepareRequest(
          state: ScannerRemoteSnapshotRequestState(
            syncScannedEnabled: true,
            currentScanId: 'scan-1',
            remoteProgressInFlight: false,
            lastRemoteProgressFetch: DateTime(2026, 4, 5, 12, 0, 0, 500),
          ),
          sessionId: null,
          force: false,
          now: now,
        );

        expect(throttled, isNull);

        final forced = controller.prepareRequest(
          state: ScannerRemoteSnapshotRequestState(
            syncScannedEnabled: true,
            currentScanId: 'scan-1',
            remoteProgressInFlight: false,
            lastRemoteProgressFetch: DateTime(2026, 4, 5, 12, 0, 0, 500),
          ),
          sessionId: null,
          force: true,
          now: now,
        );

        expect(forced, isNotNull);
        expect(forced!.targetSessionId, 'scan-1');
        expect(forced.nextLastRemoteProgressFetch, now);
      },
    );

    test(
      'applySnapshot merges remote counters with display counters and persists progress',
      () async {
        double? persistedProgress;
        int? persistedReceived;
        int? persistedExpected;
        String? persistedFilename;

        final controller = ScannerRemoteSnapshotController(
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

        final result = await controller.applySnapshot(
          state: const ScannerRemoteSnapshotState(
            currentScanId: 'scan-1',
            displayReceivedPackets: 35,
            displayExpectedPackets: 60,
            remoteReceivedPackets: 30,
            remoteExpectedPackets: 50,
            progress: 0.4,
            currentFilename: 'old.bin',
          ),
          targetSessionId: 'scan-1',
          sessionInfo: <String, dynamic>{
            'receivedCount': 40,
            'totalPackets': 70,
            'filename': 'remote.bin',
          },
        );

        expect(result, isNotNull);
        expect(result!.remoteReceivedPackets, 40);
        expect(result.remoteExpectedPackets, 70);
        expect(result.currentFilename, 'remote.bin');
        expect(result.progress, 40 / 70);
        expect(persistedProgress, 40 / 70);
        expect(persistedReceived, 40);
        expect(persistedExpected, 70);
        expect(persistedFilename, 'remote.bin');
      },
    );

    test(
      'applySnapshot exposes canonical session status and chunk missing count',
      () async {
        final controller = ScannerRemoteSnapshotController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {},
        );

        final result = await controller.applySnapshot(
          state: const ScannerRemoteSnapshotState(
            currentScanId: 'scan-1',
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0,
            currentFilename: null,
          ),
          targetSessionId: 'scan-1',
          sessionInfo: const <String, dynamic>{
            'sessionId': 'scan-1',
            'receivedCount': 6088,
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
        );

        expect(result, isNotNull);
        expect(result!.remoteReceivedPackets, 6088);
        expect(result.remoteExpectedPackets, 20696);
        expect(result.remoteMissingPackets, 3364);
        expect(result.remoteChunks, hasLength(2));
        expect(result.remoteChunks.first.receivedUnique, 100);
        expect(result.remoteChunks.last.missingCount, 3344);
        expect(result.status, 'Session progress: 29.4% (6088/20696)');
      },
    );

    test(
      'applySnapshot accepts zero missing when server chunks are complete',
      () async {
        final controller = ScannerRemoteSnapshotController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {},
        );

        final result = await controller.applySnapshot(
          state: const ScannerRemoteSnapshotState(
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
          ),
          targetSessionId: 'scan-1',
          sessionInfo: const <String, dynamic>{
            'sessionId': 'scan-1',
            'receivedCount': 100,
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
        );

        expect(result, isNotNull);
        expect(result!.remoteMissingPackets, 0);
        expect(
          result.remoteChunks.single.state,
          ScannerChunkProgressState.complete,
        );
      },
    );

    test('applySnapshot exposes detailed chunk resume hints', () async {
      final controller = ScannerRemoteSnapshotController(
        updateIncompleteProgress:
            ({
              required progress,
              required receivedPackets,
              required expectedPackets,
              required filename,
            }) async {},
      );

      final result = await controller.applySnapshot(
        state: const ScannerRemoteSnapshotState(
          currentScanId: 'scan-1',
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          progress: 0,
          currentFilename: null,
        ),
        targetSessionId: 'scan-1',
        sessionInfo: const <String, dynamic>{
          'sessionId': 'scan-1',
          'receivedCount': 6088,
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
      );

      expect(result, isNotNull);
      expect(result!.remoteChunks, hasLength(5));
      expect(
        result.remoteChunks.first.state,
        ScannerChunkProgressState.scanning,
      );
      expect(result.remoteChunks.first.targetFrameCount, 285);
      expect(result.remoteChunks.first.unseenFrameCount, 871);
      expect(result.remoteChunks.last.state, ScannerChunkProgressState.missing);
    });

    test(
      'applySnapshot keeps local scan counters visible while server upload catches up',
      () async {
        double? persistedProgress;
        int? persistedReceived;
        int? persistedExpected;

        final controller = ScannerRemoteSnapshotController(
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
              },
        );

        final result = await controller.applySnapshot(
          state: const ScannerRemoteSnapshotState(
            currentScanId: 'scan-1',
            displayReceivedPackets: 1200,
            displayExpectedPackets: 1416,
            remoteReceivedPackets: 680,
            remoteExpectedPackets: 1416,
            progress: 1200 / 1416,
            currentFilename: 'local.bin',
          ),
          targetSessionId: 'scan-1',
          sessionInfo: <String, dynamic>{
            'receivedCount': 700,
            'totalPackets': 720,
            'scanState': <String, dynamic>{'decodeThreshold': 1416},
            'filename': 'remote.bin',
          },
        );

        expect(result, isNotNull);
        expect(result!.remoteReceivedPackets, 700);
        expect(result.remoteExpectedPackets, 1416);
        expect(result.progress, closeTo(1200 / 1416, 0.0001));
        expect(persistedProgress, closeTo(1200 / 1416, 0.0001));
        expect(persistedReceived, 1200);
        expect(persistedExpected, 1416);
      },
    );

    test(
      'applySnapshot caps incomplete server threshold progress at 99.9 percent',
      () async {
        final controller = ScannerRemoteSnapshotController(
          updateIncompleteProgress:
              ({
                required progress,
                required receivedPackets,
                required expectedPackets,
                required filename,
              }) async {},
        );

        final result = await controller.applySnapshot(
          state: const ScannerRemoteSnapshotState(
            currentScanId: 'scan-1',
            displayReceivedPackets: 200,
            displayExpectedPackets: 200,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0,
            currentFilename: null,
          ),
          targetSessionId: 'scan-1',
          sessionInfo: <String, dynamic>{
            'receivedCount': 200,
            'expectedPackets': 200,
          },
        );

        expect(result, isNotNull);
        expect(result!.progress, 0.999);
      },
    );

    test(
      'applySnapshot ignores null or empty payloads and session mismatches',
      () async {
        final controller = ScannerRemoteSnapshotController();

        final nullPayload = await controller.applySnapshot(
          state: const ScannerRemoteSnapshotState(
            currentScanId: 'scan-1',
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0.0,
            currentFilename: null,
          ),
          targetSessionId: 'scan-1',
          sessionInfo: null,
        );
        expect(nullPayload, isNull);

        final mismatched = await controller.applySnapshot(
          state: const ScannerRemoteSnapshotState(
            currentScanId: 'scan-2',
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            progress: 0.0,
            currentFilename: null,
          ),
          targetSessionId: 'scan-1',
          sessionInfo: <String, dynamic>{
            'receivedPackets': 0,
            'expectedPackets': 0,
          },
        );
        expect(mismatched, isNull);
      },
    );
  });
}
