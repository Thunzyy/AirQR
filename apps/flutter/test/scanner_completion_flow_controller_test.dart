import 'package:airqr_mobile/scanner_completion_flow_controller.dart';
import 'package:airqr_mobile/scanner_history_feedback_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerCompletionFlowController', () {
    test('finalize stops controller and returns saved transition', () async {
      final calls = <String>[];
      final controller = ScannerCompletionFlowController(
        saveHistory: ({
          required data,
          required filename,
          required sessionId,
        }) async {
          calls.add('save:$filename:$sessionId:${data.length}');
          return const ScannerHistoryFeedbackSuccessTransition(
            filePath: '/docs/done.zip',
            fileName: 'done.zip',
          );
        },
        log: calls.add,
      );

      final transition = await controller.finalize(
        data: const <int>[1, 2, 3],
        filename: 'done.zip',
        sessionId: 'scan-1',
        stopController: () async {
          calls.add('stop');
        },
      );

      expect(calls, ['stop', 'save:done.zip:scan-1:3']);
      expect(transition, isA<ScannerCompletionFlowSavedTransition>());
      final saved = transition as ScannerCompletionFlowSavedTransition;
      expect(saved.filePath, '/docs/done.zip');
      expect(saved.snackBarMessage, 'File saved: done.zip');
    });

    test('finalize continues when stopping controller fails', () async {
      final calls = <String>[];
      final controller = ScannerCompletionFlowController(
        saveHistory: ({
          required data,
          required filename,
          required sessionId,
        }) async {
          calls.add('save');
          return const ScannerHistoryFeedbackSuccessTransition(
            filePath: '/docs/done.zip',
            fileName: 'done.zip',
          );
        },
        log: calls.add,
      );

      final transition = await controller.finalize(
        data: const <int>[1],
        filename: 'done.zip',
        sessionId: 'scan-2',
        stopController: () async {
          throw StateError('camera busy');
        },
      );

      expect(transition, isA<ScannerCompletionFlowSavedTransition>());
      expect(calls.first, 'Error stopping controller: Bad state: camera busy');
      expect(calls.last, 'save');
    });

    test('finalize returns failure transition when history save fails', () async {
      final controller = ScannerCompletionFlowController(
        saveHistory: ({
          required data,
          required filename,
          required sessionId,
        }) async {
          return const ScannerHistoryFeedbackFailureTransition(
            status: 'Error saving: disk full',
          );
        },
      );

      final transition = await controller.finalize(
        data: const <int>[9],
        filename: 'bad.bin',
        sessionId: 'scan-3',
      );

      expect(transition, isA<ScannerCompletionFlowFailedTransition>());
      expect(
        (transition as ScannerCompletionFlowFailedTransition).status,
        'Error saving: disk full',
      );
    });
  });
}
