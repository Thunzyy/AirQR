import 'scanner_history_feedback_controller.dart';

typedef ScannerCompletionStopCallback = Future<void> Function();
typedef ScannerCompletionHistorySaveCallback =
    Future<ScannerHistoryFeedbackTransition> Function({
      required List<int> data,
      required String? filename,
      required String? sessionId,
    });
typedef ScannerCompletionLogCallback = void Function(String message);

sealed class ScannerCompletionFlowTransition {
  const ScannerCompletionFlowTransition();
}

class ScannerCompletionFlowSavedTransition
    extends ScannerCompletionFlowTransition {
  final String filePath;
  final String snackBarMessage;

  const ScannerCompletionFlowSavedTransition({
    required this.filePath,
    required this.snackBarMessage,
  });
}

class ScannerCompletionFlowFailedTransition
    extends ScannerCompletionFlowTransition {
  final String status;

  const ScannerCompletionFlowFailedTransition({required this.status});
}

class ScannerCompletionFlowController {
  final ScannerCompletionHistorySaveCallback _saveHistory;
  final ScannerCompletionLogCallback _log;

  ScannerCompletionFlowController({
    ScannerCompletionHistorySaveCallback? saveHistory,
    ScannerCompletionLogCallback? log,
  }) : _saveHistory =
           saveHistory ??
           (({
             required data,
             required filename,
             required sessionId,
           }) => ScannerHistoryFeedbackController().save(
             data: data,
             filename: filename,
             sessionId: sessionId,
           )),
       _log = log ?? ((_) {});

  Future<ScannerCompletionFlowTransition> finalize({
    required List<int> data,
    required String? filename,
    required String? sessionId,
    ScannerCompletionStopCallback? stopController,
  }) async {
    if (stopController != null) {
      try {
        await stopController();
      } catch (error) {
        _log('Error stopping controller: $error');
      }
    }

    final saveTransition = await _saveHistory(
      data: data,
      filename: filename,
      sessionId: sessionId,
    );

    if (saveTransition case ScannerHistoryFeedbackSuccessTransition success) {
      return ScannerCompletionFlowSavedTransition(
        filePath: success.filePath,
        snackBarMessage: 'File saved: ${success.fileName}',
      );
    }
    if (saveTransition case ScannerHistoryFeedbackFailureTransition failure) {
      return ScannerCompletionFlowFailedTransition(status: failure.status);
    }

    return const ScannerCompletionFlowFailedTransition(
      status: 'Error saving: unknown failure',
    );
  }
}
