import 'dart:typed_data';

import 'package:airqr_mobile/scanner_resume_replay_controller.dart';
import 'package:airqr_mobile/scanner_resume_flow_controller.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerResumeReplayController', () {
    test(
      'replay emits progress updates and finishes when replay stays incomplete',
      () async {
        final controller = ScannerResumeReplayController();
        final seenProgress = <ScannerResumeReplayProgressUpdate>[];

        final result = await controller.replay(
          packets: <Uint8List>[
            Uint8List.fromList(const <int>[1]),
            Uint8List.fromList(const <int>[2]),
          ],
          currentScanId: 'scan-1',
          completionHandled: false,
          processChunk: (packet) async => DecodeStatus(
            status: 'Progress',
            percent: packet.first == 1 ? 25.0 : 50.0,
            receivedPackets: packet.first == 1 ? 1 : 2,
            expectedPackets: 4,
            durationMs: BigInt.zero,
            totalPackets: 4,
          ),
          scanDurationSeconds: () => 3.5,
          onProgress: (progressUpdate, packetIndex, totalPackets) {
            expect(packetIndex, lessThan(totalPackets));
            seenProgress.add(progressUpdate);
          },
        );

        expect(result, isA<ScannerResumeReplayFinishedResult>());
        expect(seenProgress, hasLength(2));
        expect(seenProgress.first.receivedPackets, 1);
        expect(seenProgress.first.status, 'Resuming: 25% (1/4)');
        expect(seenProgress.last.receivedPackets, 2);
        expect(seenProgress.last.progress, 0.5);
      },
    );

    test(
      'replay returns completion update with file data when decoding completes',
      () async {
        final controller = ScannerResumeReplayController();

        final result = await controller.replay(
          packets: <Uint8List>[
            Uint8List.fromList(const <int>[9]),
          ],
          currentScanId: 'scan-2',
          completionHandled: false,
          processChunk: (_) async => DecodeStatus(
            status: 'Completed',
            percent: 100,
            receivedPackets: 10,
            expectedPackets: 10,
            durationMs: BigInt.zero,
            totalPackets: 10,
            filename: 'done.zip',
            fileData: Uint8List.fromList(const <int>[1, 2, 3]),
          ),
          scanDurationSeconds: () => 8.4,
          onProgress: (progressUpdate, packetIndex, totalPackets) {
            expect(progressUpdate.progress, greaterThanOrEqualTo(0));
            expect(packetIndex, lessThan(totalPackets));
          },
        );

        expect(result, isA<ScannerResumeReplayCompletedResult>());
        final completion =
            (result as ScannerResumeReplayCompletedResult).completionUpdate;
        expect(completion.resultFilename, 'done.zip');
        expect(completion.resultSessionId, 'scan-2');
        expect(completion.resultDurationSeconds, 8.4);
        expect(completion.fileData, isNotEmpty);
        expect(completion.isScanning, isFalse);
      },
    );

    test(
      'replay returns interrupted result when processChunk throws',
      () async {
        final controller = ScannerResumeReplayController();
        final seenProgress = <ScannerResumeReplayProgressUpdate>[];

        final result = await controller.replay(
          packets: <Uint8List>[
            Uint8List.fromList(const <int>[1]),
            Uint8List.fromList(const <int>[2]),
          ],
          currentScanId: 'scan-3',
          completionHandled: false,
          processChunk: (packet) async {
            if (packet.first == 2) {
              throw StateError('boom');
            }
            return DecodeStatus(
              status: 'Progress',
              percent: 50.0,
              receivedPackets: 1,
              expectedPackets: 2,
              durationMs: BigInt.zero,
              totalPackets: 2,
            );
          },
          scanDurationSeconds: () => 1.2,
          onProgress: (progressUpdate, packetIndex, totalPackets) {
            expect(packetIndex, lessThan(totalPackets));
            seenProgress.add(progressUpdate);
          },
        );

        expect(result, isA<ScannerResumeReplayInterruptedResult>());
        final interrupted = result as ScannerResumeReplayInterruptedResult;
        expect(interrupted.failedPacketIndex, 1);
        expect(interrupted.totalPackets, 2);
        expect(interrupted.error, isA<StateError>());
        expect(seenProgress, hasLength(1));
      },
    );
  });
}
