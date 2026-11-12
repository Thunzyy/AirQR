import 'dart:typed_data';

import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/scanner_resume_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerResumeController', () {
    test('loadResume restores saved stats and packet list for the resumed session', () async {
      var resumedSessionId = '';
      final controller = ScannerResumeController(
        getIncompleteScanById: (scanId) async => IncompleteScan(
          id: scanId,
          startTimestamp: 10,
          lastUpdateTimestamp: 20,
          progress: 0.4,
          receivedPackets: 40,
          expectedPackets: 100,
          filename: 'resume.bin',
        ),
        resumeSession: (scanId) async {
          resumedSessionId = scanId;
        },
        getPacketsWithRemote: (scanId) async => <Uint8List>[
          Uint8List.fromList(const <int>[1, 2]),
          Uint8List.fromList(const <int>[3, 4]),
        ],
      );

      final result = await controller.loadResume('scan-1');

      expect(resumedSessionId, 'scan-1');
      expect(result.currentScanId, 'scan-1');
      expect(result.receivedPackets, 40);
      expect(result.expectedPackets, 100);
      expect(result.currentFilename, 'resume.bin');
      expect(result.progress, 0.4);
      expect(result.packets, hasLength(2));
      expect(result.isExplicitResume, isTrue);
      expect(result.lockSessionIdToCurrent, isTrue);
      expect(result.status, 'Resuming scan... (2 packets)');
    });

    test('loadResume falls back to empty stats when no incomplete scan metadata exists', () async {
      final controller = ScannerResumeController(
        getIncompleteScanById: (scanId) async => null,
        resumeSession: (scanId) async {},
        getPacketsWithRemote: (scanId) async => <Uint8List>[],
      );

      final result = await controller.loadResume('scan-2');

      expect(result.currentScanId, 'scan-2');
      expect(result.receivedPackets, 0);
      expect(result.expectedPackets, 0);
      expect(result.currentFilename, isNull);
      expect(result.progress, 0.0);
      expect(result.packets, isEmpty);
      expect(result.status, 'Resuming scan... (0 packets)');
    });

    test('loadResume keeps web-seeded session metadata when packets come from remote storage', () async {
      var resumedSessionId = '';
      final controller = ScannerResumeController(
        getIncompleteScanById: (scanId) async => IncompleteScan(
          id: scanId,
          startTimestamp: 10,
          lastUpdateTimestamp: 20,
          progress: 18 / 86,
          receivedPackets: 18,
          expectedPackets: 86,
          filename: 'cross-device-realtime.bin',
          isRemote: true,
          deviceName: 'Chrome Web',
          deviceId: 'chrome-web',
        ),
        resumeSession: (scanId) async {
          resumedSessionId = scanId;
        },
        getPacketsWithRemote: (scanId) async => <Uint8List>[
          Uint8List.fromList(const <int>[1, 2, 3]),
          Uint8List.fromList(const <int>[4, 5, 6]),
          Uint8List.fromList(const <int>[7, 8, 9]),
        ],
      );

      final result = await controller.loadResume('scan-web-1');

      expect(resumedSessionId, 'scan-web-1');
      expect(result.currentScanId, 'scan-web-1');
      expect(result.receivedPackets, 18);
      expect(result.expectedPackets, 86);
      expect(result.currentFilename, 'cross-device-realtime.bin');
      expect(result.progress, closeTo(18 / 86, 0.0001));
      expect(result.packets, hasLength(3));
      expect(result.isExplicitResume, isTrue);
      expect(result.lockSessionIdToCurrent, isTrue);
      expect(result.status, 'Resuming scan... (3 packets)');
    });
  });
}
