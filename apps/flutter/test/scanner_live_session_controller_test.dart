import 'package:airqr_mobile/scanner_live_session_controller.dart';
import 'package:airqr_mobile/scanner_session_resolution_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerLiveSessionController', () {
    test('ensureSession starts a fresh session from the resolved QR session id', () async {
      String? resolvedQrSessionId;
      String? startedWithSessionId;

      final controller = ScannerLiveSessionController(
        resolveFreshSession: (qrSessionId) async {
          resolvedQrSessionId = qrSessionId;
          return const ScannerSessionResolutionResult(
            sessionId: 'scan-1',
            lockToCurrent: true,
            skipSession: false,
            ignoredCompletedSessionIds: <String>{},
          );
        },
        startNewSession: ({required sessionId}) async {
          startedWithSessionId = sessionId;
          return sessionId ?? 'generated';
        },
      );

      final transition = await controller.ensureSession(
        qrSessionId: 'scan-1',
        state: const ScannerLiveSessionState(
          currentScanId: null,
          isExplicitResume: false,
          lockSessionIdToCurrent: false,
          completionHandled: true,
          currentFilename: 'old.bin',
          remoteReceivedPackets: 10,
          remoteExpectedPackets: 20,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: 123,
        ),
      );

      expect(transition, isA<ScannerLiveSessionReadyTransition>());
      final ready = transition as ScannerLiveSessionReadyTransition;
      expect(resolvedQrSessionId, 'scan-1');
      expect(startedWithSessionId, 'scan-1');
      expect(ready.currentScanId, 'scan-1');
      expect(ready.isExplicitResume, isFalse);
      expect(ready.lockSessionIdToCurrent, isTrue);
      expect(ready.completionHandled, isFalse);
      expect(ready.currentFilename, isNull);
      expect(ready.remoteReceivedPackets, 0);
      expect(ready.remoteExpectedPackets, 0);
      expect(ready.scanStartedAtMs, isNull);
      expect(ready.shouldRefreshGlobalCounters, isTrue);
    });

    test('ensureSession keeps the current session when resume lock is active', () async {
      var started = false;
      final controller = ScannerLiveSessionController(
        resolveFreshSession: (qrSessionId) async => ScannerSessionResolutionResult(
          sessionId: qrSessionId,
          lockToCurrent: false,
          skipSession: false,
          ignoredCompletedSessionIds: const <String>{},
        ),
        startNewSession: ({required sessionId}) async {
          started = true;
          return sessionId ?? 'generated';
        },
      );

      final transition = await controller.ensureSession(
        qrSessionId: 'scan-2',
        state: const ScannerLiveSessionState(
          currentScanId: 'resume-1',
          isExplicitResume: true,
          lockSessionIdToCurrent: true,
          completionHandled: false,
          currentFilename: 'resume.bin',
          remoteReceivedPackets: 3,
          remoteExpectedPackets: 4,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: 55,
        ),
      );

      expect(transition, isA<ScannerLiveSessionReadyTransition>());
      final ready = transition as ScannerLiveSessionReadyTransition;
      expect(started, isFalse);
      expect(ready.currentScanId, 'resume-1');
      expect(ready.lockSessionIdToCurrent, isTrue);
      expect(ready.currentFilename, 'resume.bin');
      expect(ready.remoteReceivedPackets, 3);
      expect(ready.remoteExpectedPackets, 4);
      expect(ready.shouldRefreshGlobalCounters, isFalse);
    });

    test('ensureSession switches to a new QR session when the current one is not locked', () async {
      String? startedWithSessionId;
      final controller = ScannerLiveSessionController(
        resolveFreshSession: (qrSessionId) async => ScannerSessionResolutionResult(
          sessionId: qrSessionId,
          lockToCurrent: false,
          skipSession: false,
          ignoredCompletedSessionIds: const <String>{},
        ),
        startNewSession: ({required sessionId}) async {
          startedWithSessionId = sessionId;
          return 'switched-2';
        },
      );

      final transition = await controller.ensureSession(
        qrSessionId: 'scan-2',
        state: const ScannerLiveSessionState(
          currentScanId: 'scan-1',
          isExplicitResume: false,
          lockSessionIdToCurrent: false,
          completionHandled: true,
          currentFilename: 'old.bin',
          remoteReceivedPackets: 5,
          remoteExpectedPackets: 8,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: 22,
        ),
      );

      expect(transition, isA<ScannerLiveSessionReadyTransition>());
      final ready = transition as ScannerLiveSessionReadyTransition;
      expect(startedWithSessionId, 'scan-2');
      expect(ready.currentScanId, 'switched-2');
      expect(ready.lockSessionIdToCurrent, isFalse);
      expect(ready.completionHandled, isFalse);
      expect(ready.currentFilename, isNull);
      expect(ready.remoteReceivedPackets, 0);
      expect(ready.remoteExpectedPackets, 0);
      expect(ready.scanStartedAtMs, isNull);
      expect(ready.shouldRefreshGlobalCounters, isTrue);
    });

    test('ensureSession skips the frame when fresh session resolution says to ignore it', () async {
      final controller = ScannerLiveSessionController(
        resolveFreshSession: (qrSessionId) async => const ScannerSessionResolutionResult(
          sessionId: null,
          lockToCurrent: false,
          skipSession: true,
          ignoredCompletedSessionIds: <String>{'scan-3'},
        ),
      );

      final transition = await controller.ensureSession(
        qrSessionId: 'scan-3',
        state: const ScannerLiveSessionState(
          currentScanId: null,
          isExplicitResume: false,
          lockSessionIdToCurrent: false,
          completionHandled: false,
          currentFilename: null,
          remoteReceivedPackets: 0,
          remoteExpectedPackets: 0,
          lastRemoteProgressFetch: null,
          scanStartedAtMs: null,
        ),
      );

      expect(transition, isA<ScannerLiveSessionSkippedTransition>());
    });
  });
}
