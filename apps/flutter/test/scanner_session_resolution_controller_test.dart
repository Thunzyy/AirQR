import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/scanner_session_resolution_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerSessionResolutionController', () {
    test('resolve keeps the QR session id when nothing blocks the scan', () async {
      final controller = ScannerSessionResolutionController(
        getHistory: () async => const <HistoryItem>[],
        fetchSessionInfo: (sessionId) async => null,
      );

      final result = await controller.resolve(
        qrSessionId: 'scan-1',
        isExplicitResume: false,
        ignoredCompletedSessionIds: <String>{},
      );

      expect(result.sessionId, 'scan-1');
      expect(result.lockToCurrent, isFalse);
      expect(result.skipSession, isFalse);
      expect(result.ignoredCompletedSessionIds, isEmpty);
    });

    test('resolve skips sessions already present in local scanned history', () async {
      var removedSessionId = '';
      final controller = ScannerSessionResolutionController(
        getHistory: () async => <HistoryItem>[
          HistoryItem(
            path: '/tmp/already.bin',
            timestamp: 1,
            size: 10,
            origin: 'scanned',
            serverId: 'scan-2',
          ),
        ],
        removeIncompleteScan: (sessionId) async {
          removedSessionId = sessionId;
        },
        fetchSessionInfo: (sessionId) async => null,
      );

      final result = await controller.resolve(
        qrSessionId: 'scan-2',
        isExplicitResume: false,
        ignoredCompletedSessionIds: <String>{},
      );

      expect(result.sessionId, isNull);
      expect(result.skipSession, isTrue);
      expect(result.ignoredCompletedSessionIds, contains('scan-2'));
      expect(removedSessionId, 'scan-2');
    });

    test('resolve skips completed server sessions and remembers them as ignored', () async {
      var removedSessionId = '';
      final controller = ScannerSessionResolutionController(
        getHistory: () async => const <HistoryItem>[],
        removeIncompleteScan: (sessionId) async {
          removedSessionId = sessionId;
        },
        fetchSessionInfo: (sessionId) async => <String, dynamic>{
          'completed': true,
          'receivedCount': 50,
        },
      );

      final result = await controller.resolve(
        qrSessionId: 'scan-3',
        isExplicitResume: false,
        ignoredCompletedSessionIds: <String>{},
      );

      expect(result.sessionId, isNull);
      expect(result.skipSession, isTrue);
      expect(result.ignoredCompletedSessionIds, contains('scan-3'));
      expect(removedSessionId, 'scan-3');
    });

    test('resolve skips already ignored completed sessions without extra work', () async {
      var historyRead = false;
      final controller = ScannerSessionResolutionController(
        getHistory: () async {
          historyRead = true;
          return const <HistoryItem>[];
        },
      );

      final result = await controller.resolve(
        qrSessionId: 'scan-4',
        isExplicitResume: false,
        ignoredCompletedSessionIds: <String>{'scan-4'},
      );

      expect(result.sessionId, isNull);
      expect(result.skipSession, isTrue);
      expect(historyRead, isFalse);
    });
  });
}
