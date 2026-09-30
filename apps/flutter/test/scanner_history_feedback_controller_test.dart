import 'package:airqr_mobile/scanner_history_feedback_controller.dart';
import 'package:airqr_mobile/scanner_history_save_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerHistoryFeedbackController', () {
    test('save returns success transition with saved file metadata', () async {
      final controller = ScannerHistoryFeedbackController(
        saveHistoryItem: ({
          required data,
          required filename,
          required sessionId,
        }) async {
          expect(data, orderedEquals(const <int>[1, 2, 3]));
          expect(filename, 'capture.bin');
          expect(sessionId, 'scan-1');
          return const ScannerHistorySaveResult(
            filePath: '/docs/capture.bin',
            fileName: 'capture.bin',
            timestamp: 123,
          );
        },
      );

      final transition = await controller.save(
        data: const <int>[1, 2, 3],
        filename: 'capture.bin',
        sessionId: 'scan-1',
      );

      expect(transition, isA<ScannerHistoryFeedbackSuccessTransition>());
      final success = transition as ScannerHistoryFeedbackSuccessTransition;
      expect(success.filePath, '/docs/capture.bin');
      expect(success.fileName, 'capture.bin');
    });

    test('save returns failure transition when persistence throws', () async {
      final controller = ScannerHistoryFeedbackController(
        saveHistoryItem: ({
          required data,
          required filename,
          required sessionId,
        }) async {
          throw StateError('disk full');
        },
      );

      final transition = await controller.save(
        data: const <int>[9],
        filename: 'bad.bin',
        sessionId: 'scan-2',
      );

      expect(transition, isA<ScannerHistoryFeedbackFailureTransition>());
      final failure = transition as ScannerHistoryFeedbackFailureTransition;
      expect(failure.status, 'Error saving: Bad state: disk full');
    });
  });
}
