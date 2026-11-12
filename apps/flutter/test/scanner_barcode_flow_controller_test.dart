import 'dart:typed_data';

import 'package:airqr_mobile/scanner_barcode_flow_controller.dart';
import 'package:airqr_mobile/scanner_live_session_controller.dart';
import 'package:airqr_mobile/scanner_local_decode_controller.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerBarcodeFlowController', () {
    test('handle returns progress transition with session and widget progress updates', () async {
      String? ensuredQrSessionId;
      String? decodeSessionId;

      final controller = ScannerBarcodeFlowController(
        ensureSession: ({required qrSessionId, required state}) async {
          ensuredQrSessionId = qrSessionId;
          return const ScannerLiveSessionReadyTransition(
            currentScanId: 'scan-42',
            isExplicitResume: false,
            lockSessionIdToCurrent: true,
            completionHandled: false,
            currentFilename: null,
            remoteReceivedPackets: 0,
            remoteExpectedPackets: 0,
            lastRemoteProgressFetch: null,
            scanStartedAtMs: null,
            shouldRefreshGlobalCounters: true,
          );
        },
        applyLocalDecode: ({
          required result,
          required rawBytes,
          required state,
          required localSyncSourceName,
        }) async {
          decodeSessionId = state.currentScanId;
          return const ScannerLocalProgressTransition(
            receivedPackets: 9,
            expectedPackets: 20,
            progress: 0.45,
            status: 'Progress: 45.0% (9/20)',
            currentFilename: 'capture.bin',
            syncSourceName: 'This Device',
            shouldRefreshGlobalCounters: true,
          );
        },
      );

      final bytes = Uint8List(31);
      final view = ByteData.sublistView(bytes);
      view.setUint8(0, 1);
      view.setUint32(1, 4242);

      final transition = await controller.handle(
        result: DecodeStatus(
          status: 'Progress',
          percent: 45,
          receivedPackets: 9,
          expectedPackets: 20,
          durationMs: BigInt.zero,
          totalPackets: 20,
          filename: 'capture.bin',
        ),
        rawBytes: bytes,
        state: const ScannerBarcodeFlowState(
          currentScanId: null,
          isExplicitResume: false,
          lockSessionIdToCurrent: false,
          completionHandled: false,
          currentFilename: null,
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: null,
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          progress: 0.0,
          scanDurationSeconds: 2.5,
          syncSourceName: 'Old Device',
          lastUpdateTime: 1000,
          framesInCurrentSecond: 0,
        ),
        nowMillis: 1500,
        localSyncSourceName: 'This Device',
      );

      expect(transition, isA<ScannerBarcodeProgressFlowTransition>());
      final progress = transition as ScannerBarcodeProgressFlowTransition;
      expect(ensuredQrSessionId, '4242');
      expect(decodeSessionId, 'scan-42');
      expect(progress.session.currentScanId, 'scan-42');
      expect(progress.shouldForceGlobalCounterRefresh, isTrue);
      expect(progress.scanStartedAtMs, 1500);
      expect(progress.progressUpdate.receivedPackets, 9);
      expect(progress.progressUpdate.expectedPackets, 20);
      expect(progress.progressUpdate.currentFilename, 'capture.bin');
      expect(progress.progressUpdate.status, 'Progress: 45.0% (9/20)');
      expect(progress.progressUpdate.syncSourceName, 'This Device');
      expect(progress.progressUpdate.shouldApplyWidgetUpdate, isTrue);
      expect(progress.qrSessionId, '4242');
    });

    test('handle returns ignored transition when live session skips the frame', () async {
      final controller = ScannerBarcodeFlowController(
        ensureSession: ({required qrSessionId, required state}) async {
          return const ScannerLiveSessionSkippedTransition();
        },
      );

      final transition = await controller.handle(
        result: DecodeStatus(
          status: 'Progress',
          percent: 10,
          receivedPackets: 1,
          expectedPackets: 10,
          durationMs: BigInt.zero,
          totalPackets: 10,
        ),
        rawBytes: Uint8List.fromList(const <int>[1, 2, 3]),
        state: const ScannerBarcodeFlowState(
          currentScanId: null,
          isExplicitResume: false,
          lockSessionIdToCurrent: false,
          completionHandled: false,
          currentFilename: null,
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: null,
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          progress: 0,
          scanDurationSeconds: 0,
          syncSourceName: null,
          lastUpdateTime: 0,
          framesInCurrentSecond: 0,
        ),
        nowMillis: 1500,
        localSyncSourceName: 'This Device',
      );

      expect(transition, isA<ScannerBarcodeIgnoredTransition>());
    });

    test('handle returns completion transition from completed decode result', () async {
      final controller = ScannerBarcodeFlowController(
        applyLocalDecode: ({
          required result,
          required rawBytes,
          required state,
          required localSyncSourceName,
        }) async {
          return ScannerLocalCompletedTransition(
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
          );
        },
      );

      final transition = await controller.handle(
        result: DecodeStatus(
          status: 'Completed',
          percent: 100,
          receivedPackets: 20,
          expectedPackets: 20,
          durationMs: BigInt.zero,
          totalPackets: 20,
          filename: 'done.zip',
          fileData: Uint8List.fromList(const <int>[1, 2, 3]),
        ),
        rawBytes: Uint8List(0),
        state: const ScannerBarcodeFlowState(
          currentScanId: 'scan-2',
          isExplicitResume: false,
          lockSessionIdToCurrent: false,
          completionHandled: false,
          currentFilename: 'done.zip',
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: 100,
          displayReceivedPackets: 20,
          displayExpectedPackets: 20,
          progress: 1,
          scanDurationSeconds: 8.4,
          syncSourceName: 'This Device',
          lastUpdateTime: 1000,
          framesInCurrentSecond: 0,
        ),
        nowMillis: 1500,
        localSyncSourceName: 'This Device',
      );

      expect(transition, isA<ScannerBarcodeCompletedFlowTransition>());
      final completed = transition as ScannerBarcodeCompletedFlowTransition;
      expect(completed.completionUpdate.resultFilename, 'done.zip');
      expect(completed.completionUpdate.resultSessionId, 'scan-2');
      expect(completed.completionUpdate.resultFileSizeBytes, 2048);
      expect(completed.completionUpdate.progress, 1.0);
    });

    test('handle returns error transition from decode errors', () async {
      final controller = ScannerBarcodeFlowController(
        applyLocalDecode: ({
          required result,
          required rawBytes,
          required state,
          required localSyncSourceName,
        }) async {
          return const ScannerLocalErrorTransition(
            status: 'Error: bad packet',
          );
        },
      );

      final transition = await controller.handle(
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
        state: const ScannerBarcodeFlowState(
          currentScanId: 'scan-3',
          isExplicitResume: false,
          lockSessionIdToCurrent: false,
          completionHandled: false,
          currentFilename: null,
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: null,
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          progress: 0,
          scanDurationSeconds: 0,
          syncSourceName: 'This Device',
          lastUpdateTime: 0,
          framesInCurrentSecond: 0,
        ),
        nowMillis: 1500,
        localSyncSourceName: 'This Device',
      );

      expect(transition, isA<ScannerBarcodeErrorFlowTransition>());
      expect(
        (transition as ScannerBarcodeErrorFlowTransition).errorUpdate.status,
        'Error: bad packet',
      );
    });
  });
}
